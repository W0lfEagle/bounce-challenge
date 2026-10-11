import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import type { ApiError, CheckoutRequest, CheckoutResponse, Store } from '@bounce/contracts';
import { getStore } from '../repositories/stores';
import {
  finishAttempt,
  getAttempt,
  getBooking,
  getLatestAttempt,
  insertAttempt,
  insertBooking,
  markStaleAttemptUnknown,
  type PaymentAttempt,
} from '../repositories/bookings';
import { paymentTimeoutMs, type PaymentResult, type ProcessPayment } from '../payments';
import { paymentDiagnostic } from '../logging';

// Allow the provider deadline plus a short margin for saving the result.
const staleAttemptAfterMs = paymentTimeoutMs + 5000;
type CheckoutLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

export class CheckoutError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiError['error']['code'],
    message: string,
    public readonly store?: Store,
  ) {
    super(message);
  }
}

function checkoutSignature(data: CheckoutRequest) {
  // This compares immutable booking details; it does not establish user ownership.
  // No card number or card-number hash is stored. Card changes require a new attempt.
  return JSON.stringify({
    storeId: data.storeId,
    items: data.items,
    expectedTotalCents: data.expectedTotalCents,
    currency: data.currency,
    name: data.name,
    email: data.email,
  });
}

function toCheckoutResponse(attempt: PaymentAttempt): CheckoutResponse {
  return {
    checkoutId: attempt.booking_id,
    attemptId: attempt.id,
    status: attempt.status,
  };
}

function resolveAttempt(
  db: Database.Database,
  attempt: PaymentAttempt,
  log?: CheckoutLogger,
): CheckoutResponse {
  const resolved = markStaleAttemptUnknown(db, attempt, staleAttemptAfterMs);
  if (attempt.status === 'processing' && resolved.status === 'unknown') {
    log?.warn(
      {
        event: 'checkout.attempt_stale',
        checkoutId: resolved.booking_id,
        attemptId: resolved.id,
        status: resolved.status,
        diagnosticCode: 'STALE_ATTEMPT',
      },
      'Payment attempt exceeded the local processing window.',
    );
  }
  return toCheckoutResponse(resolved);
}

type Claim =
  | { kind: 'replay'; response: CheckoutResponse }
  | { kind: 'start'; amount: number; currency: string };

export function getCheckoutStatus(
  db: Database.Database,
  checkoutId: string,
  log?: CheckoutLogger,
): CheckoutResponse | undefined {
  const attempt = getLatestAttempt(db, checkoutId);
  if (!attempt) return undefined;
  return resolveAttempt(db, attempt, log);
}

export async function checkout(
  db: Database.Database,
  data: CheckoutRequest,
  pay: ProcessPayment,
  log?: CheckoutLogger,
): Promise<CheckoutResponse> {
  const requestFingerprint = checkoutSignature(data);
  const claimed = db
    .transaction((): Claim => {
      const booking = getBooking(db, data.checkoutId);
      const existingAttempt = getAttempt(db, data.attemptId);
      if (existingAttempt) {
        if (
          existingAttempt.booking_id !== data.checkoutId ||
          booking?.request_fingerprint !== requestFingerprint
        ) {
          throw new CheckoutError(
            409,
            'REQUEST_CONFLICT',
            'Checkout identifiers were reused with different details.',
          );
        }
        return {
          kind: 'replay',
          response: resolveAttempt(db, existingAttempt, log),
        };
      }
      if (booking && booking.request_fingerprint !== requestFingerprint) {
        throw new CheckoutError(
          409,
          'REQUEST_CONFLICT',
          'Checkout identifiers were reused with different details.',
        );
      }
      const latest = getLatestAttempt(db, data.checkoutId);
      if (latest && latest.status !== 'declined') {
        return {
          kind: 'replay',
          response: resolveAttempt(db, latest, log),
        };
      }

      const store = getStore(db, data.storeId);
      if (!store) throw new CheckoutError(404, 'NOT_FOUND', 'Store not found.');
      const selection = data.items[0];
      // Shared contracts restrict this checkout to the store's single bag item.
      const item = store.checkoutItems[0];
      if (selection.quantity < item.minQuantity || selection.quantity > item.maxQuantity) {
        throw new CheckoutError(
          400,
          'INVALID_CHECKOUT',
          'Bag quantity is outside the current store limits.',
          store,
        );
      }
      const amount = item.unitPriceCents * selection.quantity;
      if (!Number.isSafeInteger(amount))
        throw new Error('Checkout total exceeds the safe integer range.');
      if (data.expectedTotalCents !== amount || data.currency !== store.currency) {
        throw new CheckoutError(
          409,
          'PRICE_CHANGED',
          'The price has changed. Review the updated total before booking.',
          store,
        );
      }
      if (!booking) insertBooking(db, data, requestFingerprint, item.unitPriceCents);
      insertAttempt(db, data);
      return {
        kind: 'start',
        amount: booking?.total_cents ?? amount,
        currency: booking?.currency ?? store.currency,
      };
    })
    .immediate();
  if (claimed.kind === 'replay') {
    log?.info(
      { event: 'checkout.attempt_replayed', ...claimed.response },
      'Existing attempt returned.',
    );
    return claimed.response;
  }

  const context = { checkoutId: data.checkoutId, attemptId: data.attemptId };
  log?.info({ event: 'checkout.attempt_claimed', ...context }, 'Payment attempt claimed.');
  const startedAt = performance.now();

  let result: PaymentResult;
  try {
    result = await pay({
      name: data.name,
      email: data.email,
      cardNumber: data.cardNumber,
      amount: claimed.amount,
      currency: claimed.currency,
    });
  } catch {
    result = { status: 'unknown', errorCode: 'PROVIDER_REQUEST_FAILED' };
  }
  const diagnosticCode = paymentDiagnostic(result);
  const level =
    result.status === 'unknown' || diagnosticCode === 'PAYMENT_VALIDATION_FAILED' ? 'warn' : 'info';
  // Record the provider outcome before saving it: a database failure must remain visible.
  log?.[level](
    {
      event: 'payment.result',
      ...context,
      status: result.status,
      diagnosticCode,
      durationMs: Math.round(performance.now() - startedAt),
    },
    'Payment provider call finished.',
  );
  try {
    finishAttempt(db, data, result);
  } catch {
    log?.error(
      {
        event: 'checkout.persistence_failed',
        ...context,
        providerOutcome: result.status,
        diagnosticCode: 'PAYMENT_PERSISTENCE_FAILED',
      },
      'Payment outcome could not be persisted.',
    );
    // A provider success followed by a persistence failure must never trigger another charge.
    result = { status: 'unknown', errorCode: 'PAYMENT_PERSISTENCE_FAILED' };
    finishAttempt(db, data, result);
  }
  log?.info(
    { event: 'checkout.result_persisted', ...context, status: result.status },
    'Checkout result saved.',
  );
  return {
    checkoutId: data.checkoutId,
    attemptId: data.attemptId,
    status: result.status,
  };
}
