import { CheckoutNotFoundError, getCheckoutStatus } from '../api/checkout';
import type { CheckoutResponse } from '@bounce/contracts';
import { waitForCheckoutResult } from './checkout-recovery';

jest.mock('../api/checkout', () => ({
  ...jest.requireActual('../api/checkout'),
  getCheckoutStatus: jest.fn(),
}));

const mockGetStatus = jest.mocked(getCheckoutStatus);
const ids = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
};
const processing: CheckoutResponse = { ...ids, status: 'processing' };
const success: CheckoutResponse = { ...ids, status: 'succeeded' };

beforeEach(() => {
  mockGetStatus.mockReset();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test('returns an already completed result without calling the processing callback', async () => {
  mockGetStatus.mockResolvedValue(success);
  const caller = new AbortController();
  const onProcessing = jest.fn();

  expect(await waitForCheckoutResult(ids.checkoutId, caller.signal, onProcessing)).toEqual(success);
  expect(onProcessing).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  caller.abort();
  expect(mockGetStatus.mock.calls[0][1]?.aborted).toBe(false);
});

test('reports processing responses once per status read and returns the terminal result', async () => {
  mockGetStatus
    .mockResolvedValueOnce(processing)
    .mockResolvedValueOnce(processing)
    .mockResolvedValueOnce(success);
  const onProcessing = jest.fn();
  const result = waitForCheckoutResult(ids.checkoutId, new AbortController().signal, onProcessing);

  await jest.advanceTimersByTimeAsync(2000);

  expect(await result).toEqual(success);
  expect(onProcessing).toHaveBeenCalledTimes(2);
  expect(onProcessing).toHaveBeenNthCalledWith(1, processing);
  expect(onProcessing).toHaveBeenNthCalledWith(2, processing);
  expect(mockGetStatus).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});

test('propagates an initial missing record unchanged so checkout can decide whether replay is safe', async () => {
  const missing = new CheckoutNotFoundError('Checkout not found.');
  mockGetStatus.mockRejectedValue(missing);

  await expect(
    waitForCheckoutResult(ids.checkoutId, new AbortController().signal, jest.fn()),
  ).rejects.toBe(missing);

  expect(mockGetStatus).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('retries a failed status read after observing processing without reporting a new payment', async () => {
  mockGetStatus
    .mockResolvedValueOnce(processing)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(success);
  const onProcessing = jest.fn();
  const result = waitForCheckoutResult(ids.checkoutId, new AbortController().signal, onProcessing);

  await jest.advanceTimersByTimeAsync(2000);

  expect(await result).toEqual(success);
  expect(onProcessing).toHaveBeenCalledTimes(1);
  expect(mockGetStatus).toHaveBeenCalledTimes(3);
});

test('ends unresolved processing at the 30-second deadline and clears waiting timers', async () => {
  mockGetStatus.mockResolvedValue(processing);
  const caller = new AbortController();
  const result = waitForCheckoutResult(ids.checkoutId, caller.signal, jest.fn());
  const rejection = expect(result).rejects.toThrow('Payment status could not be confirmed.');

  await jest.advanceTimersByTimeAsync(29_999);
  expect(mockGetStatus.mock.calls[0][1]?.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejection;

  expect(mockGetStatus.mock.calls[0][1]?.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

function stallStatusUntilAborted() {
  mockGetStatus.mockImplementation(
    (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Transport aborted')), {
          once: true,
        });
      }),
  );
}

test('aborts a stalled GET at the recovery deadline', async () => {
  stallStatusUntilAborted();
  const result = waitForCheckoutResult(ids.checkoutId, new AbortController().signal, jest.fn());
  const rejection = expect(result).rejects.toThrow('Payment status could not be confirmed.');

  await jest.advanceTimersByTimeAsync(30_000);
  await rejection;

  expect(mockGetStatus.mock.calls[0][1]?.aborted).toBe(true);
  expect(mockGetStatus).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('cancels while waiting between GET requests without making another request', async () => {
  mockGetStatus.mockResolvedValue(processing);
  const caller = new AbortController();
  const onProcessing = jest.fn();
  const result = waitForCheckoutResult(ids.checkoutId, caller.signal, onProcessing);
  const rejection = expect(result).rejects.toThrow('Payment status could not be confirmed.');
  await Promise.resolve();

  caller.abort();
  await rejection;
  await jest.advanceTimersByTimeAsync(2000);

  expect(onProcessing).toHaveBeenCalledTimes(1);
  expect(mockGetStatus).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('forwards cancellation to a pending GET and removes its deadline', async () => {
  stallStatusUntilAborted();
  const caller = new AbortController();
  const result = waitForCheckoutResult(ids.checkoutId, caller.signal, jest.fn());
  const rejection = expect(result).rejects.toThrow('Payment status could not be confirmed.');

  caller.abort();
  await rejection;

  expect(mockGetStatus.mock.calls[0][1]?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('ignores a late terminal result after cancellation even if the GET resolves instead of aborting', async () => {
  let resolveStatus!: (result: CheckoutResponse) => void;
  mockGetStatus.mockReturnValue(
    new Promise((resolve) => {
      resolveStatus = resolve;
    }),
  );
  const caller = new AbortController();
  const onProcessing = jest.fn();
  const result = waitForCheckoutResult(ids.checkoutId, caller.signal, onProcessing);
  const rejection = expect(result).rejects.toThrow('Payment status could not be confirmed.');

  caller.abort();
  resolveStatus(success);
  await rejection;

  expect(onProcessing).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('does not make a status request after its caller has already cancelled', async () => {
  const caller = new AbortController();
  caller.abort();

  await expect(waitForCheckoutResult(ids.checkoutId, caller.signal, jest.fn())).rejects.toThrow(
    'Payment status could not be confirmed.',
  );

  expect(mockGetStatus).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
