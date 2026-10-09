CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD')
) STRICT;

CREATE TABLE checkout_items (
  store_id TEXT NOT NULL REFERENCES stores(id),
  id TEXT NOT NULL CHECK (id = 'bag'),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
  max_quantity INTEGER NOT NULL CHECK (max_quantity >= min_quantity),
  PRIMARY KEY (store_id, id)
) STRICT;
