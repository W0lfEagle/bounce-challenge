import {
  CheckoutNotFoundError,
  CheckoutRejectedError,
  PriceChangedError,
  QuantityChangedError,
  getCheckoutStatus,
  submitCheckout,
} from './checkout';
import type { Store } from '@bounce/contracts';

const payload = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  storeId: 'codys-cookie-store',
  items: [{ itemId: 'bag' as const, quantity: 2 }],
  expectedTotalCents: 1180,
  currency: 'USD',
  name: ' Test User ',
  email: ' test@example.com ',
  cardNumber: '4111 1111 1111 1111',
};
const success = {
  checkoutId: payload.checkoutId,
  attemptId: payload.attemptId,
  status: 'succeeded',
};
const store: Store = {
  id: payload.storeId,
  name: "Cody's Cookie Store",
  currency: 'USD',
  checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 700, minQuantity: 1, maxQuantity: 10 }],
};
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function reply(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

test('posts normalised details and quantity as JSON', async () => {
  reply(200, success);
  await submitCheckout(payload);
  const [url, request] = mockFetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:3000/checkout');
  expect(request.method).toBe('POST');
  expect(JSON.parse(request.body)).toEqual({
    ...payload,
    name: 'Test User',
    email: 'test@example.com',
    cardNumber: '4111111111111111',
  });
});

test.each([
  { status: 'failed' },
  { ...success, checkoutId: '33333333-3333-4333-8333-333333333333' },
])('rejects malformed or unrelated checkout results', async (body) => {
  reply(200, body);
  await expect(submitCheckout(payload)).rejects.toThrow();
});

test.each<[number, string]>([
  [400, 'INVALID_CHECKOUT'],
  [400, 'INVALID_REQUEST'],
  [404, 'NOT_FOUND'],
  [409, 'REQUEST_CONFLICT'],
  [500, 'INTERNAL_ERROR'],
])('preserves HTTP %i and error code %s so the UI can classify recovery', async (status, code) => {
  reply(status, { error: { code, message: 'Checkout rejected.' } });
  const result = submitCheckout(payload);
  await expect(result).rejects.toBeInstanceOf(CheckoutRejectedError);
  await expect(result).rejects.toMatchObject({
    statusCode: status,
    code,
    message: 'Checkout rejected.',
  });
});

test('keeps an unverified rejection uncertain', async () => {
  reply(400, { error: { code: 'UNRECOGNISED', message: 'Rejected.' } });
  await expect(submitCheckout(payload)).rejects.not.toBeInstanceOf(CheckoutRejectedError);
});

test('propagates network failures', async () => {
  mockFetch.mockRejectedValue(new Error('Offline'));
  await expect(submitCheckout(payload)).rejects.toThrow('Offline');
});

test('validates a price-conflict response and exposes the current store', async () => {
  reply(409, { error: { code: 'PRICE_CHANGED', message: 'Price changed.' }, store });
  const result = submitCheckout(payload);
  await expect(result).rejects.toBeInstanceOf(PriceChangedError);
  await expect(result).rejects.toHaveProperty('store', store);
});

test.each([{}, { ...store, id: 'a-different-store' }])(
  'keeps invalid price refresh responses uncertain',
  async (updatedStore) => {
    reply(409, {
      error: { code: 'PRICE_CHANGED', message: 'Price changed.' },
      store: updatedStore,
    });
    const result = submitCheckout(payload);
    await expect(result).rejects.not.toBeInstanceOf(PriceChangedError);
    await expect(result).rejects.not.toBeInstanceOf(CheckoutRejectedError);
  },
);

test('validates changed quantity limits and exposes the current store', async () => {
  const updatedStore = { ...store, checkoutItems: [{ ...store.checkoutItems[0], maxQuantity: 1 }] };
  reply(400, {
    error: { code: 'INVALID_CHECKOUT', message: 'Bag quantity is outside the store limits.' },
    store: updatedStore,
  });
  const result = submitCheckout(payload);
  await expect(result).rejects.toBeInstanceOf(QuantityChangedError);
  await expect(result).rejects.toHaveProperty('store', updatedStore);
});

test.each([{}, { ...store, id: 'a-different-store' }])(
  'keeps invalid quantity refresh responses uncertain',
  async (updatedStore) => {
    reply(400, {
      error: { code: 'INVALID_CHECKOUT', message: 'Invalid quantity.' },
      store: updatedStore,
    });
    const result = submitCheckout(payload);
    await expect(result).rejects.not.toBeInstanceOf(QuantityChangedError);
    await expect(result).rejects.not.toBeInstanceOf(CheckoutRejectedError);
  },
);

test.each(['processing', 'succeeded', 'declined', 'unknown'])(
  'recovers %s with a GET request',
  async (status) => {
    reply(200, { ...success, status });
    expect((await getCheckoutStatus(payload.checkoutId)).status).toBe(status);
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  },
);

test('distinguishes a validated missing checkout from uncertainty', async () => {
  reply(404, { error: { code: 'NOT_FOUND', message: 'Checkout not found.' } });
  await expect(getCheckoutStatus(payload.checkoutId)).rejects.toBeInstanceOf(CheckoutNotFoundError);
  reply(404, {});
  await expect(getCheckoutStatus(payload.checkoutId)).rejects.not.toBeInstanceOf(
    CheckoutNotFoundError,
  );
});

test.each([
  { status: 'succeeded' },
  { ...success, checkoutId: '33333333-3333-4333-8333-333333333333' },
])('rejects malformed or unrelated status results', async (body) => {
  reply(200, body);
  await expect(getCheckoutStatus(payload.checkoutId)).rejects.toThrow();
});

test.each(['submit', 'status'])(
  'aborts a stalled %s request after 25 seconds',
  async (operation) => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(
      (_url, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        }),
    );
    const result =
      operation === 'submit' ? submitCheckout(payload) : getCheckoutStatus(payload.checkoutId);
    const rejection = expect(result).rejects.toThrow('Aborted');
    jest.advanceTimersByTime(24_999);
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await rejection;
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  },
);
