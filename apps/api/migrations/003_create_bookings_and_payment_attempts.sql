CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  request_fingerprint TEXT NOT NULL,
  items_json TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  status TEXT NOT NULL CHECK (status IN ('processing', 'succeeded', 'declined', 'unknown')),
  transaction_id TEXT UNIQUE,
  transaction_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX attempts_by_booking ON payment_attempts (booking_id);
CREATE UNIQUE INDEX one_unresolved_attempt_per_booking
  ON payment_attempts (booking_id) WHERE status IN ('processing', 'unknown');
