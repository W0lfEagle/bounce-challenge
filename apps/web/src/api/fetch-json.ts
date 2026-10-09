/** One deadline covers the connection and response body; callers choose the budget. */
export async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const { signal, ...options } = init;
  if (signal?.aborted) throw new Error('Request cancelled.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body: unknown = await response.json();
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
