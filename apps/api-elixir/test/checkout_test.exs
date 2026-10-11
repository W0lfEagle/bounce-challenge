defmodule Bounce.CheckoutTest do
  use ExUnit.Case, async: true
  alias Bounce.{Checkout, CheckoutError, Contracts, Database, Stores}

  setup do
    database = start_supervised!({Database, path: ":memory:"})
    {:ok, data} = Contracts.checkout(payload())
    %{database: database, data: data}
  end

  defp payload do
    %{
      "checkoutId" => "11111111-1111-4111-8111-111111111111",
      "attemptId" => "22222222-2222-4222-8222-222222222222",
      "storeId" => "codys-cookie-store",
      "items" => [%{"itemId" => "bag", "quantity" => 2}],
      "expectedTotalCents" => 1180,
      "currency" => "USD",
      "name" => "  Example  ",
      "email" => " example@example.com ",
      "cardNumber" => "4111 1111 1111 1111"
    }
  end

  defp success(input),
    do:
      {:succeeded,
       %{"transaction_id" => "txn_1", "amount" => input.amount, "last_four_digits" => "1111"}}

  defp rows(database, table),
    do: Database.run(database, &Database.query(&1, "SELECT * FROM #{table}"))

  test "normalizes boundary data and rejects malformed or unsafe input" do
    assert {:ok,
            %{name: "Example", email: "example@example.com", card_number: "4111111111111111"}} =
             Contracts.checkout(payload())

    for {key, value} <- [
          {"name", " "},
          {"email", "bad@"},
          {"cardNumber", "4111-1111-1111-1111"},
          {"checkoutId", "bad"},
          {"expectedTotalCents", 9_007_199_254_740_992},
          {"items", [%{"itemId" => "bag", "quantity" => 1.5}]},
          {"currency", "usd"}
        ] do
      assert {:error, :invalid_checkout} = Contracts.checkout(Map.put(payload(), key, value))
    end

    assert {:error, :invalid_checkout} = Contracts.checkout(nil)
  end

  test "persists accepted price and provider result without storing a card", %{
    database: db,
    data: data
  } do
    assert %{status: "succeeded"} = Checkout.checkout(db, data, &success/1)
    [booking] = rows(db, "bookings")
    assert booking["status"] == "confirmed"
    assert booking["total_cents"] == 1180

    assert Jason.decode!(booking["items_json"]) == [
             %{"itemId" => "bag", "quantity" => 2, "unitPriceCents" => 590}
           ]

    assert [attempt] = rows(db, "payment_attempts")
    assert attempt["transaction_id"] == "txn_1"
    refute Jason.encode!(booking) =~ data.card_number
    assert Checkout.status(db, data.checkout_id).status == "succeeded"
  end

  test "replays an existing attempt before consulting new prices", %{database: db, data: data} do
    result = Checkout.checkout(db, data, &success/1)
    Database.run(db, &Database.execute(&1, "UPDATE checkout_items SET unit_price_cents = 900"))
    assert Checkout.checkout(db, data, fn _ -> flunk("must not charge twice") end) == result

    assert Checkout.checkout(
             db,
             %{data | attempt_id: "33333333-3333-4333-8333-333333333333"},
             fn _ -> flunk("confirmed booking") end
           ) == result
  end

  test "conflicting identifiers roll back without killing the database owner", %{
    database: db,
    data: data
  } do
    Checkout.checkout(db, data, &success/1)

    assert_raise CheckoutError, fn ->
      Checkout.checkout(db, %{data | name: "Other"}, &success/1)
    end

    assert Process.alive?(db)
    assert length(rows(db, "payment_attempts")) == 1
  end

  test "price and quantity changes reject before payment and include the current store", %{
    database: db,
    data: data
  } do
    for changed <- [
          %{data | expected_total_cents: 1000},
          %{data | currency: "EUR"},
          %{data | quantity: 11}
        ] do
      exception =
        assert_raise CheckoutError, fn ->
          Checkout.checkout(db, changed, fn _ -> flunk("invalid terms") end)
        end

      assert exception.store["id"] == data.store_id
    end

    assert rows(db, "bookings") == []
    assert rows(db, "payment_attempts") == []
  end

  test "only an explicit decline allows a new attempt", %{database: db, data: data} do
    assert %{status: "declined"} =
             Checkout.checkout(db, data, fn _ -> {:declined, "CARD_DECLINED"} end)

    assert %{status: "declined"} =
             Checkout.checkout(db, data, fn _ -> flunk("replayed decline") end)

    retry = %{
      data
      | attempt_id: "33333333-3333-4333-8333-333333333333",
        card_number: "4242424242424242"
    }

    assert %{status: "succeeded"} = Checkout.checkout(db, retry, &success/1)
    assert length(rows(db, "bookings")) == 1
    assert length(rows(db, "payment_attempts")) == 2
  end

  test "unknown and provider exceptions cannot start another charge", %{database: db, data: data} do
    assert %{status: "unknown"} =
             Checkout.checkout(db, data, fn _ -> raise "transport failed" end)

    retry = %{data | attempt_id: "33333333-3333-4333-8333-333333333333"}

    assert %{attemptId: id, status: "unknown"} =
             Checkout.checkout(db, retry, fn _ -> flunk("uncertain payment") end)

    assert id == data.attempt_id
    assert length(rows(db, "payment_attempts")) == 1
  end

  test "concurrent replay and status reads proceed while provider is waiting", %{
    database: db,
    data: data
  } do
    parent = self()

    task =
      Task.async(fn ->
        Checkout.checkout(db, data, fn input ->
          send(parent, {:paying, self()})

          receive do
            :release -> success(input)
          end
        end)
      end)

    assert_receive {:paying, payer}
    assert Checkout.status(db, data.checkout_id).status == "processing"

    assert Checkout.checkout(db, data, fn _ -> flunk("duplicate in-flight charge") end).status ==
             "processing"

    assert Database.run(db, &Stores.get(&1, data.store_id))["name"] == "Cody's Cookie Store"
    send(payer, :release)
    assert Task.await(task).status == "succeeded"
  end

  test "stale processing is unknown and still cannot be retried", %{database: db, data: data} do
    parent = self()

    task =
      Task.async(fn ->
        Checkout.checkout(db, data, fn _ ->
          send(parent, {:waiting, self()})

          receive do
            :release -> {:unknown, "PROVIDER_TIMEOUT"}
          end
        end)
      end)

    assert_receive {:waiting, payer}
    Database.run(db, &Database.execute(&1, "UPDATE payment_attempts SET created_at = 0"))
    assert Checkout.status(db, data.checkout_id).status == "unknown"
    assert Checkout.checkout(db, data, fn _ -> flunk("stale charge") end).status == "unknown"
    send(payer, :release)
    Task.await(task)
  end

  test "a persistence failure after provider success becomes unknown", %{database: db, data: data} do
    Checkout.checkout(db, data, &success/1)

    other = %{
      data
      | checkout_id: "33333333-3333-4333-8333-333333333333",
        attempt_id: "44444444-4444-4444-8444-444444444444"
    }

    assert Checkout.checkout(db, other, &success/1).status == "unknown"
    assert Checkout.status(db, other.checkout_id).status == "unknown"

    assert Checkout.checkout(db, other, fn _ -> flunk("persistence uncertainty") end).status ==
             "unknown"
  end

  test "reopening a database preserves bookings and applies migrations once", %{data: data} do
    path =
      Path.join(
        System.tmp_dir!(),
        "bounce-elixir-#{System.unique_integer([:positive])}/test.sqlite"
      )

    on_exit(fn -> File.rm_rf!(Path.dirname(path)) end)
    {:ok, db} = Database.start_link(path: path)
    Checkout.checkout(db, data, &success/1)
    GenServer.stop(db)
    {:ok, reopened} = Database.start_link(path: path)
    assert Checkout.status(reopened, data.checkout_id).status == "succeeded"
    assert length(rows(reopened, "schema_migrations")) == 3
    GenServer.stop(reopened)
  end

  test "release migrations match the Node backend's SQL" do
    node = Path.expand("../../api/migrations", __DIR__)
    elixir = Application.app_dir(:bounce, "priv/migrations")
    assert Enum.sort(File.ls!(node)) == Enum.sort(File.ls!(elixir))

    for name <- File.ls!(node),
        do: assert(File.read!(Path.join(node, name)) == File.read!(Path.join(elixir, name)))
  end
end
