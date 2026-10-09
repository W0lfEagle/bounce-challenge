import { storeSchema, type Store } from '@bounce/contracts';
import type Database from 'better-sqlite3';

export function getStore(db: Database.Database, storeId: string): Store | undefined {
  const row = db.prepare('SELECT id, name, currency FROM stores WHERE id = ?').get(storeId);
  if (!row) return undefined;
  const store = storeSchema.omit({ checkoutItems: true }).parse(row);

  const checkoutItems = db.prepare(`
    SELECT id, name, unit_price_cents AS unitPriceCents,
      min_quantity AS minQuantity, max_quantity AS maxQuantity
    FROM checkout_items WHERE store_id = ? ORDER BY id
  `).all(storeId);

  return storeSchema.parse({ ...store, checkoutItems });
}
