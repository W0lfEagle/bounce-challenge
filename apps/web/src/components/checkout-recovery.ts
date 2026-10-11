import type { CheckoutResponse } from '@bounce/contracts';
import { getCheckoutStatus } from '../api/checkout';
import { apiUrl } from '../api/config';

const statusCheckIntervalMs = 1000;
const recoveryTimeoutMs = 30_000;

function waitForStatus(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, statusCheckIntervalMs);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Poll existing payment status only; deciding whether to retry belongs to checkout. */
export async function waitForCheckoutResult(
  checkoutId: string,
  signal: AbortSignal,
  onProcessing: (result: CheckoutResponse) => void,
  baseUrl = apiUrl,
): Promise<CheckoutResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, recoveryTimeoutMs);
  let sawProcessing = false;

  try {
    while (!controller.signal.aborted) {
      let result: CheckoutResponse;
      try {
        result = await getCheckoutStatus(checkoutId, controller.signal, baseUrl);
      } catch (error) {
        if (controller.signal.aborted) break;
        if (!sawProcessing) throw error;
        // A transient status-read failure doesn't end an active payment.
        await waitForStatus(controller.signal);
        continue;
      }
      if (controller.signal.aborted) break;
      if (result.status !== 'processing') return result;
      sawProcessing = true;
      onProcessing(result);
      await waitForStatus(controller.signal);
    }
    throw new Error('Payment status could not be confirmed.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
