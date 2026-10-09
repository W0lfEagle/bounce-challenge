import { processPayment } from './payments';

const input = { name: 'Test User', email: 'test@example.com', amount: 1180, currency: 'USD', cardNumber: '4111111111111111' };
const transaction = { transaction_id: 'txn_test', status: 'completed', amount: 1180, currency: 'USD', last_four_digits: '1111', payment_method: 'credit_card', timestamp: '2026-10-09T16:00:00Z', merchant_reference: 'REF_TEST', processing_fee: 25 };
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => { globalThis.fetch = mockFetch; mockFetch.mockReset(); });
afterAll(() => { globalThis.fetch = originalFetch; });

test('sends integer cents and the documented field names and validates success', async () => {
  mockFetch.mockResolvedValue({ status: 200, json: async () => transaction });
  expect(await processPayment(input)).toEqual({ status: 'succeeded', transaction });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ name: input.name, email: input.email, amount: 1180, currency: 'USD', card_number: input.cardNumber });
  expect(mockFetch.mock.calls[0][1].redirect).toBe('error');
});

test('recognises an explicit provider decline', async () => {
  mockFetch.mockResolvedValue({ status: 400, json: async () => ({ error_code: 'CARD_DECLINED', detail: 'Declined.' }) });
  expect(await processPayment(input)).toEqual({ status: 'declined', errorCode: 'CARD_DECLINED' });
});

test.each([
  { status: 200, body: { ...transaction, amount: 9999 } },
  { status: 200, body: { ...transaction, last_four_digits: '1234' } },
  { status: 200, body: { ...transaction, currency: 'EUR' } },
  { status: 200, body: {} },
  { status: 400, body: {} },
  { status: 500, body: {} },
])('treats an unverified response as unknown and never retries', async ({ status, body }) => {
  mockFetch.mockResolvedValue({ status, json: async () => body });
  expect(await processPayment(input)).toMatchObject({ status: 'unknown', errorCode: expect.any(String) });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('treats transport errors/timeouts as unknown without retrying', async () => {
  mockFetch.mockRejectedValue(new Error('Connection lost'));
  expect(await processPayment(input)).toEqual({ status: 'unknown', errorCode: 'PROVIDER_NETWORK_ERROR' });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('recognises the documented validation rejection as a failed attempt', async () => {
  mockFetch.mockResolvedValue({ status: 422, json: async () => ({ detail: [{ loc: ['body', 'email'], msg: 'Invalid', type: 'value_error' }] }) });
  expect(await processPayment(input)).toEqual({ status: 'declined', errorCode: 'PAYMENT_VALIDATION_FAILED' });
});

test('recognises a strictly validated wrapped decline instead of making it permanently unknown', async () => {
  mockFetch.mockResolvedValue({ status: 400, json: async () => ({ detail: { error_code: 'CARD_DECLINED', detail: 'Declined.' } }) });
  expect(await processPayment(input)).toEqual({ status: 'declined', errorCode: 'CARD_DECLINED' });
});

test('records safe diagnostic categories for timeouts and invalid JSON', async () => {
  const timeout = new Error('Request timed out');
  timeout.name = 'TimeoutError';
  mockFetch.mockRejectedValueOnce(timeout);
  expect(await processPayment(input)).toEqual({ status: 'unknown', errorCode: 'PROVIDER_TIMEOUT' });
  mockFetch.mockResolvedValueOnce({ status: 200, json: async () => { throw new SyntaxError('Not JSON'); } });
  expect(await processPayment(input)).toEqual({ status: 'unknown', errorCode: 'INVALID_PROVIDER_RESPONSE' });
});
