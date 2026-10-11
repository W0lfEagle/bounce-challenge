defmodule Bounce.Database do
  @moduledoc "Owns one SQLite connection. Only short database work runs in this process."
  use GenServer
  alias Exqlite.Sqlite3

  def start_link(options),
    do: GenServer.start_link(__MODULE__, options, Keyword.take(options, [:name]))

  @doc "Runs a short operation in the SQLite owner's process and returns its result."
  def run(server, operation) do
    case GenServer.call(server, {:run, operation}, 10_000) do
      {:ok, value} -> value
      {:error, exception, stacktrace} -> reraise exception, stacktrace
    end
  end

  def transaction(server, operation), do: run(server, &atomic(&1, operation))

  def atomic(db, operation) do
    :ok = Sqlite3.execute(db, "BEGIN IMMEDIATE")

    try do
      result = operation.(db)
      :ok = Sqlite3.execute(db, "COMMIT")
      result
    rescue
      exception ->
        Sqlite3.execute(db, "ROLLBACK")
        reraise exception, __STACKTRACE__
    end
  end

  def query(db, sql, values \\ []) do
    {:ok, statement} = Sqlite3.prepare(db, sql)

    try do
      :ok = Sqlite3.bind(statement, values)
      {:ok, columns} = Sqlite3.columns(db, statement)
      {:ok, rows} = Sqlite3.fetch_all(db, statement)
      Enum.map(rows, &Map.new(Enum.zip(columns, &1)))
    after
      Sqlite3.release(db, statement)
    end
  end

  def one(db, sql, values \\ []), do: query(db, sql, values) |> List.first()

  def execute(db, sql, values \\ []) do
    query(db, sql, values)
    :ok
  end

  @impl true
  def init(options) do
    path = Keyword.fetch!(options, :path)
    if path != ":memory:", do: File.mkdir_p!(Path.dirname(Path.expand(path)))
    {:ok, db} = Sqlite3.open(path)

    try do
      :ok =
        Sqlite3.execute(
          db,
          "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;"
        )

      migrate(db)
      {:ok, db}
    rescue
      exception ->
        Sqlite3.close(db)
        reraise exception, __STACKTRACE__
    end
  end

  @impl true
  def handle_call({:run, operation}, _from, db) do
    result =
      try do
        {:ok, operation.(db)}
      rescue
        exception -> {:error, exception, __STACKTRACE__}
      end

    {:reply, result, db}
  end

  @impl true
  def terminate(_reason, db), do: Sqlite3.close(db)

  defp migrate(db) do
    :ok =
      Sqlite3.execute(
        db,
        "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT"
      )

    directory = Application.app_dir(:bounce, "priv/migrations")

    directory
    |> File.ls!()
    |> Enum.filter(&String.ends_with?(&1, ".sql"))
    |> Enum.sort()
    |> Enum.each(fn name ->
      atomic(db, fn db ->
        unless one(db, "SELECT name FROM schema_migrations WHERE name = ?", [name]) do
          :ok = Sqlite3.execute(db, File.read!(Path.join(directory, name)))
          execute(db, "INSERT INTO schema_migrations (name) VALUES (?)", [name])
        end
      end)
    end)
  end
end
