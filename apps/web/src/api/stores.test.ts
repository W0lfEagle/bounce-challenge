import { fetchStore } from './stores';

const store = {
  id: 'codys-cookie-store',
  name: "Cody's Cookie Store",
  currency: 'USD',
  checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 }],
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

test('validates and returns a successful response', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => store });
  await expect(fetchStore('codys-cookie-store')).resolves.toEqual(store);
});

test('routes store requests to an explicitly selected backend', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => store });
  await fetchStore(store.id, undefined, 'http://127.0.0.1:3001');
  expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:3001/stores/codys-cookie-store');
});

test.each([
  { ...store, currency: 'EUR' },
  { ...store, checkoutItems: [{ ...store.checkoutItems[0], unitPriceCents: 5.9 }] },
  { ...store, checkoutItems: [{ ...store.checkoutItems[0], minQuantity: 11 }] },
  { ...store, id: 'a-different-store' },
])('rejects a response that violates the shared contract', async (body) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => body });
  await expect(fetchStore('codys-cookie-store')).rejects.toThrow('could not be verified');
});

test('handles API errors without accepting their body as store data', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => ({ error: { code: 'NOT_FOUND', message: 'Store not found.' } }),
  });
  await expect(fetchStore('missing-store')).rejects.toThrow('Store not found.');
});

test('propagates network failure', async () => {
  mockFetch.mockRejectedValue(new Error('Offline'));
  await expect(fetchStore('codys-cookie-store')).rejects.toThrow('Offline');
});

test('aborts a stalled store request after ten seconds so the loading screen can offer retry', async () => {
  jest.useFakeTimers();
  mockFetch.mockImplementation(
    (_url, { signal }: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }),
  );
  const result = fetchStore(store.id);
  const rejection = expect(result).rejects.toThrow('Aborted');
  jest.advanceTimersByTime(9999);
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  await rejection;
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
});
