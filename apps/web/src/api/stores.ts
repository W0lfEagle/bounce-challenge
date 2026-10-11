import { apiErrorSchema, storeSchema, type Store } from '@bounce/contracts';

import { apiUrl } from './config';
import { fetchJson } from './fetch-json';

export async function fetchStore(
  storeId: string,
  signal?: AbortSignal,
  baseUrl = apiUrl,
): Promise<Store> {
  const { response, body } = await fetchJson(
    `${baseUrl}/stores/${encodeURIComponent(storeId)}`,
    { signal },
    10_000,
  );

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error.message : 'Unable to load store information.');
  }

  const store = storeSchema.safeParse(body);
  if (!store.success || store.data.id !== storeId)
    throw new Error('The store information could not be verified.');
  return store.data;
}
