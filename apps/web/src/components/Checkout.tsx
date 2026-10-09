import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import {
  checkoutDetailsSchema,
  type CheckoutDetails,
  type CheckoutResponse,
  type Store,
} from '@bounce/contracts';
import { theme } from '../theme';
import { formatCardNumber } from '../lib/card-number';
import {
  CheckoutNotFoundError,
  CheckoutRejectedError,
  PriceChangedError,
  QuantityChangedError,
  getCheckoutStatus,
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
  type CheckoutIdentity,
} from '../lib/checkout-attempt';
import { styles } from './Checkout.styles';

type CheckoutState =
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

export function Checkout({ store: initialStore }: { store: Store }) {
  const [store, setStore] = useState(initialStore);
  const item = store.checkoutItems[0];
  const [quantity, setQuantity] = useState(item.minQuantity);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, cardNumber: false });
  const [savedAttempt] = useState(() => loadAttemptIds(initialStore.id));
  const [state, setState] = useState<CheckoutState>({
    status: savedAttempt ? 'recovering' : 'idle',
  });
  const status = state.status;
  const request = useRef<AbortController | null>(null);
  const identity = useRef<CheckoutIdentity | null>(null);
  const emailInput = useRef<TextInput>(null);
  const cardInput = useRef<TextInput>(null);
  const pending = status === 'pending' || status === 'recovering' || status === 'processing';
  // A missing status record may race the original POST. Retry its unchanged details.
  const locked = pending || status === 'error';

  const applyResult = useCallback(
    (result: CheckoutResponse) => {
      const ids = { checkoutId: result.checkoutId, attemptId: result.attemptId };
      identity.current = { ...identity.current, ids };
      if (result.status === 'succeeded') {
        clearAttemptIds(store.id);
        identity.current = null;
        setCardNumber('');
        setState({ status: 'success' });
      } else {
        saveAttemptIds(store.id, ids);
        setState({ status: result.status });
      }
    },
    [store.id],
  );

  const recover = useCallback(
    async (checkoutId: string, signal: AbortSignal) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, recoveryTimeoutMs);
      let sawProcessing = false;
      try {
        do {
          let result: CheckoutResponse;
          try {
            result = await getCheckoutStatus(checkoutId, controller.signal);
          } catch (error) {
            if (!sawProcessing || controller.signal.aborted) throw error;
            // A transient status-read failure doesn't end an active payment.
            await waitForStatus(controller.signal);
            continue;
          }
          if (controller.signal.aborted) break;
          applyResult(result);
          if (result.status !== 'processing') return;
          sawProcessing = true;
          // Read status only; never repeat a payment while it is still processing.
          await waitForStatus(controller.signal);
        } while (!controller.signal.aborted);
        if (!signal.aborted) setState({ status: 'unknown' });
      } catch (error) {
        if (!signal.aborted) {
          const canReplay = error instanceof CheckoutNotFoundError && identity.current?.signature;
          setState({ status: canReplay ? 'error' : 'unknown' });
        }
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
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
  const validation = checkoutDetailsSchema.safeParse({ name, email, cardNumber });
  const errors: Partial<Record<keyof CheckoutDetails, string[]>> = validation.success
    ? {}
    : validation.error.flatten().fieldErrors;
  const nameError = touched.name ? errors.name?.[0] : undefined;
  const emailError = touched.email ? errors.email?.[0] : undefined;
  const cardError = touched.cardNumber ? errors.cardNumber?.[0] : undefined;
  const canBook = validation.success && !pending && status !== 'unknown';
  const canUseButton = canBook || status === 'unknown';
  const totalCents = quantity * item.unitPriceCents;
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: store.currency,
  });

  async function book() {
    if (!validation.success || request.current || status === 'success' || status === 'unknown')
      return;
    const details = {
      ...validation.data,
      storeId: store.id,
      items: [{ itemId: item.id, quantity }],
      expectedTotalCents: totalCents,
      currency: store.currency,
    };
    const signature = checkoutSignature(details);
    const outcome = status === 'declined' || status === 'error' ? status : 'idle';
    let selection;
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
    cardInput.current?.blur();
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
    <View style={styles.checkout}>
      <View
        style={styles.content}
        aria-hidden={pending}
        accessibilityElementsHidden={pending}
        importantForAccessibility={pending ? 'no-hide-descendants' : 'auto'}
      >
        <Text style={styles.label}>Booking storage at:</Text>
        <Text accessibilityRole="header" style={styles.heading}>
          {store.name}
        </Text>
        <Text style={styles.unitPrice}>
          {currencyFormatter.format(item.unitPriceCents / 100)} per bag
        </Text>

        <View style={styles.section}>
          <View style={styles.quantityRow}>
            <Text style={styles.sectionTitle}>Number of bags</Text>
            <View style={styles.counter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease number of bags"
                accessibilityState={{ disabled: locked || quantity <= item.minQuantity }}
                disabled={locked || quantity <= item.minQuantity}
                onPress={() => setQuantity((current) => Math.max(item.minQuantity, current - 1))}
                style={[
                  styles.counterButton,
                  (locked || quantity <= item.minQuantity) && styles.disabledButton,
                ]}
              >
                <Text style={styles.counterSymbol}>−</Text>
              </Pressable>
              <Text accessibilityLabel={`Number of bags: ${quantity}`} style={styles.quantity}>
                {quantity}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase number of bags"
                accessibilityState={{ disabled: locked || quantity >= item.maxQuantity }}
                disabled={locked || quantity >= item.maxQuantity}
                onPress={() => setQuantity((current) => Math.min(item.maxQuantity, current + 1))}
                style={[
                  styles.counterButton,
                  (locked || quantity >= item.maxQuantity) && styles.disabledButton,
                ]}
              >
                <Text style={styles.counterSymbol}>+</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.hint}>
            Choose {item.minQuantity}–{item.maxQuantity} bags
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal details</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              accessibilityLabel="Name"
              value={name}
              onChangeText={setName}
              editable={!locked}
              tabIndex={pending ? -1 : 0}
              autoComplete="name"
              enterKeyHint="next"
              onSubmitEditing={() => emailInput.current?.focus()}
              onBlur={() => setTouched((current) => ({ ...current, name: true }))}
              style={[styles.input, nameError && styles.invalidInput]}
            />
            {nameError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {nameError}
              </Text>
            )}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              ref={emailInput}
              accessibilityLabel="Email"
              value={email}
              onChangeText={setEmail}
              editable={!locked}
              tabIndex={pending ? -1 : 0}
              autoComplete="email"
              enterKeyHint="next"
              onSubmitEditing={() => cardInput.current?.focus()}
              onBlur={() => setTouched((current) => ({ ...current, email: true }))}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={[styles.input, emailError && styles.invalidInput]}
            />
            {emailError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {emailError}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment information</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Card details</Text>
            <TextInput
              ref={cardInput}
              accessibilityLabel="Card details"
              value={cardNumber}
              onChangeText={setCardNumber}
              editable={!locked}
              tabIndex={pending ? -1 : 0}
              autoComplete="off"
              enterKeyHint="done"
              onSubmitEditing={() => {
                if (canBook) void book();
              }}
              onBlur={() => {
                setCardNumber(formatCardNumber(cardNumber));
                setTouched((current) => ({ ...current, cardNumber: true }));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              style={[styles.input, cardError && styles.invalidInput]}
            />
            {cardError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {cardError}
              </Text>
            )}
          </View>
        </View>

        {status === 'error' && (
          <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>
            Unable to complete checkout. Please try again.
          </Text>
        )}
        {status === 'declined' && (
          <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>
            Your booking has failed. Please try again.
          </Text>
        )}
        {status === 'unknown' && (
          <View style={styles.recovery}>
            <Text accessibilityRole="alert" style={styles.error}>
              We couldn’t confirm your booking. The previous payment may have completed. You can
              start over for this demo.
            </Text>
          </View>
        )}
        {(state.status === 'termsChanged' || state.status === 'rejected') && (
          <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>
            {state.message}
          </Text>
        )}
        <View style={[styles.section, styles.summary]}>
          <View style={styles.total}>
            <Text>
              {quantity} {quantity === 1 ? 'bag' : 'bags'}
            </Text>
            <Text
              accessibilityLabel="Total"
              accessibilityLiveRegion="polite"
              style={styles.totalPrice}
            >
              {currencyFormatter.format(totalCents / 100)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canUseButton }}
            disabled={!canUseButton}
            onPress={() => {
              if (status === 'unknown') startOver();
              else void book();
            }}
            style={[styles.bookButton, canUseButton && styles.enabledBookButton]}
          >
            <Text style={[styles.bookButtonText, canUseButton && styles.enabledBookButtonText]}>
              {status === 'unknown' ? 'Start over' : status === 'declined' ? 'Retry' : 'Book'}
            </Text>
          </Pressable>
        </View>
      </View>
      {pending && (
        <View style={styles.overlay} accessibilityViewIsModal>
          <Text accessibilityLiveRegion="polite" style={styles.overlayText}>
            {status === 'pending' ? 'Placing\nBooking' : 'Checking payment status…'}
          </Text>
          <ActivityIndicator
            accessibilityLabel={
              status === 'pending' ? 'Placing Booking' : 'Checking payment status'
            }
            color={theme.colors.primaryText}
          />
        </View>
      )}
    </View>
  );
}
