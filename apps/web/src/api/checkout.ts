import { apiErrorSchema, checkoutRequestSchema, checkoutResponseSchema, priceChangedResponseSchema, type CheckoutRequest, type CheckoutResponse, type Store } from '@bounce/contracts';
import { apiUrl } from './config';

export class PriceChangedError extends Error {
  constructor(public readonly store: Store) {
    super('The price has changed.');
    this.name = 'PriceChangedError';
  }
}

export class CheckoutNotFoundError extends Error {}

async function requestCheckout(url: string, init: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 25000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body: unknown = await response.json();
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function submitCheckout(checkout: CheckoutRequest, signal?: AbortSignal): Promise<CheckoutResponse> {
  const { response, body } = await requestCheckout(`${apiUrl}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutRequestSchema.parse(checkout)),
  }, signal);
  if (!response.ok) {
    if (response.status === 409) {
      const priceChange = priceChangedResponseSchema.safeParse(body);
      if (priceChange.success && priceChange.data.store.id === checkout.storeId) {
        throw new PriceChangedError(priceChange.data.store);
      }
    }
    const error = apiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error.message : 'Unable to complete checkout.');
  }
  const result = checkoutResponseSchema.parse(body);
  if (result.checkoutId !== checkout.checkoutId) throw new Error('Unexpected checkout result.');
  return result;
}

export async function getCheckoutStatus(checkoutId: string, signal?: AbortSignal): Promise<CheckoutResponse> {
  const { response, body } = await requestCheckout(`${apiUrl}/checkout/${encodeURIComponent(checkoutId)}`, { method: 'GET' }, signal);
  if (response.status === 404) throw new CheckoutNotFoundError('Checkout not found.');
  if (!response.ok) throw new Error('Unable to check payment status.');
  const result = checkoutResponseSchema.parse(body);
  if (result.checkoutId !== checkoutId) throw new Error('Unexpected checkout result.');
  return result;
}
