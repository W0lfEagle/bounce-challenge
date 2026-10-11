import { paymentTimeoutMs, processPayment } from './payments';

const input = {
  name: 'Test User',
  email: 'test@example.com',
  amount: 1180,
  currency: 'USD',
  cardNumber: '4111111111111111',
};
const transaction = {
  transaction_id: 'txn_test',
  status: 'completed',
  amount: 1180,
  currency: 'USD',
  last_four_digits: '1111',
  payment_method: 'credit_card',
  timestamp: '2026-10-09T16:00:00Z',
  merchant_reference: 'REF_TEST',
  processing_fee: 25,
};
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('sends integer cents and documented fields, then validates success', async () => {
  mockFetch.mockResolvedValue({ status: 200, json: async () => transaction });
  expect(await processPayment(input)).toEqual({ status: 'succeeded', transaction });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
    name: input.name,
    email: input.email,
    amount: 1180,
    currency: 'USD',
    card_number: input.cardNumber,
  });
  expect(mockFetch.mock.calls[0][1].redirect).toBe('error');
});

test('discards unexpected provider fields before returning transaction metadata', async () => {
  mockFetch.mockResolvedValue({
    status: 200,
    json: async () => ({ ...transaction, card_number: input.cardNumber }),
  });
  const result = await processPayment(input);
  expect(result).toEqual({ status: 'succeeded', transaction });
  expect(JSON.stringify(result)).not.toContain(input.cardNumber);
});

test.each([
  { label: 'top-level', body: { error_code: 'CARD_DECLINED', detail: 'Declined.' } },
  { label: 'wrapped', body: { detail: { error_code: 'CARD_DECLINED', detail: 'Declined.' } } },
])('recognizes a validated $label decline envelope', async ({ body }) => {
  mockFetch.mockResolvedValue({ status: 400, json: async () => body });
  expect(await processPayment(input)).toEqual({ status: 'declined', errorCode: 'CARD_DECLINED' });
});

test.each([
  { label: 'wrong amount', status: 200, body: { ...transaction, amount: 9999 } },
  { label: 'wrong card', status: 200, body: { ...transaction, last_four_digits: '1234' } },
  { label: 'wrong currency', status: 200, body: { ...transaction, currency: 'EUR' } },
  { label: 'incomplete transaction', status: 200, body: {} },
  {
    label: 'unfamiliar payment status',
    status: 200,
    body: { ...transaction, status: 'processing' },
  },
  { label: 'malformed decline', status: 400, body: {} },
  { label: 'empty decline code', status: 400, body: { detail: 'Failed', error_code: '' } },
  { label: 'provider failure', status: 500, body: {} },
])('keeps $label unknown without retrying', async ({ status, body }) => {
  mockFetch.mockResolvedValue({ status, json: async () => body });
  expect(await processPayment(input)).toMatchObject({
    status: 'unknown',
    errorCode: expect.any(String),
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('keeps a transport failure unknown without retrying', async () => {
  mockFetch.mockRejectedValue(new Error('Connection lost'));
  expect(await processPayment(input)).toEqual({
    status: 'unknown',
    errorCode: 'PROVIDER_NETWORK_ERROR',
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('aborts a stalled provider request at its deadline without retrying', async () => {
  const createTimeoutSignal = AbortSignal.timeout.bind(AbortSignal);
  const timeout = jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation(() => createTimeoutSignal(5));
  let requestSignal: AbortSignal | undefined;
  mockFetch.mockImplementation((_url: unknown, options: { signal: AbortSignal }) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });

  expect(await processPayment(input)).toEqual({ status: 'unknown', errorCode: 'PROVIDER_TIMEOUT' });
  expect(timeout).toHaveBeenCalledWith(paymentTimeoutMs);
  expect(requestSignal?.aborted).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each([
  { label: 'details omitted', body: {} },
  { label: 'empty details', body: { detail: [] } },
  {
    label: 'field details',
    body: { detail: [{ loc: ['body', 'email', 0], msg: 'Invalid', type: 'value_error' }] },
  },
])('recognizes a documented validation rejection with $label', async ({ body }) => {
  mockFetch.mockResolvedValue({
    status: 422,
    json: async () => body,
  });
  expect(await processPayment(input)).toEqual({
    status: 'declined',
    errorCode: 'PAYMENT_VALIDATION_FAILED',
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each([
  null,
  [],
  { detail: null },
  { detail: 'Invalid' },
  { detail: [{}] },
  { detail: [{ loc: ['body', 0.5], msg: 'Invalid', type: 'value_error' }] },
])('keeps a malformed validation rejection unknown: %j', async (body) => {
  mockFetch.mockResolvedValue({ status: 422, json: async () => body });
  expect(await processPayment(input)).toEqual({
    status: 'unknown',
    errorCode: 'INVALID_PROVIDER_RESPONSE',
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each(Object.keys(transaction))(
  'requires transaction metadata %s before confirming',
  async (field) => {
    const body: Record<string, unknown> = { ...transaction };
    delete body[field];
    mockFetch.mockResolvedValue({ status: 200, json: async () => body });
    expect(await processPayment(input)).toEqual({
      status: 'unknown',
      errorCode: 'INVALID_PROVIDER_RESPONSE',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  },
);

test.each([201, 202, 204, 302, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504])(
  'keeps undocumented HTTP %i unknown even with a valid transaction body',
  async (status) => {
    mockFetch.mockResolvedValue({ status, json: async () => transaction });
    expect(await processPayment(input)).toEqual({
      status: 'unknown',
      errorCode: 'UNEXPECTED_PROVIDER_STATUS',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  },
);

test('the provider deadline also aborts a stalled response body', async () => {
  const createTimeoutSignal = AbortSignal.timeout.bind(AbortSignal);
  jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => createTimeoutSignal(5));
  mockFetch.mockImplementation((_url: unknown, options: { signal: AbortSignal }) => ({
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      }),
  }));
  expect(await processPayment(input)).toEqual({ status: 'unknown', errorCode: 'PROVIDER_TIMEOUT' });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each([200, 400, 422, 503])(
  'records a safe diagnostic category for invalid JSON with HTTP %i',
  async (status) => {
    mockFetch.mockResolvedValue({
      status,
      json: async () => {
        throw new SyntaxError('Not JSON');
      },
    });
    expect(await processPayment(input)).toEqual({
      status: 'unknown',
      errorCode: 'INVALID_PROVIDER_RESPONSE',
    });
  },
);
