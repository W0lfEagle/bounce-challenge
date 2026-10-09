import { apiErrorSchema, checkoutRequestSchema, checkoutResponseSchema, priceChangedResponseSchema, type CheckoutRequest, type Store } from '@bounce/contracts';
import { apiUrl } from './config';

export class PriceChangedError extends Error {
  constructor(public readonly store: Store) {
    super('The price has changed.');
    this.name = 'PriceChangedError';
  }
}

export async function submitCheckout(checkout: CheckoutRequest, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${apiUrl}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutRequestSchema.parse(checkout)),
    signal,
  });
  const body: unknown = await response.json();
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
  checkoutResponseSchema.parse(body);
}
