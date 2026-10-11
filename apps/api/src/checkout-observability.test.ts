import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app';
import { openDatabase } from './database';
import { loggerOptions } from './logging';
import { processPayment, type PaymentResult, type ProcessPayment } from './payments';

const payload = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  storeId: 'codys-cookie-store',
  items: [{ itemId: 'bag', quantity: 2 }],
  expectedTotalCents: 1180,
  currency: 'USD',
  name: 'Sensitive Customer',
  email: 'sensitive@example.com',
  cardNumber: '4111111111111111',
};
const success = {
  status: 'succeeded',
  transaction: {
    transaction_id: 'txn_test',
    status: 'completed',
    amount: 1180,
    currency: 'USD',
    last_four_digits: '1111',
    payment_method: 'credit_card',
    timestamp: '2026-10-10T12:00:00Z',
    merchant_reference: 'REF_TEST',
    processing_fee: 25,
  },
} satisfies PaymentResult;
const pay = jest.fn<ReturnType<ProcessPayment>, Parameters<ProcessPayment>>();
let app: ReturnType<typeof buildApp>;
let db: ReturnType<typeof openDatabase>;
let directory: string;
let lines: string[];

function events() {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bounce-logs-'));
  lines = [];
  pay.mockReset().mockResolvedValue(success);
  const databasePath = join(directory, 'test.sqlite');
  app = buildApp({
    databasePath,
    pay,
    logger: {
      ...loggerOptions,
      stream: {
        write(line: string) {
          lines.push(line);
        },
      },
      serializers: {
        req(request) {
          return { method: request.method, url: request.url, headers: request.headers };
        },
      },
    },
  });
  db = openDatabase(databasePath);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('correlates provider and persisted outcomes, and logs replay without another payment', async () => {
  await app.inject({ method: 'POST', url: '/checkout', payload });
  await app.inject({ method: 'POST', url: '/checkout', payload });
  await app.inject(`/checkout/${payload.checkoutId}`);
  expect(events().map((event) => event.event)).toEqual([
    'checkout.attempt_claimed',
    'payment.result',
    'checkout.result_persisted',
    'checkout.attempt_replayed',
  ]);
  for (const event of events()) {
    expect(event).toMatchObject({
      checkoutId: payload.checkoutId,
      attemptId: payload.attemptId,
      reqId: expect.any(String),
    });
  }
  expect(events()[1]).toMatchObject({
    status: 'succeeded',
    level: 30,
    durationMs: expect.any(Number),
  });
  expect(pay).toHaveBeenCalledTimes(1);
});

test.each([
  {
    result: { status: 'declined', errorCode: payload.email } as PaymentResult,
    diagnosticCode: 'PAYMENT_DECLINED',
    level: 30,
  },
  {
    result: { status: 'declined', errorCode: 'PAYMENT_VALIDATION_FAILED' } as PaymentResult,
    diagnosticCode: 'PAYMENT_VALIDATION_FAILED',
    level: 40,
  },
  {
    result: { status: 'unknown', errorCode: 'PROVIDER_TIMEOUT' } as PaymentResult,
    diagnosticCode: 'PROVIDER_TIMEOUT',
    level: 40,
  },
  {
    result: { status: 'unknown', errorCode: payload.cardNumber } as PaymentResult,
    diagnosticCode: 'PAYMENT_OUTCOME_UNKNOWN',
    level: 40,
  },
])('logs a bounded $diagnosticCode category', async ({ result, diagnosticCode, level }) => {
  pay.mockResolvedValue(result);
  await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(events().find((event) => event.event === 'payment.result')).toMatchObject({
    diagnosticCode,
    level,
    status: result.status,
  });
  for (const value of [payload.name, payload.email, payload.cardNumber]) {
    expect(lines.join('')).not.toContain(value);
  }
});

test('excludes customer data, transaction metadata, raw errors and secret headers', async () => {
  const secret = 'private-header-token';
  pay.mockRejectedValue(new Error(`${payload.cardNumber} ${payload.email}`));
  await app.inject({
    method: 'POST',
    url: '/checkout',
    payload,
    headers: { authorization: secret, cookie: secret },
  });
  app.log.info(
    { ...payload, body: payload, req: { body: payload }, signature: JSON.stringify(payload) },
    'Redaction guard checked.',
  );
  for (const value of [payload.name, payload.email, payload.cardNumber, secret]) {
    expect(lines.join('')).not.toContain(value);
  }
  expect(lines.join('')).toContain('[REDACTED]');
  expect(events().find((event) => event.event === 'payment.result')).toMatchObject({
    diagnosticCode: 'PROVIDER_REQUEST_FAILED',
  });
});

test('records provider success before a failed confirmation write and the saved unknown fallback', async () => {
  db.exec(`CREATE TRIGGER fail_confirmation BEFORE UPDATE ON bookings
    WHEN NEW.status = 'confirmed'
    BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);
  const response = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(response.json().status).toBe('unknown');
  expect(events().map((event) => event.event)).toEqual([
    'checkout.attempt_claimed',
    'payment.result',
    'checkout.persistence_failed',
    'checkout.result_persisted',
  ]);
  expect(events()[1]).toMatchObject({ status: 'succeeded' });
  expect(events()[2]).toMatchObject({
    level: 50,
    providerOutcome: 'succeeded',
    diagnosticCode: 'PAYMENT_PERSISTENCE_FAILED',
  });
  expect(events()[3]).toMatchObject({ status: 'unknown' });
  expect(lines.join('')).not.toContain('txn_test');
  expect(lines.join('')).not.toContain('REF_TEST');
});

test('a failed unknown fallback is logged without exposing the database exception', async () => {
  db.exec(`CREATE TRIGGER fail_result BEFORE UPDATE ON payment_attempts
    BEGIN SELECT RAISE(ABORT, '${payload.cardNumber}'); END`);
  const response = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(response.statusCode).toBe(500);
  expect(events().map((event) => event.event)).toContain('checkout.persistence_failed');
  expect(events().map((event) => event.event)).toContain('request.failed');
  expect(events().map((event) => event.event)).not.toContain('checkout.result_persisted');
  expect(lines.join('')).not.toContain(payload.cardNumber);
  expect(db.prepare('SELECT status FROM payment_attempts').get()).toEqual({ status: 'processing' });
});

test('logs stale detection once across repeated status reads without calling the provider', async () => {
  pay.mockResolvedValue({ status: 'declined', errorCode: 'CARD_DECLINED' });
  await app.inject({ method: 'POST', url: '/checkout', payload });
  db.prepare("UPDATE payment_attempts SET status = 'processing', created_at = ?").run(
    Date.now() - 60_000,
  );
  await app.inject(`/checkout/${payload.checkoutId}`);
  await app.inject(`/checkout/${payload.checkoutId}`);
  expect(events().filter((event) => event.event === 'checkout.attempt_stale')).toEqual([
    expect.objectContaining({
      checkoutId: payload.checkoutId,
      attemptId: payload.attemptId,
      diagnosticCode: 'STALE_ATTEMPT',
      level: 40,
    }),
  ]);
  expect(pay).toHaveBeenCalledTimes(1);
});

test('a valid empty 422 rejection traverses the real adapter and permits a deliberate new attempt', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  fetch.mockResolvedValueOnce(new Response('{}', { status: 422 }));
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(success.transaction), { status: 200 }));
  pay.mockImplementation(processPayment);
  const first = await app.inject({ method: 'POST', url: '/checkout', payload });
  expect(first.json().status).toBe('declined');
  expect(db.prepare('SELECT error_code FROM payment_attempts').get()).toEqual({
    error_code: 'PAYMENT_VALIDATION_FAILED',
  });
  const second = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: { ...payload, attemptId: '33333333-3333-4333-8333-333333333333' },
  });
  expect(second.json().status).toBe('succeeded');
  expect(db.prepare('SELECT status FROM bookings').get()).toEqual({ status: 'confirmed' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
