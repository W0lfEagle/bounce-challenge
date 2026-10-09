import { CheckoutNotFoundError, PriceChangedError, getCheckoutStatus, submitCheckout } from './checkout';

const payload = { checkoutId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', storeId: 'codys-cookie-store', items: [{ itemId: 'bag' as const, quantity: 2 }], expectedTotalCents: 1180, currency: 'USD', name: ' Test User ', email: ' test@example.com ', cardNumber: '4111 1111 1111 1111' };
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => { globalThis.fetch = mockFetch; mockFetch.mockReset(); });
afterAll(() => { globalThis.fetch = originalFetch; });

test('posts normalised details and quantity as JSON', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ checkoutId: payload.checkoutId, attemptId: payload.attemptId, status: 'succeeded' }) });
  await submitCheckout(payload);
  const [url, request] = mockFetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:3000/checkout');
  expect(request.method).toBe('POST');
  expect(JSON.parse(request.body)).toEqual({ ...payload, name: 'Test User', email: 'test@example.com', cardNumber: '4111111111111111' });
});

test('rejects malformed success responses', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'failed' }) });
  await expect(submitCheckout(payload)).rejects.toThrow();
});

test('rejects API errors', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'INVALID_CHECKOUT', message: 'Invalid checkout details.' } }) });
  await expect(submitCheckout(payload)).rejects.toThrow('Invalid checkout details.');
});

test('propagates network failures', async () => {
  mockFetch.mockRejectedValue(new Error('Offline'));
  await expect(submitCheckout(payload)).rejects.toThrow('Offline');
});

test('validates a price-conflict response and exposes the current store', async () => {
  const store = { id: payload.storeId, name: "Cody's Cookie Store", currency: 'USD', checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 700, minQuantity: 1, maxQuantity: 10 }] };
  mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: 'PRICE_CHANGED', message: 'Price changed.' }, store }) });
  await expect(submitCheckout(payload)).rejects.toBeInstanceOf(PriceChangedError);
});

test('does not refresh pricing from an invalid conflict response', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: 'PRICE_CHANGED', message: 'Price changed.' }, store: {} }) });
  await expect(submitCheckout(payload)).rejects.not.toBeInstanceOf(PriceChangedError);
});

test('recovers status with a GET request and distinguishes a missing checkout', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ checkoutId: payload.checkoutId, attemptId: payload.attemptId, status: 'succeeded' }) });
  expect((await getCheckoutStatus(payload.checkoutId)).status).toBe('succeeded');
  expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
  await expect(getCheckoutStatus(payload.checkoutId)).rejects.toBeInstanceOf(CheckoutNotFoundError);
});
