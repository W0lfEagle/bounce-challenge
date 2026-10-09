import type Database from 'better-sqlite3';
import type { ApiError, CheckoutRequest, CheckoutResponse, Store } from '@bounce/contracts';
import { getStore } from '../repositories/stores';
import { finishAttempt, getAttempt, getBooking, getLatestAttempt, insertAttempt, insertBooking, markStaleAttemptUnknown, type PaymentAttempt } from '../repositories/bookings';
import { paymentTimeoutMs, type PaymentResult, type ProcessPayment } from '../payments';

export class CheckoutError extends Error {
  constructor(public readonly statusCode: number, public readonly code: ApiError['error']['code'], message: string, public readonly store?: Store) {
    super(message);
  }
}

function fingerprint(data: CheckoutRequest) {
  // No card number or card-number hash is stored. Card changes require a new attempt.
  return JSON.stringify({ storeId: data.storeId, items: data.items, expectedTotalCents: data.expectedTotalCents, currency: data.currency, name: data.name, email: data.email });
}
function response(attempt: PaymentAttempt): CheckoutResponse {
  return { checkoutId: attempt.booking_id, attemptId: attempt.id, status: attempt.status };
}
type Claim =
  | { kind: 'replay'; response: CheckoutResponse }
  | { kind: 'start'; amount: number; currency: string };
export function getCheckoutStatus(db: Database.Database, checkoutId: string): CheckoutResponse | undefined {
  const attempt = getLatestAttempt(db, checkoutId);
  return attempt ? response(markStaleAttemptUnknown(db, attempt, paymentTimeoutMs + 5000)) : undefined;
}

export async function checkout(db: Database.Database, data: CheckoutRequest, pay: ProcessPayment): Promise<CheckoutResponse> {
  const requestFingerprint = fingerprint(data);
  const claimed = db.transaction((): Claim => {
    const booking = getBooking(db, data.checkoutId);
    const existingAttempt = getAttempt(db, data.attemptId);
    if (existingAttempt) {
      if (existingAttempt.booking_id !== data.checkoutId || booking?.request_fingerprint !== requestFingerprint) {
        throw new CheckoutError(409, 'REQUEST_CONFLICT', 'Checkout identifiers were reused with different details.');
      }
      return { kind: 'replay', response: response(markStaleAttemptUnknown(db, existingAttempt, paymentTimeoutMs + 5000)) };
    }
    if (booking && booking.request_fingerprint !== requestFingerprint) {
      throw new CheckoutError(409, 'REQUEST_CONFLICT', 'Checkout identifiers were reused with different details.');
    }
    const latest = getLatestAttempt(db, data.checkoutId);
    if (latest && latest.status !== 'declined') {
      return { kind: 'replay', response: response(markStaleAttemptUnknown(db, latest, paymentTimeoutMs + 5000)) };
    }

    const store = getStore(db, data.storeId);
    if (!store) throw new CheckoutError(404, 'NOT_FOUND', 'Store not found.');
    const selection = data.items[0];
    const item = store.checkoutItems.find((candidate) => candidate.id === selection.itemId);
    if (!item || selection.quantity < item.minQuantity || selection.quantity > item.maxQuantity) {
      throw new CheckoutError(400, 'INVALID_CHECKOUT', 'Bag quantity is outside the store limits.');
    }
    const amount = item.unitPriceCents * selection.quantity;
    if (!Number.isSafeInteger(amount)) throw new Error('Checkout total exceeds the safe integer range.');
    if (data.expectedTotalCents !== amount || data.currency !== store.currency) {
      throw new CheckoutError(409, 'PRICE_CHANGED', 'The price has changed. Review the updated total before booking.', store);
    }
    if (!booking) insertBooking(db, data, requestFingerprint, item.unitPriceCents);
    insertAttempt(db, data);
    return { kind: 'start', amount: booking?.total_cents ?? amount, currency: booking?.currency ?? store.currency };
  }).immediate();
  if (claimed.kind === 'replay') return claimed.response;

  let result: PaymentResult;
  try {
    result = await pay({ name: data.name, email: data.email, cardNumber: data.cardNumber, amount: claimed.amount, currency: claimed.currency });
  } catch {
    result = { status: 'unknown', errorCode: 'PROVIDER_REQUEST_FAILED' };
  }
  try {
    finishAttempt(db, data, result);
  } catch {
    // A provider success followed by a persistence failure must never trigger another charge.
    result = { status: 'unknown', errorCode: 'PAYMENT_PERSISTENCE_FAILED' };
    finishAttempt(db, data, result);
  }
  return { checkoutId: data.checkoutId, attemptId: data.attemptId, status: result.status };
}
