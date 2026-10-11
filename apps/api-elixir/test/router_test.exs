defmodule Bounce.RouterTest do
  use ExUnit.Case, async: true
  import Plug.Test
  import Plug.Conn
  alias Bounce.{Database, Router}

  setup do
    %{database: start_supervised!({Database, path: ":memory:"})}
  end

  defp request(database, method, path, body \\ nil) do
    conn(method, path, body)
    |> put_req_header("content-type", "application/json")
    |> assign(:database, database)
    |> Router.call(Router.init([]))
  end

  test "health, store, validation, missing resources, and preflight", %{database: db} do
    assert request(db, :get, "/health").resp_body == ~s({"status":"ok"})
    store = request(db, :get, "/stores/codys-cookie-store")

    assert Jason.decode!(store.resp_body)["checkoutItems"] |> hd() |> Map.get("unitPriceCents") ==
             590

    assert request(db, :get, "/stores/BAD_ID").status == 400
    assert request(db, :get, "/stores/missing-store").status == 404
    assert request(db, :get, "/checkout/bad").status == 400
    assert request(db, :get, "/checkout/11111111-1111-4111-8111-111111111111").status == 404
    assert request(db, :get, "/missing").status == 404
    assert request(db, :post, "/checkout", "{}").status == 400
    cors = request(db, :options, "/checkout")
    assert cors.status == 204
    assert get_resp_header(cors, "access-control-allow-origin") == ["http://localhost:8081"]
  end

  test "unknown checkout gets 202 and status reads get 200 with no-store", %{database: db} do
    body = %{
      "checkoutId" => "11111111-1111-4111-8111-111111111111",
      "attemptId" => "22222222-2222-4222-8222-222222222222",
      "storeId" => "codys-cookie-store",
      "items" => [%{"itemId" => "bag", "quantity" => 1}],
      "expectedTotalCents" => 590,
      "currency" => "USD",
      "name" => "Example",
      "email" => "example@example.com",
      "cardNumber" => "4111111111111111"
    }

    response =
      conn(:post, "/checkout", Jason.encode!(body))
      |> put_req_header("content-type", "application/json")
      |> assign(:database, db)
      |> assign(:pay, fn _ -> {:unknown, "PROVIDER_TIMEOUT"} end)
      |> Router.call([])

    assert response.status == 202
    assert Jason.decode!(response.resp_body)["status"] == "unknown"
    status = request(db, :get, "/checkout/#{body["checkoutId"]}")
    assert status.status == 200
    assert get_resp_header(status, "cache-control") == ["no-store"]
  end

  test "malformed JSON returns the public error envelope", %{database: db} do
    connection =
      conn(:post, "/checkout", "{")
      |> put_req_header("content-type", "application/json")
      |> assign(:database, db)

    assert_raise Plug.Parsers.ParseError, fn -> Router.call(connection, []) end
    {status, _headers, body} = Plug.Test.sent_resp(connection)
    assert status == 400
    assert Jason.decode!(body)["error"]["code"] == "INVALID_REQUEST"
  end
end
