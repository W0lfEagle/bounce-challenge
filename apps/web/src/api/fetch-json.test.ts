import { fetchJson } from './fetch-json';

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

function stallUntilAborted() {
  mockFetch.mockImplementation(
    (_url, { signal }: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }),
  );
}

test('aborts a stalled request at its deadline without cancelling its caller', async () => {
  stallUntilAborted();
  const caller = new AbortController();
  const result = fetchJson('/test', { signal: caller.signal }, 1000);
  const rejection = expect(result).rejects.toThrow('Aborted');
  const requestSignal = mockFetch.mock.calls[0][1].signal;
  jest.advanceTimersByTime(999);
  expect(requestSignal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  await rejection;
  expect(requestSignal.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
});

test('forwards cancellation to the in-flight request and clears its deadline', async () => {
  stallUntilAborted();
  const caller = new AbortController();
  const result = fetchJson('/test', { signal: caller.signal }, 1000);
  const rejection = expect(result).rejects.toThrow('Aborted');
  caller.abort();
  await rejection;
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('does not start a request when its caller has already cancelled', async () => {
  const caller = new AbortController();
  caller.abort();
  await expect(fetchJson('/test', { signal: caller.signal }, 1000)).rejects.toThrow(
    'Request cancelled.',
  );
  expect(mockFetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('keeps the deadline active while the response body is being read', async () => {
  mockFetch.mockImplementation((_url, { signal }: RequestInit) =>
    Promise.resolve({
      json: () =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Body aborted')), {
            once: true,
          });
        }),
    }),
  );
  const result = fetchJson('/test', {}, 1000);
  const rejection = expect(result).rejects.toThrow('Body aborted');
  await Promise.resolve();
  jest.advanceTimersByTime(1000);
  await rejection;
});

test('removes the deadline and cancellation listener after success', async () => {
  mockFetch.mockResolvedValue({ json: async () => ({ hello: 'world' }) });
  const caller = new AbortController();
  expect((await fetchJson('/test', { signal: caller.signal }, 1000)).body).toEqual({
    hello: 'world',
  });
  expect(jest.getTimerCount()).toBe(0);
  caller.abort();
  jest.advanceTimersByTime(1000);
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false);
});

test('clears its deadline when JSON parsing fails', async () => {
  mockFetch.mockResolvedValue({
    json: async () => {
      throw new SyntaxError('Invalid JSON');
    },
  });
  await expect(fetchJson('/test', {}, 1000)).rejects.toThrow('Invalid JSON');
  expect(jest.getTimerCount()).toBe(0);
});
