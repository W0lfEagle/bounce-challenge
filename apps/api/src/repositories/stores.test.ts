import { openDatabase } from '../database';
import { getStore } from './stores';

test('returns undefined for a store that does not exist', () => {
  const db = openDatabase(':memory:');
  try {
    expect(getStore(db, 'missing-store')).toBeUndefined();
  } finally {
    db.close();
  }
});

test('reads each store with its own item pricing and bounds', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO stores (id, name, currency) VALUES (?, ?, ?)')
      .run('another-store', 'Another Store', 'USD');
    db.prepare(`
      INSERT INTO checkout_items (store_id, id, name, unit_price_cents, min_quantity, max_quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('another-store', 'bag', 'Bag', 725, 2, 6);

    expect(getStore(db, 'another-store')).toEqual({
      id: 'another-store',
      name: 'Another Store',
      currency: 'USD',
      checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 725, minQuantity: 2, maxQuantity: 6 }],
    });
    expect(getStore(db, 'codys-cookie-store')?.checkoutItems).toEqual([
      { id: 'bag', name: 'Bag', unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 },
    ]);
  } finally {
    db.close();
  }
});
