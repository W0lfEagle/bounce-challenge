import { checkoutResponseSchema, priceChangedResponseSchema } from '@bounce/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDatabase } from '../database';
import type { ProcessPayment } from '../payments';
const pay = jest.fn<ReturnType<ProcessPayment>, Parameters<ProcessPayment>>();

const payload = { checkoutId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', storeId: 'codys-cookie-store', items: [{ itemId: 'bag', quantity: 2 }], expectedTotalCents: 1180, currency: 'USD', name: 'Test User', email: 'test@example.com', cardNumber: '4111111111111111' };
let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  pay.mockReset();
  pay.mockImplementation(async (input) => ({ status: 'succeeded', transaction: { transaction_id: 'txn_test', status: 'completed', amount: input.amount, currency: input.currency, last_four_digits: input.cardNumber.slice(-4), payment_method: 'credit_card', timestamp: '2026-10-09T16:00:00Z', merchant_reference: 'REF_TEST', processing_fee: 25 } }));
  app = buildApp({ databasePath: ':memory:', pay });
});
afterEach(async () => { await app.close(); });

test('calls the provider and returns confirmed success', async () => {
  const response = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 1180, currency: 'USD' }));
  expect(response.statusCode).toBe(200);
  expect(checkoutResponseSchema.parse(response.json())).toEqual({ checkoutId: payload.checkoutId, attemptId: payload.attemptId, status: 'succeeded' });
});

test.each([
  [{ ...payload, name: ' ' }, 400],
  [{ ...payload, email: 'invalid' }, 400],
  [{ ...payload, cardNumber: '123' }, 400],
  [{ ...payload, items: [{ itemId: 'bag', quantity: 11 }] }, 400],
  [{ ...payload, items: [{ itemId: 'bag', quantity: 1.5 }] }, 400],
  [{ ...payload, storeId: 'missing-store' }, 404],
  [{ ...payload, items: [] }, 400],
  [{ ...payload, items: [{ itemId: 'unknown', quantity: 2 }] }, 400],
  [{ ...payload, items: [{ itemId: 'bag', quantity: 1 }, { itemId: 'bag', quantity: 1 }] }, 400],
  [{ ...payload, expectedTotalCents: 11.8 }, 400],
])('rejects invalid checkout data', async (body, status) => {
  const response = await app.inject({ method: 'POST', url: '/checkout', payload: body });
  expect(response.statusCode).toBe(status);
  expect(response.body).not.toContain(payload.cardNumber);
});

test('replays an attempt and rejects reuse with different details without another provider call', async () => {
  const first = await app.inject({ method: 'POST', url: '/checkout', payload });
  const duplicate = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(duplicate.json()).toEqual(first.json());
  const conflict = await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, name: 'Different User' } });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('REQUEST_CONFLICT');
  const newAttempt = await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, attemptId: '33333333-3333-4333-8333-333333333333' } });
  expect(newAttempt.json().status).toBe('succeeded');
  expect(pay).toHaveBeenCalledTimes(1);
});

test('claims concurrent requests atomically', async () => {
  let resolvePayment!: (result: Awaited<ReturnType<ProcessPayment>>) => void;
  const transaction = (await pay({ name: payload.name, email: payload.email, amount: 1180, currency: 'USD', cardNumber: payload.cardNumber }));
  pay.mockClear();
  pay.mockReturnValue(new Promise((resolve) => { resolvePayment = resolve; }));
  await app.ready();
  const first = app.inject({ method: 'POST', url: '/checkout', payload }).then((response) => response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const duplicate = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(duplicate.statusCode).toBe(202);
  expect(duplicate.json().status).toBe('processing');
  expect(pay).toHaveBeenCalledTimes(1);
  resolvePayment(transaction);
  expect((await first).json().status).toBe('succeeded');
});

test('permits a new attempt only after an explicit decline', async () => {
  pay.mockResolvedValueOnce({ status: 'declined', errorCode: 'CARD_DECLINED' });
  const failed = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(failed.json().status).toBe('declined');
  await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(pay).toHaveBeenCalledTimes(1);
  const retry = await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, attemptId: '33333333-3333-4333-8333-333333333333' } });
  expect(retry.json().status).toBe('succeeded');
  expect(pay).toHaveBeenCalledTimes(2);
});

test('persists unknown outcomes and blocks new attempts', async () => {
  pay.mockResolvedValue({ status: 'unknown' });
  expect((await app.inject({ method: 'POST', url: '/checkout', payload })).json().status).toBe('unknown');
  const retry = await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, attemptId: '33333333-3333-4333-8333-333333333333' } });
  expect(retry.statusCode).toBe(202);
  expect(retry.json().attemptId).toBe(payload.attemptId);
  expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('unknown');
  expect(pay).toHaveBeenCalledTimes(1);
});

test('persists booking snapshots and transaction data without card numbers, and replays after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-booking-'));
  const path = join(directory, 'test.sqlite');
  await app.close();
  app = buildApp({ databasePath: path, pay });
  const db = openDatabase(path);
  try {
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
    expect((await app.inject({ method: 'POST', url: '/checkout', payload })).json().status).toBe('succeeded');
    expect(pay).toHaveBeenCalledTimes(1);
    expect((await app.inject(`/checkout/${payload.checkoutId}`)).body).not.toContain(payload.email);
  } finally {
    await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('marks a stale in-flight attempt unknown instead of replaying it after a crash', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-stale-'));
  const path = join(directory, 'test.sqlite');
  await app.close();
  app = buildApp({ databasePath: path, pay });
  const db = openDatabase(path);
  try {
    pay.mockResolvedValue({ status: 'declined', errorCode: 'CARD_DECLINED' });
    await app.inject({ method: 'POST', url: '/checkout', payload });
    db.prepare("UPDATE payment_attempts SET status = 'processing', created_at = ?").run(Date.now() - 60000);
    expect((await app.inject(`/checkout/${payload.checkoutId}`)).json().status).toBe('unknown');
    await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, attemptId: '33333333-3333-4333-8333-333333333333' } });
    expect(pay).toHaveBeenCalledTimes(1);
  } finally {
    await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('does not confirm or charge again if persisting provider success fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-write-failure-'));
  const path = join(directory, 'test.sqlite');
  await app.close();
  app = buildApp({ databasePath: path, pay });
  const db = openDatabase(path);
  try {
    db.exec("CREATE TRIGGER fail_confirmation BEFORE UPDATE ON bookings WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
    const result = await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(result.json().status).toBe('unknown');
    expect(db.prepare('SELECT status FROM bookings').get()).toEqual({ status: 'pending' });
    await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(pay).toHaveBeenCalledTimes(1);
  } finally {
    await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('uses changed database prices and succeeds only after accepting the new total', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-price-'));
  const path = join(directory, 'test.sqlite');
  const db = openDatabase(path);
  db.prepare('UPDATE checkout_items SET unit_price_cents = ? WHERE store_id = ?').run(700, payload.storeId);
  db.close();
  await app.close();
  app = buildApp({ databasePath: path, pay });
  try {
    const conflict = await app.inject({ method: 'POST', url: '/checkout', payload });
    expect(conflict.statusCode).toBe(409);
    expect(priceChangedResponseSchema.parse(conflict.json()).store.checkoutItems[0].unitPriceCents).toBe(700);
    const accepted = await app.inject({ method: 'POST', url: '/checkout', payload: { ...payload, expectedTotalCents: 1400 } });
    expect(accepted.statusCode).toBe(200);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns 400 for malformed JSON without exposing the payload', async () => {
  const response = await app.inject({ method: 'POST', url: '/checkout', headers: { 'content-type': 'application/json' }, payload: '{broken' });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } });
});

test('allows browser preflight for JSON checkout requests', async () => {
  const response = await app.inject({
    method: 'OPTIONS', url: '/checkout',
    headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  expect(response.headers['access-control-allow-methods']).toContain('POST');
});

test.each([
  { ...payload, expectedTotalCents: 1000 },
  { ...payload, expectedTotalCents: 1400 },
  { ...payload, currency: 'EUR' },
])('returns current pricing before contacting the provider on a total/currency mismatch', async (body) => {
  const timer = jest.spyOn(global, 'setTimeout');
  try {
    const response = await app.inject({ method: 'POST', url: '/checkout', payload: body });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PRICE_CHANGED');
    expect(response.json().store.checkoutItems[0].unitPriceCents).toBe(590);
    expect(response.json().store.currency).toBe('USD');
    expect(pay).not.toHaveBeenCalled();
  } finally {
    timer.mockRestore();
  }
});
