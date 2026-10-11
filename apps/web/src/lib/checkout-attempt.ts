import { randomUUID } from 'expo-crypto';
import { checkoutResponseSchema, type CheckoutRequest } from '@bounce/contracts';

export type AttemptIds = { checkoutId: string; attemptId: string };
export type CheckoutIdentity = { ids: AttemptIds; signature?: string };
export type AttemptSelection =
  { kind: 'reuse'; ids: AttemptIds } | { kind: 'create'; checkoutId?: string };

export class CheckoutDetailsChangedError extends Error {
  constructor() {
    super('Recover the previous checkout before changing its details.');
    this.name = 'CheckoutDetailsChangedError';
  }
}

export function checkoutSignature(
  details: Omit<CheckoutRequest, 'checkoutId' | 'attemptId' | 'cardNumber'>,
): string {
  // UUIDs distinguish bookings; this key only detects changed details on a retry.
  // Never include the card number, even when the caller passes a full request.
  return JSON.stringify({
    storeId: details.storeId,
    items: details.items,
    expectedTotalCents: details.expectedTotalCents,
    currency: details.currency,
    name: details.name.trim(),
    email: details.email.trim(),
  });
}

export function selectAttempt(
  previous: CheckoutIdentity | null,
  signature: string,
  outcome: 'idle' | 'declined' | 'error',
): AttemptSelection {
  if (previous && outcome === 'error') {
    // A missing record may race the original request, so never create another attempt.
    if (previous.signature !== undefined && previous.signature !== signature) {
      throw new CheckoutDetailsChangedError();
    }
    return { kind: 'reuse', ids: previous.ids };
  }
  if (previous?.signature === signature) {
    return outcome === 'declined'
      ? { kind: 'create', checkoutId: previous.ids.checkoutId }
      : { kind: 'reuse', ids: previous.ids };
  }
  return { kind: 'create' };
}

const idsSchema = checkoutResponseSchema.pick({ checkoutId: true, attemptId: true });
const key = (storeId: string) => `bounce:checkout:${storeId}`;

export function createAttemptIds(checkoutId = randomUUID()): AttemptIds {
  return { checkoutId, attemptId: randomUUID() };
}

export function loadAttemptIds(storeId: string): AttemptIds | undefined {
  // Native restart recovery needs platform storage; sessionStorage is browser-only.
  try {
    const saved = globalThis.sessionStorage?.getItem(key(storeId));
    if (saved) {
      const parsed = idsSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Reload recovery is best effort when browser storage is unavailable.
  }
  return undefined;
}

export function saveAttemptIds(storeId: string, ids: AttemptIds) {
  try {
    globalThis.sessionStorage?.setItem(key(storeId), JSON.stringify(ids));
  } catch {
    // The mounted checkout still keeps its own identity for same-page recovery.
  }
}

export function clearAttemptIds(storeId: string) {
  try {
    globalThis.sessionStorage?.removeItem(key(storeId));
  } catch {
    // Best effort when storage is unavailable.
  }
}
