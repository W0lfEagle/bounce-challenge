defmodule Bounce.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [{Task.Supervisor, name: Bounce.PaymentTasks}] ++ server_children()
    Supervisor.start_link(children, strategy: :rest_for_one, name: Bounce.Supervisor)
  end

  defp server_children do
    if Application.fetch_env!(:bounce, :start_server) do
      {:ok, ip} =
        :inet.parse_address(Application.fetch_env!(:bounce, :host) |> String.to_charlist())

      [
        {Bounce.Database,
         path: Application.fetch_env!(:bounce, :database_path), name: Bounce.Database},
        {Bandit,
         plug: Bounce.Router,
         ip: ip,
         port: Application.fetch_env!(:bounce, :port),
         http_options: [log_exceptions_with_status_codes: []]}
      ]
    else
      []
    end
  end
end
