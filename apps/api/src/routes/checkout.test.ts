import {
  apiErrorSchema,
  checkoutResponseSchema,
  priceChangedResponseSchema,
  quantityChangedResponseSchema,
} from '@bounce/contracts';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDatabase } from '../database';
import type { PaymentInput, PaymentResult, ProcessPayment } from '../payments';

const pay = jest.fn<ReturnType<ProcessPayment>, Parameters<ProcessPayment>>();
const nextAttemptId = '33333333-3333-4333-8333-333333333333';
const nextCheckoutId = '44444444-4444-4444-8444-444444444444';
const payload = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  storeId: 'codys-cookie-store',
  items: [{ itemId: 'bag', quantity: 2 }],
  expectedTotalCents: 1180,
  currency: 'USD',
  name: 'Test User',
  email: 'test@example.com',
  cardNumber: '4111111111111111',
};
const paymentInput = {
  name: payload.name,
  email: payload.email,
  amount: payload.expectedTotalCents,
  currency: payload.currency,
  cardNumber: payload.cardNumber,
};
let app: ReturnType<typeof buildApp>;

function successfulPayment(input: PaymentInput): PaymentResult {
  return {
    status: 'succeeded',
    transaction: {
      transaction_id: 'txn_test',
      status: 'completed',
      amount: input.amount,
      currency: input.currency,
      last_four_digits: input.cardNumber.slice(-4),
      payment_method: 'credit_card',
      timestamp: '2026-10-09T16:00:00Z',
      merchant_reference: 'REF_TEST',
      processing_fee: 25,
    },
  };
}

function holdPayment() {
  let resolvePayment!: (result: PaymentResult) => void;
  let markStarted!: () => void;
  const result = new Promise<PaymentResult>((resolve) => {
    resolvePayment = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  pay.mockImplementationOnce(() => {
    markStarted();
    return result;
  });
  return { started, resolve: resolvePayment };
}

async function withFileDatabase(run: (db: Database.Database, path: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-checkout-'));
  const path = join(directory, 'test.sqlite');
  await app.close();
  app = buildApp({ databasePath: path, pay });
  const db = openDatabase(path);
  try {
    await run(db, path);
  } finally {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

beforeEach(() => {
  pay.mockReset();
  pay.mockImplementation(async (input) => successfulPayment(input));
  app = buildApp({ databasePath: ':memory:', pay });
});

afterEach(async () => {
  await app.close();
});

test('calls the provider and returns confirmed success without cacheable status', async () => {
  const response = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(pay).toHaveBeenCalledWith(paymentInput);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(checkoutResponseSchema.parse(response.json())).toEqual({
    checkoutId: payload.checkoutId,
    attemptId: payload.attemptId,
    status: 'succeeded',
  });
});

test('normalizes customer and card details before calling the provider', async () => {
  await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: {
      ...payload,
      name: ' Test User ',
      email: ' test@example.com ',
      cardNumber: '4111 1111 1111 1111',
    },
  });
  expect(pay).toHaveBeenCalledWith(paymentInput);
});

test.each([
  { label: 'blank name', changes: { name: ' ' }, status: 400 },
  { label: 'invalid email', changes: { email: 'invalid' }, status: 400 },
  { label: 'short card number', changes: { cardNumber: '123' }, status: 400 },
  { label: 'too many bags', changes: { items: [{ itemId: 'bag', quantity: 11 }] }, status: 400 },
  {
    label: 'fractional quantity',
    changes: { items: [{ itemId: 'bag', quantity: 1.5 }] },
    status: 400,
  },
  { label: 'missing store', changes: { storeId: 'missing-store' }, status: 404 },
  { label: 'empty selection', changes: { items: [] }, status: 400 },
  { label: 'unknown item', changes: { items: [{ itemId: 'unknown', quantity: 2 }] }, status: 400 },
  {
    label: 'duplicate items',
    changes: {
      items: [
        { itemId: 'bag', quantity: 1 },
        { itemId: 'bag', quantity: 1 },
      ],
    },
    status: 400,
  },
  { label: 'fractional cents', changes: { expectedTotalCents: 11.8 }, status: 400 },
])('rejects $label without calling the provider', async ({ changes, status }) => {
  const response = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, ...changes },
  });
  expect(response.statusCode).toBe(status);
  expect(response.body).not.toContain(payload.cardNumber);
  expect(pay).not.toHaveBeenCalled();
});

test('replays an attempt and rejects changed details without another provider call', async () => {
  const first = await app.inject({ method: 'POST', url: '/checkout', payload });
  const duplicate = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(duplicate.json()).toEqual(first.json());

  const conflict = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, name: 'Different User' },
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('REQUEST_CONFLICT');

  const newAttempt = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, attemptId: nextAttemptId },
  });
  expect(newAttempt.json()).toEqual(first.json());
  expect(pay).toHaveBeenCalledTimes(1);
});

test('rejects an attempt ID reused for another checkout', async () => {
  await app.inject({ method: 'POST', url: '/checkout', payload });
  const conflict = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, checkoutId: nextCheckoutId },
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('REQUEST_CONFLICT');
  expect(pay).toHaveBeenCalledTimes(1);
});

test('claims concurrent duplicate requests atomically', async () => {
  const payment = holdPayment();
  const first = app
    .inject({ method: 'POST', url: '/checkout', payload })
    .then((response) => response);
  try {
    await payment.started;
    const duplicate = await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json().status).toBe('processing');
    expect(pay).toHaveBeenCalledTimes(1);
  } finally {
    payment.resolve(successfulPayment(paymentInput));
  }
  expect((await first).json().status).toBe('succeeded');
});

test('replays a concurrent different attempt across separate database connections', async () => {
  await withFileDatabase(async (_db, path) => {
    const otherApp = buildApp({ databasePath: path, pay });
    const payment = holdPayment();
    const first = app
      .inject({ method: 'POST', url: '/checkout', payload })
      .then((response) => response);
    try {
      await payment.started;
      const duplicate = await otherApp.inject({
        method: 'POST',
        url: '/checkout',
        payload: { ...payload, attemptId: nextAttemptId },
      });
      expect(duplicate.statusCode).toBe(202);
      expect(duplicate.json()).toEqual({
        checkoutId: payload.checkoutId,
        attemptId: payload.attemptId,
        status: 'processing',
      });
      expect(pay).toHaveBeenCalledTimes(1);
    } finally {
      payment.resolve(successfulPayment(paymentInput));
      await first;
      await otherApp.close();
    }
  });
});

test('permits a new attempt only after an explicit decline', async () => {
  pay.mockResolvedValueOnce({ status: 'declined', errorCode: 'CARD_DECLINED' });
  const failed = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(failed.json().status).toBe('declined');
  await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(pay).toHaveBeenCalledTimes(1);

  const retry = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, attemptId: nextAttemptId, cardNumber: '4242424242424242' },
  });
  expect(retry.json().status).toBe('succeeded');
  expect(pay).toHaveBeenCalledTimes(2);
  expect(pay).toHaveBeenLastCalledWith({ ...paymentInput, cardNumber: '4242424242424242' });
});

test('persists unknown outcomes and blocks new attempts', async () => {
  pay.mockResolvedValue({ status: 'unknown' });
  const first = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(first.json().status).toBe('unknown');
  const retry = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, attemptId: nextAttemptId },
  });
  expect(retry.statusCode).toBe(202);
  expect(retry.json().attemptId).toBe(payload.attemptId);
  expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('unknown');
  expect(pay).toHaveBeenCalledTimes(1);
});

test('keeps a thrown provider error unknown and blocks another charge', async () => {
  pay.mockRejectedValueOnce(new Error('Connection lost'));
  const result = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(result.statusCode).toBe(202);
  expect(result.json().status).toBe('unknown');
  await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(pay).toHaveBeenCalledTimes(1);
});

test('persists snapshots and safe transaction data, then replays after restart', async () => {
  await withFileDatabase(async (db, path) => {
    await app.inject({ method: 'POST', url: '/checkout', payload });
    const booking = db.prepare('SELECT * FROM bookings').get() as Record<string, unknown>;
    expect(booking.status).toBe('confirmed');
    expect(booking.total_cents).toBe(1180);
    expect(JSON.parse(booking.items_json as string)[0].unitPriceCents).toBe(590);
    const attempt = db.prepare('SELECT * FROM payment_attempts').get() as Record<string, unknown>;
    expect(attempt.transaction_id).toBe('txn_test');
    expect(JSON.parse(attempt.transaction_json as string).processing_fee).toBe(25);
    expect(JSON.stringify([booking, attempt])).not.toContain(payload.cardNumber);

    db.exec('UPDATE checkout_items SET unit_price_cents = 900');
    await app.close();
    app = buildApp({ databasePath: path, pay });
    expect((await app.inject({ method: 'POST', url: '/checkout', payload })).json().status).toBe(
      'succeeded',
    );
    expect(pay).toHaveBeenCalledTimes(1);
    const status = await app.inject(`/checkout/${payload.checkoutId}`);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body).not.toContain(payload.email);
    expect(status.body).not.toContain(payload.cardNumber);
  });
});

test('marks a stale in-flight attempt unknown after a crash without charging again', async () => {
  await withFileDatabase(async (db) => {
    pay.mockResolvedValue({ status: 'declined', errorCode: 'CARD_DECLINED' });
    await app.inject({ method: 'POST', url: '/checkout', payload });
    db.prepare("UPDATE payment_attempts SET status = 'processing', created_at = ?").run(
      Date.now() - 60000,
    );
    expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('unknown');
    await app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...payload, attemptId: nextAttemptId },
    });
    expect(pay).toHaveBeenCalledTimes(1);
  });
});

test('accepts a late validated success after stale detection', async () => {
  await withFileDatabase(async (db) => {
    const payment = holdPayment();
    const first = app
      .inject({ method: 'POST', url: '/checkout', payload })
      .then((response) => response);
    try {
      await payment.started;
      db.prepare('UPDATE payment_attempts SET created_at = ?').run(Date.now() - 60000);
      expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('unknown');
    } finally {
      payment.resolve(successfulPayment(paymentInput));
    }
    expect((await first).json().status).toBe('succeeded');
    expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('succeeded');
    expect(db.prepare('SELECT status FROM bookings').get()).toEqual({ status: 'confirmed' });
    expect(pay).toHaveBeenCalledTimes(1);
  });
});

test('does not confirm or charge again when saving provider success fails', async () => {
  await withFileDatabase(async (db) => {
    db.exec(`
      CREATE TRIGGER fail_confirmation BEFORE UPDATE ON bookings
      WHEN NEW.status = 'confirmed'
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END
    `);
    const result = await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(result.json().status).toBe('unknown');
    expect(db.prepare('SELECT status FROM bookings').get()).toEqual({ status: 'pending' });
    await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(pay).toHaveBeenCalledTimes(1);
  });
});

test('requires acceptance of changed prices before calling the provider', async () => {
  await withFileDatabase(async (db) => {
    db.prepare('UPDATE checkout_items SET unit_price_cents = ? WHERE store_id = ?').run(
      700,
      payload.storeId,
    );
    const conflict = await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(conflict.statusCode).toBe(409);
    expect(
      priceChangedResponseSchema.parse(conflict.json()).store.checkoutItems[0].unitPriceCents,
    ).toBe(700);
    expect(pay).not.toHaveBeenCalled();
    const accepted = await app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...payload, expectedTotalCents: 1400 },
    });
    expect(accepted.statusCode).toBe(200);
  });
});

test('requires a new checkout to accept repricing after a decline', async () => {
  await withFileDatabase(async (db) => {
    pay.mockResolvedValueOnce({ status: 'declined', errorCode: 'CARD_DECLINED' });
    await app.inject({ method: 'POST', url: '/checkout', payload });
    db.exec('UPDATE checkout_items SET unit_price_cents = 700');
    const changed = await app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...payload, attemptId: nextAttemptId },
    });
    expect(changed.statusCode).toBe(409);
    expect(
      priceChangedResponseSchema.parse(changed.json()).store.checkoutItems[0].unitPriceCents,
    ).toBe(700);
    expect(pay).toHaveBeenCalledTimes(1);

    const reusedCheckout = await app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...payload, attemptId: nextAttemptId, expectedTotalCents: 1400 },
    });
    expect(reusedCheckout.statusCode).toBe(409);
    expect(reusedCheckout.json().error.code).toBe('REQUEST_CONFLICT');
    expect(pay).toHaveBeenCalledTimes(1);

    const accepted = await app.inject({
      method: 'POST',
      url: '/checkout',
      payload: {
        ...payload,
        checkoutId: nextCheckoutId,
        attemptId: nextAttemptId,
        expectedTotalCents: 1400,
      },
    });
    expect(accepted.json().status).toBe('succeeded');
    expect(pay).toHaveBeenCalledTimes(2);
    expect(
      db.prepare('SELECT total_cents FROM bookings WHERE id = ?').get(payload.checkoutId),
    ).toEqual({ total_cents: 1180 });
    expect(db.prepare('SELECT total_cents FROM bookings WHERE id = ?').get(nextCheckoutId)).toEqual(
      { total_cents: 1400 },
    );
  });
});

test.each([
  { label: 'raised minimum', min: 3, max: 10, acceptedQuantity: 3 },
  { label: 'lowered maximum', min: 1, max: 1, acceptedQuantity: 1 },
])(
  'returns current store terms for a $label without claiming an attempt',
  async ({ min, max, acceptedQuantity }) => {
    await withFileDatabase(async (db) => {
      db.prepare('UPDATE checkout_items SET min_quantity = ?, max_quantity = ?').run(min, max);
      const rejected = await app.inject({ method: 'POST', url: '/checkout', payload });
      expect(rejected.statusCode).toBe(400);
      const store = quantityChangedResponseSchema.parse(rejected.json()).store;
      expect(store.checkoutItems[0]).toMatchObject({ minQuantity: min, maxQuantity: max });
      expect(pay).not.toHaveBeenCalled();
      expect(db.prepare('SELECT count(*) AS count FROM bookings').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT count(*) AS count FROM payment_attempts').get()).toEqual({
        count: 0,
      });

      const accepted = await app.inject({
        method: 'POST',
        url: '/checkout',
        payload: {
          ...payload,
          items: [{ itemId: 'bag', quantity: acceptedQuantity }],
          expectedTotalCents: acceptedQuantity * store.checkoutItems[0].unitPriceCents,
        },
      });
      expect(accepted.json().status).toBe('succeeded');
      expect(pay).toHaveBeenCalledTimes(1);
    });
  },
);

test.each([
  { label: 'bad identifier', id: 'not-a-uuid', status: 400, code: 'INVALID_REQUEST' },
  { label: 'missing checkout', id: payload.checkoutId, status: 404, code: 'NOT_FOUND' },
])('returns a safe, uncacheable status error for $label', async ({ id, status, code }) => {
  const response = await app.inject(`/checkout/${id}`);
  expect(response.statusCode).toBe(status);
  expect(apiErrorSchema.parse(response.json()).error.code).toBe(code);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(pay).not.toHaveBeenCalled();
});

test('returns 400 for malformed JSON without exposing the payload', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'content-type': 'application/json' },
    payload: '{broken',
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request.' },
  });
  expect(pay).not.toHaveBeenCalled();
});

test.each([
  {
    label: 'unsupported content type',
    contentType: 'application/octet-stream',
    body: 'hello',
    status: 415,
  },
  {
    label: 'oversized JSON',
    contentType: 'application/json',
    body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
    status: 413,
  },
])('preserves the framework client status for $label', async ({ contentType, body, status }) => {
  const response = await app.inject({
    method: 'POST',
    url: '/checkout',
    headers: { 'content-type': contentType },
    payload: body,
  });
  expect(response.statusCode).toBe(status);
  expect(response.json()).toEqual({
    error: { code: 'INVALID_REQUEST', message: 'Invalid request.' },
  });
  expect(pay).not.toHaveBeenCalled();
});

test('allows browser preflight for JSON checkout requests', async () => {
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/checkout',
    headers: {
      origin: 'http://localhost:8081',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  expect(response.headers['access-control-allow-methods']).toContain('POST');
});

test.each([
  { label: 'lower advertised total', changes: { expectedTotalCents: 1000 } },
  { label: 'higher advertised total', changes: { expectedTotalCents: 1400 } },
  { label: 'different currency', changes: { currency: 'EUR' } },
])('returns current pricing before a payment for $label', async ({ changes }) => {
  const response = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, ...changes },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('PRICE_CHANGED');
  expect(response.json().store.checkoutItems[0].unitPriceCents).toBe(590);
  expect(response.json().store.currency).toBe('USD');
  expect(pay).not.toHaveBeenCalled();
});
