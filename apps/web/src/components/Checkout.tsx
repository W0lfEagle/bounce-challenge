import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { CheckoutDetails, CheckoutResponse, Store } from '@bounce/contracts';
import {
  CheckoutNotFoundError,
  CheckoutRejectedError,
  PriceChangedError,
  QuantityChangedError,
  submitCheckout,
} from '../api/checkout';
import {
  checkoutSignature,
  CheckoutDetailsChangedError,
  clearAttemptIds,
  createAttemptIds,
  loadAttemptIds,
  saveAttemptIds,
  selectAttempt,
  type AttemptSelection,
  type CheckoutIdentity,
} from '../lib/checkout-attempt';
import { CheckoutForm } from './CheckoutForm';
import { waitForCheckoutResult } from './checkout-recovery';
import { styles } from './Checkout.styles';

export type CheckoutState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'recovering' }
  | { status: 'processing' }
  | { status: 'success' }
  | { status: 'declined' }
  | { status: 'unknown' }
  | { status: 'error' }
  | { status: 'rejected'; message: string }
  | { status: 'termsChanged'; message: string };

export function Checkout({ store: initialStore }: { store: Store }) {
  const [store, setStore] = useState(initialStore);
  const item = store.checkoutItems[0];
  const [quantity, setQuantity] = useState(item.minQuantity);
  const [savedAttempt] = useState(() => loadAttemptIds(initialStore.id));
  const [state, setState] = useState<CheckoutState>({
    status: savedAttempt ? 'recovering' : 'idle',
  });
  const status = state.status;
  const request = useRef<AbortController | null>(null);
  const identity = useRef<CheckoutIdentity | null>(null);

  const applyResult = useCallback(
    (result: CheckoutResponse) => {
      const ids = { checkoutId: result.checkoutId, attemptId: result.attemptId };
      identity.current = { ...identity.current, ids };
      // Persist unfinished work only; a decline keeps its in-page identity for Retry.
      if (result.status === 'processing' || result.status === 'unknown') {
        saveAttemptIds(store.id, ids);
      } else {
        clearAttemptIds(store.id);
      }
      if (result.status === 'succeeded') {
        identity.current = null;
        setState({ status: 'success' });
      } else {
        setState({ status: result.status });
      }
    },
    [store.id],
  );

  const recover = useCallback(
    async (checkoutId: string, signal: AbortSignal) => {
      try {
        const result = await waitForCheckoutResult(checkoutId, signal, applyResult);
        if (!signal.aborted) applyResult(result);
      } catch (error) {
        if (!signal.aborted) {
          const canReplay = error instanceof CheckoutNotFoundError && identity.current?.signature;
          setState({ status: canReplay ? 'error' : 'unknown' });
        }
      }
    },
    [applyResult],
  );

  useEffect(() => {
    const saved = savedAttempt;
    if (saved) {
      const controller = new AbortController();
      identity.current = { ids: saved };
      request.current = controller;
      // Recovery state is initialized above; updates follow an awaited status request.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void recover(saved.checkoutId, controller.signal).finally(() => {
        if (request.current === controller) request.current = null;
      });
    }
    return () => request.current?.abort();
  }, [savedAttempt, recover]);

  async function book(customer: CheckoutDetails) {
    if (request.current || status === 'success' || status === 'unknown') return;
    const details = {
      ...customer,
      storeId: store.id,
      items: [{ itemId: item.id, quantity }],
      expectedTotalCents: quantity * item.unitPriceCents,
      currency: store.currency,
    };
    const signature = checkoutSignature(details);
    const outcome = status === 'declined' || status === 'error' ? status : 'idle';
    let selection: AttemptSelection;
    try {
      selection = selectAttempt(identity.current, signature, outcome);
    } catch (error) {
      if (!(error instanceof CheckoutDetailsChangedError)) throw error;
      setState({ status: 'unknown' });
      return;
    }
    const ids = selection.kind === 'reuse' ? selection.ids : createAttemptIds(selection.checkoutId);
    identity.current = { ids, signature };
    saveAttemptIds(store.id, ids);
    const controller = new AbortController();
    request.current = controller;
    setState({ status: 'pending' });
    try {
      const result = await submitCheckout(
        {
          ...ids,
          ...details,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        applyResult(result);
        if (result.status === 'processing') await recover(ids.checkoutId, controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof PriceChangedError || error instanceof QuantityChangedError) {
          clearAttemptIds(store.id);
          identity.current = null;
          setStore(error.store);
          const updatedItem = error.store.checkoutItems[0];
          setQuantity((current) =>
            Math.min(updatedItem.maxQuantity, Math.max(updatedItem.minQuantity, current)),
          );
          setState({
            status: 'termsChanged',
            message:
              error instanceof PriceChangedError
                ? 'The price has changed. Review the updated total and press Book again.'
                : 'The available bag quantities have changed. Review your selection and press Book again.',
          });
        } else if (
          error instanceof CheckoutRejectedError &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          ['INVALID_CHECKOUT', 'INVALID_REQUEST', 'NOT_FOUND'].includes(error.code)
        ) {
          // These validated errors are returned before an attempt is claimed.
          clearAttemptIds(store.id);
          identity.current = null;
          setState({ status: 'rejected', message: error.message });
        } else {
          // Recover the existing result; never automatically issue another payment.
          setState({ status: 'recovering' });
          await recover(ids.checkoutId, controller.signal);
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function startOver() {
    if (request.current) return;
    // TODO(production): reconcile an uncertain charge before offering a separate purchase.
    clearAttemptIds(store.id);
    identity.current = null;
    setState({ status: 'idle' });
  }

  if (status === 'success') {
    return (
      <View style={styles.success}>
        <Text accessibilityRole="header" style={styles.successTitle}>
          {'Booking\nPlaced!'}
        </Text>
      </View>
    );
  }

  return (
    <CheckoutForm
      store={store}
      quantity={quantity}
      onQuantityChange={setQuantity}
      state={state}
      onBook={book}
      onStartOver={startOver}
    />
  );
}
