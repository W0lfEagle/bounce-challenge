import { randomUUID } from 'expo-crypto';
import {
  CheckoutDetailsChangedError,
  checkoutSignature,
  createAttemptIds,
  loadAttemptIds,
  saveAttemptIds,
  clearAttemptIds,
  selectAttempt,
} from './checkout-attempt';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const ids = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
};
const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const values = new Map<string, string>();
beforeEach(() => {
  let sequence = 0;
  jest
    .mocked(randomUUID)
    .mockReset()
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  values.clear();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
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
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('Storage disabled');
    },
  });
  saveAttemptIds('store', ids);
  expect(loadAttemptIds('store')).toEqual(ids);
  clearAttemptIds('store');
  expect(loadAttemptIds('store')).toBeUndefined();
});

test('creates a new attempt while retaining the checkout ID for retry', () => {
  const first = createAttemptIds();
  const retry = createAttemptIds(first.checkoutId);
  const anotherCheckout = createAttemptIds();
  expect(retry.checkoutId).toBe(first.checkoutId);
  expect(retry.attemptId).not.toBe(first.attemptId);
  expect(anotherCheckout.checkoutId).not.toBe(first.checkoutId);
  expect(
    new Set([
      first.checkoutId,
      first.attemptId,
      retry.attemptId,
      anotherCheckout.checkoutId,
      anotherCheckout.attemptId,
    ]).size,
  ).toBe(5);
});

test('recovers persisted IDs in a fresh module and clears them for a later session', () => {
  saveAttemptIds('store', ids);
  jest.isolateModules(() => {
    const freshSession =
      jest.requireActual<typeof import('./checkout-attempt')>('./checkout-attempt');
    expect(freshSession.loadAttemptIds('store')).toEqual(ids);
    freshSession.clearAttemptIds('store');
    expect(freshSession.loadAttemptIds('store')).toBeUndefined();
  });
  expect(values.has('bounce:checkout:store')).toBe(false);
});

const details = {
  storeId: 'codys-cookie-store',
  items: [{ itemId: 'bag' as const, quantity: 2 }],
  expectedTotalCents: 1180,
  currency: 'USD',
  name: 'Test User',
  email: 'test@example.com',
};
const signature = checkoutSignature(details);
const previous = { ids, signature };

test('normalises non-card details and never includes card data or recovery IDs in the signature', () => {
  const fullRequest = {
    ...details,
    ...ids,
    name: ' Test User ',
    email: ' test@example.com ',
    cardNumber: '4111111111111111',
  };
  expect(checkoutSignature(fullRequest)).toBe(signature);
  expect(signature).not.toContain(fullRequest.cardNumber);
  expect(signature).not.toContain(ids.checkoutId);
  expect(signature).not.toContain(ids.attemptId);
});

test('selects a new checkout when there is no previous attempt', () => {
  expect(selectAttempt(null, signature, 'idle')).toEqual({ kind: 'create' });
  expect(randomUUID).not.toHaveBeenCalled();
});

test('selects a new attempt for unchanged details after a decline', () => {
  expect(selectAttempt(previous, signature, 'declined')).toEqual({
    kind: 'create',
    checkoutId: ids.checkoutId,
  });
  expect(randomUUID).not.toHaveBeenCalled();
});

test.each([
  { name: 'Another Person' },
  { email: 'another@example.com' },
  { items: [{ itemId: 'bag' as const, quantity: 3 }] },
  { expectedTotalCents: 1200 },
])('selects a new checkout after decline when accepted details change', (changes) => {
  const edited = checkoutSignature({ ...details, ...changes });
  expect(selectAttempt(previous, edited, 'declined')).toEqual({ kind: 'create' });
});

test('reuses the original attempt after a missing status record with unchanged details', () => {
  expect(selectAttempt(previous, signature, 'error')).toEqual({ kind: 'reuse', ids });
  expect(randomUUID).not.toHaveBeenCalled();
});

test('retains recovered IDs if the original signature is unavailable', () => {
  expect(selectAttempt({ ids }, signature, 'error')).toEqual({ kind: 'reuse', ids });
});

test('refuses to create another checkout after uncertain failure when its details changed', () => {
  const edited = checkoutSignature({ ...details, name: 'Another Person' });
  expect(() => selectAttempt(previous, edited, 'error')).toThrow(CheckoutDetailsChangedError);
  expect(randomUUID).not.toHaveBeenCalled();
});
