import { fetchStore } from './store-api';

const store = {
  id: 'codys-cookie-store', name: "Cody's Cookie Store", currency: 'USD',
  checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 }],
};

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => { globalThis.fetch = mockFetch; mockFetch.mockReset(); });
afterAll(() => { globalThis.fetch = originalFetch; });

test('validates and returns a successful response', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => store });
  await expect(fetchStore('codys-cookie-store')).resolves.toEqual(store);
});

test.each([
  { ...store, currency: 'EUR' },
  { ...store, checkoutItems: [{ ...store.checkoutItems[0], unitPriceCents: 5.9 }] },
  { ...store, checkoutItems: [{ ...store.checkoutItems[0], minQuantity: 11 }] },
])('rejects a response that violates the shared contract', async (body) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => body });
  await expect(fetchStore('codys-cookie-store')).rejects.toThrow('could not be verified');
});

test('handles API errors without accepting their body as store data', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'NOT_FOUND', message: 'Store not found.' } }) });
  await expect(fetchStore('missing-store')).rejects.toThrow('Store not found.');
});

test('propagates network failure', async () => {
  mockFetch.mockRejectedValue(new Error('Offline'));
  await expect(fetchStore('codys-cookie-store')).rejects.toThrow('Offline');
});
