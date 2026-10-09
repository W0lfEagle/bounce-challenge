import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase, openDatabase } from './database';
import { getStore } from './repositories/stores';

test('creates and seeds a fresh file database, preserving edits on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-db-'));
  const path = join(directory, 'nested', 'test.sqlite');
  let db = openDatabase(path);

  try {
    expect(getStore(db, 'codys-cookie-store')).toEqual({
      id: 'codys-cookie-store',
      name: "Cody's Cookie Store",
      currency: 'USD',
      checkoutItems: [
        {
          id: 'bag',
          name: 'Bag',
          unitPriceCents: 590,
          minQuantity: 1,
          maxQuantity: 10,
        },
      ],
    });
    db.prepare('UPDATE checkout_items SET unit_price_cents = 725').run();
    db.close();
    db = openDatabase(path);
    expect(getStore(db, 'codys-cookie-store')?.checkoutItems[0].unitPriceCents).toBe(725);
    expect(db.prepare('SELECT count(*) AS count FROM stores').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM checkout_items').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({
      count: 3,
    });
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rolls back the entire failed migration and does not mark it applied', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-migration-'));
  const db = new Database(':memory:');
  writeFileSync(
    join(directory, '001_broken.sql'),
    'CREATE TABLE partial (id INTEGER); INSERT INTO missing VALUES (1);',
  );

  try {
    expect(() => migrateDatabase(db, directory)).toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get(),
    ).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS count FROM schema_migrations').get()).toEqual({
      count: 0,
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('enforces quantity, integer-price, and store-reference constraints', () => {
  const db = openDatabase(':memory:');
  try {
    expect(() => db.exec('UPDATE checkout_items SET max_quantity = 0')).toThrow();
    expect(() => db.exec('UPDATE checkout_items SET unit_price_cents = 5.9')).toThrow();
    expect(() => db.exec("UPDATE checkout_items SET store_id = 'missing-store'")).toThrow();
  } finally {
    db.close();
  }
});
