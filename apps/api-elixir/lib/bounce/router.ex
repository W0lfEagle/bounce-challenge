defmodule Bounce.Router do
  use Plug.Router
  use Plug.ErrorHandler
  alias Bounce.{Checkout, CheckoutError, Contracts, Database, Payments, Stores}

  plug(:configure)
  plug(:cors)
  plug(:match)
  plug(Plug.Parsers, parsers: [:json], pass: [], json_decoder: Jason, length: 1_048_576)
  plug(:dispatch)

  defp configure(conn, _options) do
    conn
    |> assign(:database, conn.assigns[:database] || Database)
    |> assign(:pay, conn.assigns[:pay] || (&Payments.process/1))
    |> assign(
      :web_origin,
      conn.assigns[:web_origin] || Application.fetch_env!(:bounce, :web_origin)
    )
  end

  defp cors(conn, _options) do
    conn =
      conn
      |> put_resp_header("access-control-allow-origin", conn.assigns.web_origin)
      |> put_resp_header("vary", "Origin")

    if conn.method == "OPTIONS" do
      conn
      |> put_resp_header("access-control-allow-methods", "GET, POST")
      |> put_resp_header("access-control-allow-headers", "content-type")
      |> send_resp(204, "")
      |> halt()
    else
      conn
    end
  end

  get "/health" do
    json(conn, 200, %{status: "ok"})
  end

  get "/stores/:store_id" do
    cond do
      not Contracts.store_id?(store_id) ->
        error(conn, 400, "INVALID_STORE_ID", "Invalid store identifier.")

      true ->
        case Database.run(conn.assigns.database, &Stores.get(&1, store_id)) do
          nil -> error(conn, 404, "NOT_FOUND", "Store not found.")
          store -> json(conn, 200, store)
        end
    end
  end

  post "/checkout" do
    conn = put_resp_header(conn, "cache-control", "no-store")

    with {:ok, data} <- Contracts.checkout(conn.body_params) do
      try do
        result = Checkout.checkout(conn.assigns.database, data, conn.assigns.pay)
        json(conn, if(result.status in ["processing", "unknown"], do: 202, else: 200), result)
      rescue
        exception in CheckoutError ->
          body = %{error: %{code: exception.code, message: exception.message}}
          body = if exception.store, do: Map.put(body, :store, exception.store), else: body
          json(conn, exception.status, body)
      end
    else
      _ -> error(conn, 400, "INVALID_CHECKOUT", "Invalid checkout details.")
    end
  end

  get "/checkout/:checkout_id" do
    conn = put_resp_header(conn, "cache-control", "no-store")

    if Contracts.uuid?(checkout_id) do
      case Checkout.status(conn.assigns.database, checkout_id) do
        nil -> error(conn, 404, "NOT_FOUND", "Checkout not found.")
        result -> json(conn, 200, result)
      end
    else
      error(conn, 400, "INVALID_REQUEST", "Invalid checkout identifier.")
    end
  end

  match _ do
    error(conn, 404, "NOT_FOUND", "Resource not found.")
  end

  @impl Plug.ErrorHandler
  def handle_errors(conn, %{reason: reason}) do
    # Do not log exceptions containing request bodies or database parameters.
    status = Plug.Exception.status(reason)

    if status >= 400 and status < 500 do
      error(conn, status, "INVALID_REQUEST", "Invalid request.")
    else
      error(conn, 500, "INTERNAL_ERROR", "Something went wrong. Please try again.")
    end
  end

  defp error(conn, status, code, message),
    do: json(conn, status, %{error: %{code: code, message: message}})

  defp json(conn, status, body),
    do:
      conn |> put_resp_content_type("application/json") |> send_resp(status, Jason.encode!(body))
end
