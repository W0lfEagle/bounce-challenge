INSERT INTO stores (id, name, currency)
VALUES ('codys-cookie-store', 'Cody''s Cookie Store', 'USD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO checkout_items (store_id, id, name, unit_price_cents, min_quantity, max_quantity)
VALUES ('codys-cookie-store', 'bag', 'Bag', 590, 1, 10)
ON CONFLICT (store_id, id) DO NOTHING;
