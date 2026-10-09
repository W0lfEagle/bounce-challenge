import { apiErrorSchema, storeSchema, type Store } from '@bounce/contracts';

import { apiUrl } from './config';

export async function fetchStore(storeId: string, signal?: AbortSignal): Promise<Store> {
  const response = await fetch(`${apiUrl}/stores/${encodeURIComponent(storeId)}`, { signal });
  const body: unknown = await response.json();

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error.message : 'Unable to load store information.');
  }

  const store = storeSchema.safeParse(body);
  if (!store.success) throw new Error('The store information could not be verified.');
  return store.data;
}
