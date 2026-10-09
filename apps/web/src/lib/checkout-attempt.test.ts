import { createAttemptIds, loadAttemptIds, saveAttemptIds, clearAttemptIds } from './checkout-attempt';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111') }));
const ids = { checkoutId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222' };
const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  clearAttemptIds('store');
});
afterAll(() => {
  clearAttemptIds('store');
  if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

test('persists only recovery IDs and can retrieve and clear them', () => {
  saveAttemptIds('store', ids);
  expect(JSON.parse(values.get('bounce:checkout:store')!)).toEqual(ids);
  expect(loadAttemptIds('store')).toEqual(ids);
  clearAttemptIds('store');
  expect(loadAttemptIds('store')).toBeUndefined();
});

test('ignores malformed saved identifiers', () => {
  values.set('bounce:checkout:store', '{"checkoutId":"not-a-uuid"}');
  expect(loadAttemptIds('store')).toBeUndefined();
});

test('retains in-memory recovery if browser storage is unavailable', () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('Storage disabled'); } });
  saveAttemptIds('store', ids);
  expect(loadAttemptIds('store')).toEqual(ids);
  clearAttemptIds('store');
  expect(loadAttemptIds('store')).toBeUndefined();
});

test('creates a new attempt while retaining the checkout ID for retry', () => {
  expect(createAttemptIds(ids.checkoutId).checkoutId).toBe(ids.checkoutId);
});
