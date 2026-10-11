defmodule Bounce.Stores do
  alias Bounce.Database, as: DB

  def get(db, store_id) do
    case DB.one(db, "SELECT id, name, currency FROM stores WHERE id = ?", [store_id]) do
      nil ->
        nil

      store ->
        items =
          DB.query(
            db,
            """
            SELECT id, name, unit_price_cents AS unitPriceCents,
              min_quantity AS minQuantity, max_quantity AS maxQuantity
            FROM checkout_items WHERE store_id = ? ORDER BY id
            """,
            [store_id]
          )

        Map.put(store, "checkoutItems", items)
    end
  end
end
