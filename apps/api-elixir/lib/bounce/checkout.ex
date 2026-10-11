defmodule Bounce.Checkout do
  alias Bounce.{Bookings, CheckoutError, Database, Payments, Stores}

  def status(database, checkout_id) do
    Database.run(database, fn db ->
      case Bookings.latest(db, checkout_id) do
        nil -> nil
        attempt -> db |> Bookings.mark_stale(attempt) |> Bookings.response()
      end
    end)
  end

  def checkout(database, data, pay \\ &Payments.process/1) do
    case Database.transaction(database, &claim(&1, data)) do
      {:replay, response} ->
        response

      {:start, amount, currency} ->
        # Provider I/O happens in the request process, outside the database owner/transaction.
        result =
          try do
            pay.(%{
              name: data.name,
              email: data.email,
              card_number: data.card_number,
              amount: amount,
              currency: currency
            })
          rescue
            _ -> {:unknown, "PROVIDER_REQUEST_FAILED"}
          end

        status =
          try do
            Database.transaction(database, &Bookings.finish(&1, data, result))
          rescue
            _ ->
              Database.transaction(
                database,
                &Bookings.finish(&1, data, {:unknown, "PAYMENT_PERSISTENCE_FAILED"})
              )
          end

        %{checkoutId: data.checkout_id, attemptId: data.attempt_id, status: status}
    end
  end

  defp claim(db, data) do
    fingerprint = signature(data)
    booking = Bookings.booking(db, data.checkout_id)
    existing = Bookings.attempt(db, data.attempt_id)
    latest = Bookings.latest(db, data.checkout_id)

    cond do
      existing &&
          (existing["booking_id"] != data.checkout_id ||
             booking["request_fingerprint"] != fingerprint) ->
        conflict!()

      booking && booking["request_fingerprint"] != fingerprint ->
        conflict!()

      existing ->
        replay(db, existing)

      latest && latest["status"] != "declined" ->
        replay(db, latest)

      true ->
        start(db, data, booking, fingerprint)
    end
  end

  defp start(db, data, booking, fingerprint) do
    store =
      Stores.get(db, data.store_id) || CheckoutError.reject!(404, "NOT_FOUND", "Store not found.")

    [item] = store["checkoutItems"]

    if data.quantity < item["minQuantity"] || data.quantity > item["maxQuantity"] do
      CheckoutError.reject!(
        400,
        "INVALID_CHECKOUT",
        "Bag quantity is outside the current store limits.",
        store
      )
    end

    amount = item["unitPriceCents"] * data.quantity
    if amount > 9_007_199_254_740_991, do: raise("Checkout total exceeds the safe integer range.")

    if data.expected_total_cents != amount || data.currency != store["currency"] do
      CheckoutError.reject!(
        409,
        "PRICE_CHANGED",
        "The price has changed. Review the updated total before booking.",
        store
      )
    end

    unless booking, do: Bookings.insert_booking(db, data, fingerprint, item["unitPriceCents"])
    Bookings.insert_attempt(db, data)

    {:start, (booking && booking["total_cents"]) || amount,
     (booking && booking["currency"]) || store["currency"]}
  end

  defp replay(db, attempt),
    do: {:replay, db |> Bookings.mark_stale(attempt) |> Bookings.response()}

  defp conflict!,
    do:
      CheckoutError.reject!(
        409,
        "REQUEST_CONFLICT",
        "Checkout identifiers were reused with different details."
      )

  defp signature(data) do
    # Stable ordering, no card number/hash. This encoding is private to this backend's database.
    Jason.encode!([
      data.store_id,
      data.items,
      data.expected_total_cents,
      data.currency,
      data.name,
      data.email
    ])
  end
end
