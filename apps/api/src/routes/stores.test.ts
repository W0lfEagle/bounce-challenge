import { apiErrorSchema, storeSchema } from '@bounce/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDatabase } from '../database';

test('returns a seeded store matching the shared contract', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  try {
    const response = await app.inject('/stores/codys-cookie-store');
    expect(response.statusCode).toBe(200);
    const store = storeSchema.parse(response.json());
    expect(store.name).toBe("Cody's Cookie Store");
    expect(store.checkoutItems[0]).toMatchObject({ unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 });
  } finally { await app.close(); }
});

test.each([
  ['/stores/missing-store', 404, 'NOT_FOUND'],
  ['/stores/invalid_store', 400, 'INVALID_STORE_ID'],
])('returns a predictable error for %s', async (url, status, code) => {
  const app = buildApp({ databasePath: ':memory:' });
  try {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(status);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(code);
  } finally { await app.close(); }
});

test('serves changed database prices and hides internal errors for invalid stored data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-api-'));
  const path = join(directory, 'test.sqlite');
  const db = openDatabase(path);
  db.exec('UPDATE checkout_items SET unit_price_cents = 725');
  const app = buildApp({ databasePath: path });
  try {
    const response = await app.inject('/stores/codys-cookie-store');
    expect(response.json().checkoutItems[0].unitPriceCents).toBe(725);
    db.exec('DELETE FROM checkout_items');
    const invalid = await app.inject('/stores/codys-cookie-store');
    expect(invalid.statusCode).toBe(500);
    expect(invalid.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  } finally {
    await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('allows the configured web origin through CORS', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  try {
    const response = await app.inject({ url: '/stores/codys-cookie-store', headers: { origin: 'http://localhost:8081' } });
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  } finally { await app.close(); }
});
