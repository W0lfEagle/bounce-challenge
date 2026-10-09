import {
  apiErrorSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  priceChangedResponseSchema,
  quantityChangedResponseSchema,
  type ApiError,
  type CheckoutRequest,
  type CheckoutResponse,
  type Store,
} from '@bounce/contracts';
import { apiUrl } from './config';
import { fetchJson } from './fetch-json';

export class PriceChangedError extends Error {
  constructor(public readonly store: Store) {
    super('The price has changed.');
    this.name = 'PriceChangedError';
  }
}

export class CheckoutNotFoundError extends Error {}

export class QuantityChangedError extends Error {
  constructor(public readonly store: Store) {
    super('The available bag quantities have changed.');
    this.name = 'QuantityChangedError';
  }
}

export class CheckoutRejectedError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiError['error']['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutRejectedError';
  }
}

export async function submitCheckout(
  checkout: CheckoutRequest,
  signal?: AbortSignal,
): Promise<CheckoutResponse> {
  const { response, body } = await fetchJson(
    `${apiUrl}/checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutRequestSchema.parse(checkout)),
      signal,
    },
    25_000,
  );
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (!error.success) throw new Error('Unable to verify the checkout response.');
    if (response.status === 409 && error.data.error.code === 'PRICE_CHANGED') {
      const priceChange = priceChangedResponseSchema.safeParse(body);
      if (priceChange.success && priceChange.data.store.id === checkout.storeId) {
        throw new PriceChangedError(priceChange.data.store);
      }
      throw new Error('Unable to verify the updated pricing.');
    }
    if (
      response.status === 400 &&
      error.data.error.code === 'INVALID_CHECKOUT' &&
      typeof body === 'object' &&
      body !== null &&
      'store' in body
    ) {
      const quantityChange = quantityChangedResponseSchema.safeParse(body);
      if (quantityChange.success && quantityChange.data.store.id === checkout.storeId) {
        throw new QuantityChangedError(quantityChange.data.store);
      }
      throw new Error('Unable to verify the updated bag quantities.');
    }
    throw new CheckoutRejectedError(
      response.status,
      error.data.error.code,
      error.data.error.message,
    );
  }
  const result = checkoutResponseSchema.parse(body);
  if (result.checkoutId !== checkout.checkoutId) throw new Error('Unexpected checkout result.');
  return result;
}

export async function getCheckoutStatus(
  checkoutId: string,
  signal?: AbortSignal,
): Promise<CheckoutResponse> {
  const { response, body } = await fetchJson(
    `${apiUrl}/checkout/${encodeURIComponent(checkoutId)}`,
    { method: 'GET', signal },
    25_000,
  );
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (response.status === 404 && error.success && error.data.error.code === 'NOT_FOUND') {
      throw new CheckoutNotFoundError('Checkout not found.');
    }
    throw new Error('Unable to check payment status.');
  }
  const result = checkoutResponseSchema.parse(body);
  if (result.checkoutId !== checkoutId) throw new Error('Unexpected checkout result.');
  return result;
}
