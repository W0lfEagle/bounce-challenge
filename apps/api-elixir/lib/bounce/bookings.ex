defmodule Bounce.Bookings do
  alias Bounce.Database, as: DB

  def booking(db, id), do: DB.one(db, "SELECT * FROM bookings WHERE id = ?", [id])

  def attempt(db, id),
    do:
      DB.one(db, "SELECT id, booking_id, status, created_at FROM payment_attempts WHERE id = ?", [
        id
      ])

  def latest(db, id),
    do:
      DB.one(
        db,
        "SELECT id, booking_id, status, created_at FROM payment_attempts WHERE booking_id = ? ORDER BY rowid DESC LIMIT 1",
        [id]
      )

  def insert_booking(db, data, fingerprint, unit_price) do
    items = Enum.map(data.items, &Map.put(&1, "unitPriceCents", unit_price))

    DB.execute(
      db,
      """
      INSERT INTO bookings (id, store_id, request_fingerprint, items_json, name, email,
        total_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      """,
      [
        data.checkout_id,
        data.store_id,
        fingerprint,
        Jason.encode!(items),
        data.name,
        data.email,
        data.expected_total_cents,
        data.currency,
        now()
      ]
    )
  end

  def insert_attempt(db, data) do
    DB.execute(
      db,
      "INSERT INTO payment_attempts (id, booking_id, status, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?)",
      [data.attempt_id, data.checkout_id, now(), now()]
    )
  end

  def mark_stale(db, %{"status" => "processing", "created_at" => created_at} = attempt) do
    if now() - created_at >= 20_000 do
      DB.execute(
        db,
        "UPDATE payment_attempts SET status = 'unknown', error_code = 'STALE_ATTEMPT', updated_at = ? WHERE id = ? AND status = 'processing'",
        [now(), attempt["id"]]
      )

      attempt(db, attempt["id"])
    else
      attempt
    end
  end

  def mark_stale(_db, attempt), do: attempt

  def finish(db, data, result) do
    {status, transaction, error_code} =
      case result do
        {:succeeded, transaction} -> {"succeeded", transaction, nil}
        {:declined, code} -> {"declined", nil, code}
        {:unknown, code} -> {"unknown", nil, code}
      end

    DB.execute(
      db,
      """
      UPDATE payment_attempts SET status = ?, transaction_id = ?, transaction_json = ?,
        error_code = ?, updated_at = ? WHERE id = ?
      """,
      [
        status,
        transaction && transaction["transaction_id"],
        transaction && Jason.encode!(transaction),
        error_code,
        now(),
        data.attempt_id
      ]
    )

    if status == "succeeded",
      do:
        DB.execute(db, "UPDATE bookings SET status = 'confirmed' WHERE id = ?", [data.checkout_id])

    status
  end

  def response(attempt),
    do: %{checkoutId: attempt["booking_id"], attemptId: attempt["id"], status: attempt["status"]}

  defp now, do: System.system_time(:millisecond)
end
