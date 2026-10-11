import type Database from 'better-sqlite3';
import type { CheckoutRequest, CheckoutResponse } from '@bounce/contracts';
import type { PaymentResult } from '../payments';

export type Booking = {
  id: string;
  store_id: string;
  request_fingerprint: string;
  total_cents: number;
  currency: string;
  status: 'pending' | 'confirmed';
};
export type PaymentAttempt = {
  id: string;
  booking_id: string;
  status: CheckoutResponse['status'];
  created_at: number;
};

export function getBooking(db: Database.Database, id: string) {
  return db.prepare<[string], Booking>('SELECT * FROM bookings WHERE id = ?').get(id);
}

export function getAttempt(db: Database.Database, id: string) {
  return db
    .prepare<[string], PaymentAttempt>(
      `
    SELECT id, booking_id, status, created_at
    FROM payment_attempts WHERE id = ?
  `,
    )
    .get(id);
}

export function getLatestAttempt(db: Database.Database, bookingId: string) {
  return db
    .prepare<[string], PaymentAttempt>(
      `
    SELECT id, booking_id, status, created_at
    FROM payment_attempts WHERE booking_id = ? ORDER BY rowid DESC LIMIT 1
  `,
    )
    .get(bookingId);
}

export function insertBooking(
  db: Database.Database,
  data: CheckoutRequest,
  fingerprint: string,
  unitPriceCents: number,
) {
  db.prepare(
    `
    INSERT INTO bookings (
      id, store_id, request_fingerprint, items_json, name, email,
      total_cents, currency, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `,
  ).run(
    data.checkoutId,
    data.storeId,
    fingerprint,
    JSON.stringify(data.items.map((item) => ({ ...item, unitPriceCents }))),
    data.name,
    data.email,
    data.expectedTotalCents,
    data.currency,
    Date.now(),
  );
}

export function insertAttempt(db: Database.Database, data: CheckoutRequest) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO payment_attempts (id, booking_id, status, created_at, updated_at)
    VALUES (?, ?, 'processing', ?, ?)
  `,
  ).run(data.attemptId, data.checkoutId, now, now);
}

export function markStaleAttemptUnknown(
  db: Database.Database,
  attempt: PaymentAttempt,
  staleAfterMs: number,
) {
  if (attempt.status === 'processing' && Date.now() - attempt.created_at >= staleAfterMs) {
    // Expiry proves uncertainty, not failure; a late provider result can still finalize it.
    db.prepare(
      `
      UPDATE payment_attempts
      SET status = 'unknown', error_code = 'STALE_ATTEMPT', updated_at = ?
      WHERE id = ? AND status = 'processing'
    `,
    ).run(Date.now(), attempt.id);
    return getAttempt(db, attempt.id)!;
  }
  return attempt;
}

export function finishAttempt(db: Database.Database, data: CheckoutRequest, result: PaymentResult) {
  db.transaction(() => {
    db.prepare(
      `
      UPDATE payment_attempts
      SET status = ?, transaction_id = ?, transaction_json = ?, error_code = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(
      result.status,
      result.status === 'succeeded' ? result.transaction.transaction_id : null,
      result.status === 'succeeded' ? JSON.stringify(result.transaction) : null,
      result.status === 'succeeded' ? null : (result.errorCode ?? 'PAYMENT_OUTCOME_UNKNOWN'),
      Date.now(),
      data.attemptId,
    );
    if (result.status === 'succeeded') {
      db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(data.checkoutId);
    }
  }).immediate();
}
