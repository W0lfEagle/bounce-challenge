import { randomUUID } from 'expo-crypto';
import { checkoutResponseSchema } from '@bounce/contracts';

export type AttemptIds = { checkoutId: string; attemptId: string };
const idsSchema = checkoutResponseSchema.pick({ checkoutId: true, attemptId: true });
const memory = new Map<string, AttemptIds>();
const key = (storeId: string) => `bounce:checkout:${storeId}`;

export function createAttemptIds(checkoutId = randomUUID()): AttemptIds {
  return { checkoutId, attemptId: randomUUID() };
}
export function loadAttemptIds(storeId: string): AttemptIds | undefined {
  try {
    const saved = globalThis.sessionStorage?.getItem(key(storeId));
    if (saved) {
      const parsed = idsSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
  } catch { /* Storage may be unavailable on native or restricted browsers. */ }
  return memory.get(storeId);
}
export function saveAttemptIds(storeId: string, ids: AttemptIds) {
  memory.set(storeId, ids);
  try { globalThis.sessionStorage?.setItem(key(storeId), JSON.stringify(ids)); } catch { /* In-memory recovery remains available. */ }
}
export function clearAttemptIds(storeId: string) {
  memory.delete(storeId);
  try { globalThis.sessionStorage?.removeItem(key(storeId)); } catch { /* Best effort when storage is unavailable. */ }
}
