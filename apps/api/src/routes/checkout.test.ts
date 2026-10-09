import { checkoutResponseSchema, priceChangedResponseSchema } from '@bounce/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDatabase } from '../database';

const payload = { storeId: 'codys-cookie-store', items: [{ itemId: 'bag', quantity: 2 }], expectedTotalCents: 1180, currency: 'USD', name: 'Test User', email: 'test@example.com', cardNumber: '4111111111111111' };
let app: ReturnType<typeof buildApp>;
beforeEach(() => { app = buildApp({ databasePath: ':memory:' }); });
afterEach(async () => { await app.close(); });

test('returns simulated success after the two-second delay', async () => {
  const started = Date.now();
  const response = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  expect(response.statusCode).toBe(200);
  expect(checkoutResponseSchema.parse(response.json())).toEqual({ status: 'succeeded' });
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

test('uses changed database prices and succeeds only after accepting the new total', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-price-'));
  const path = join(directory, 'test.sqlite');
  const db = openDatabase(path);
  db.prepare('UPDATE checkout_items SET unit_price_cents = ? WHERE store_id = ?').run(700, payload.storeId);
  db.close();
  await app.close();
  app = buildApp({ databasePath: path });
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
])('returns current pricing before starting the stub on a total/currency mismatch', async (body) => {
  const timer = jest.spyOn(global, 'setTimeout');
  try {
    const response = await app.inject({ method: 'POST', url: '/checkout', payload: body });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('PRICE_CHANGED');
    expect(response.json().store.checkoutItems[0].unitPriceCents).toBe(590);
    expect(response.json().store.currency).toBe('USD');
    expect(timer).not.toHaveBeenCalledWith(expect.any(Function), 2000);
  } finally {
    timer.mockRestore();
  }
});
