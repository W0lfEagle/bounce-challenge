defmodule Bounce.PaymentsTest do
  use ExUnit.Case, async: false
  alias Bounce.Payments

  @input %{
    name: "Example",
    email: "example@example.com",
    amount: 590,
    currency: "USD",
    card_number: "4111111111111111"
  }
  @transaction %{
    "transaction_id" => "txn_1",
    "status" => "completed",
    "amount" => 590,
    "currency" => "USD",
    "last_four_digits" => "1111",
    "payment_method" => "credit_card",
    "timestamp" => "2026-10-10",
    "merchant_reference" => "ref_1",
    "processing_fee" => 25
  }

  test "validates success against amount, currency, card suffix, and metadata" do
    assert {:succeeded, @transaction} = Payments.classify(200, @transaction, @input)

    assert {:succeeded, @transaction} =
             Payments.classify(
               200,
               Map.put(@transaction, "card_number", @input.card_number),
               @input
             )

    for body <- [
          Map.put(@transaction, "amount", 1),
          Map.put(@transaction, "currency", "EUR"),
          Map.put(@transaction, "last_four_digits", "2222"),
          Map.delete(@transaction, "timestamp")
        ] do
      assert {:unknown, "INVALID_PROVIDER_RESPONSE"} = Payments.classify(200, body, @input)
    end
  end

  test "only documented declines are safe to retry" do
    decline = %{"detail" => "declined", "error_code" => "CARD_DECLINED"}
    assert {:declined, "CARD_DECLINED"} = Payments.classify(400, decline, @input)
    assert {:declined, "CARD_DECLINED"} = Payments.classify(400, %{"detail" => decline}, @input)

    assert {:declined, "PAYMENT_VALIDATION_FAILED"} =
             Payments.classify(
               422,
               %{"detail" => [%{"loc" => ["body", 0], "msg" => "bad", "type" => "value_error"}]},
               @input
             )

    assert {:unknown, _} = Payments.classify(422, %{"detail" => [%{}]}, @input)
    assert {:unknown, _} = Payments.classify(400, %{}, @input)
    assert {:unknown, _} = Payments.classify(500, %{}, @input)
  end

  defmodule Provider do
    import Plug.Conn
    def init(options), do: options

    def call(conn, options) do
      send(options[:parent], :provider_called)
      {:ok, body, conn} = read_body(conn)
      send(options[:parent], {:payment_body, Jason.decode!(body)})

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(options[:status], options[:body])
    end
  end

  test "real HTTP adapter sends provider keys and never retries a 503" do
    server =
      start_supervised!(
        {Bandit,
         plug: {Provider, parent: self(), status: 503, body: "{}"}, ip: {127, 0, 0, 1}, port: 0}
      )

    {:ok, {_ip, port}} = ThousandIsland.listener_info(server)
    previous = Application.fetch_env!(:bounce, :payments_api_url)
    Application.put_env(:bounce, :payments_api_url, "http://127.0.0.1:#{port}/v1/payments")
    on_exit(fn -> Application.put_env(:bounce, :payments_api_url, previous) end)
    assert {:unknown, "UNEXPECTED_PROVIDER_STATUS"} = Payments.process(@input)
    assert_receive :provider_called
    assert_receive {:payment_body, %{"card_number" => "4111111111111111", "amount" => 590}}
    refute_receive :provider_called
  end
end
