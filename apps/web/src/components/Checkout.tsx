import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkoutDetailsSchema, type CheckoutDetails, type CheckoutResponse, type Store } from '@bounce/contracts';
import { theme } from '../theme';
import { formatCardNumber } from '../lib/card-number';
import { CheckoutNotFoundError, PriceChangedError, getCheckoutStatus, submitCheckout } from '../api/checkout';
import { clearAttemptIds, createAttemptIds, loadAttemptIds, saveAttemptIds, type AttemptIds } from '../lib/checkout-attempt';

export function Checkout({ store: initialStore }: { store: Store }) {
  const [store, setStore] = useState(initialStore);
  const item = store.checkoutItems[0];
  const [quantity, setQuantity] = useState(item.minQuantity);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, cardNumber: false });
  const [savedAttempt] = useState(() => loadAttemptIds(initialStore.id));
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error' | 'declined' | 'unknown' | 'recovering' | 'priceChanged'>(savedAttempt ? 'recovering' : 'idle');
  const request = useRef<AbortController | null>(null);
  const identity = useRef<{ ids: AttemptIds; signature?: string } | null>(null);
  const pending = status === 'pending' || status === 'recovering';
  const locked = pending;

  function applyResult(result: CheckoutResponse) {
    const ids = { checkoutId: result.checkoutId, attemptId: result.attemptId };
    identity.current = { ...identity.current, ids };
    if (result.status === 'succeeded') {
      clearAttemptIds(store.id);
      identity.current = null;
      setCardNumber('');
      setStatus('success');
    } else {
      saveAttemptIds(store.id, ids);
      setStatus(result.status === 'declined' ? 'declined' : 'unknown');
    }
  }

  async function recover(checkoutId: string, signal: AbortSignal) {
    try {
      const result = await getCheckoutStatus(checkoutId, signal);
      if (!signal.aborted) applyResult(result);
    } catch (error) {
      if (!signal.aborted) setStatus(error instanceof CheckoutNotFoundError ? 'error' : 'unknown');
    }
  }

  useEffect(() => {
    const saved = savedAttempt;
    if (saved) {
      const controller = new AbortController();
      identity.current = { ids: saved };
      request.current = controller;
      void getCheckoutStatus(saved.checkoutId, controller.signal).then(
        (result) => { if (!controller.signal.aborted) applyResult(result); },
        (error) => { if (!controller.signal.aborted) setStatus(error instanceof CheckoutNotFoundError ? 'error' : 'unknown'); },
      ).finally(() => {
        if (request.current === controller) request.current = null;
      });
    }
    return () => request.current?.abort();
    // Recover once for this mounted checkout, not on each field change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const validation = checkoutDetailsSchema.safeParse({ name, email, cardNumber });
  const errors: Partial<Record<keyof CheckoutDetails, string[]>> = validation.success
    ? {}
    : validation.error.flatten().fieldErrors;
  const nameError = touched.name ? errors.name?.[0] : undefined;
  const emailError = touched.email ? errors.email?.[0] : undefined;
  const cardError = touched.cardNumber ? errors.cardNumber?.[0] : undefined;
  const canBook = validation.success && !locked && status !== 'unknown';
  const canUseButton = canBook || status === 'unknown';
  const totalCents = quantity * item.unitPriceCents;
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: store.currency,
  });

  async function book() {
    if (!validation.success || request.current || status === 'success' || status === 'unknown') return;
    const signature = JSON.stringify({ name: validation.data.name, email: validation.data.email, storeId: store.id, items: [{ itemId: item.id, quantity }], expectedTotalCents: totalCents, currency: store.currency });
    const previous = identity.current;
    let ids: AttemptIds;
    if (previous && status === 'error') {
      // A missing status record may race an earlier request; reuse its identity.
      ids = previous.ids;
    } else if (previous?.signature === signature) {
      ids = status === 'declined' ? createAttemptIds(previous.ids.checkoutId) : previous.ids;
    } else {
      ids = createAttemptIds();
    }
    identity.current = { ids, signature };
    saveAttemptIds(store.id, ids);
    const controller = new AbortController();
    request.current = controller;
    setStatus('pending');
    try {
      const result = await submitCheckout({
        ...ids,
        ...validation.data,
        storeId: store.id,
        items: [{ itemId: item.id, quantity }],
        expectedTotalCents: totalCents,
        currency: store.currency,
      }, controller.signal);
      if (!controller.signal.aborted) applyResult(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof PriceChangedError) {
          clearAttemptIds(store.id);
          identity.current = null;
          setStore(error.store);
          const updatedItem = error.store.checkoutItems[0];
          setQuantity((current) => Math.min(updatedItem.maxQuantity, Math.max(updatedItem.minQuantity, current)));
          setStatus('priceChanged');
        } else {
          // Recover the existing result; never automatically issue another payment.
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
    setStatus('idle');
  }

  if (status === 'success') {
    return (
      <View style={styles.success}>
        <Text accessibilityRole="header" style={styles.successTitle}>{'Booking\nPlaced!'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.checkout}>
      <View style={styles.content} aria-hidden={pending} accessibilityElementsHidden={pending} importantForAccessibility={pending ? 'no-hide-descendants' : 'auto'}>
        <Text style={styles.label}>Booking storage at:</Text>
        <Text accessibilityRole="header" style={styles.heading}>{store.name}</Text>
        <Text style={styles.unitPrice}>{currencyFormatter.format(item.unitPriceCents / 100)} per bag</Text>

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
                style={[styles.counterButton, (locked || quantity <= item.minQuantity) && styles.disabledButton]}
              >
                <Text style={styles.counterSymbol}>−</Text>
              </Pressable>
              <Text accessibilityLabel={`Number of bags: ${quantity}`} style={styles.quantity}>{quantity}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase number of bags"
                accessibilityState={{ disabled: locked || quantity >= item.maxQuantity }}
                disabled={locked || quantity >= item.maxQuantity}
                onPress={() => setQuantity((current) => Math.min(item.maxQuantity, current + 1))}
                style={[styles.counterButton, (locked || quantity >= item.maxQuantity) && styles.disabledButton]}
              >
                <Text style={styles.counterSymbol}>+</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.hint}>Choose {item.minQuantity}–{item.maxQuantity} bags</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal details</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              accessibilityLabel="Name" value={name} onChangeText={setName} editable={!locked}
              onBlur={() => setTouched((current) => ({ ...current, name: true }))}
              style={[styles.input, nameError && styles.invalidInput]}
            />
            {nameError && <Text accessibilityRole="alert" style={styles.error}>{nameError}</Text>}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email" value={email} onChangeText={setEmail} editable={!locked}
              onBlur={() => setTouched((current) => ({ ...current, email: true }))}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              style={[styles.input, emailError && styles.invalidInput]}
            />
            {emailError && <Text accessibilityRole="alert" style={styles.error}>{emailError}</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment information</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Card details</Text>
            <TextInput
              accessibilityLabel="Card details" value={cardNumber} onChangeText={setCardNumber} editable={!locked}
              onBlur={() => {
                setCardNumber(formatCardNumber(cardNumber));
                setTouched((current) => ({ ...current, cardNumber: true }));
              }}
              autoCapitalize="none" autoCorrect={false} keyboardType="number-pad"
              style={[styles.input, cardError && styles.invalidInput]}
            />
            {cardError && <Text accessibilityRole="alert" style={styles.error}>{cardError}</Text>}
          </View>
        </View>

        {status === 'error' && <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>Unable to complete checkout. Please try again.</Text>}
        {status === 'declined' && <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>Your booking has failed. Please try again.</Text>}
        {status === 'unknown' && (
          <View style={styles.recovery}>
            <Text accessibilityRole="alert" style={styles.error}>We couldn’t confirm your booking. The previous payment may have completed. You can start over for this demo.</Text>
          </View>
        )}
        {status === 'priceChanged' && <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>The price has changed. Review the updated total and press Book again.</Text>}
        <View style={[styles.section, styles.summary]}>
          <View style={styles.total}>
            <Text>{quantity} {quantity === 1 ? 'bag' : 'bags'}</Text>
            <Text accessibilityLabel="Total" accessibilityLiveRegion="polite" style={styles.totalPrice}>
              {currencyFormatter.format(totalCents / 100)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canUseButton }} disabled={!canUseButton} onPress={() => { if (status === 'unknown') startOver(); else void book(); }} style={[styles.bookButton, canUseButton && styles.enabledBookButton]}>
            <Text style={[styles.bookButtonText, canUseButton && styles.enabledBookButtonText]}>{status === 'unknown' ? 'Start over' : status === 'declined' ? 'Retry' : 'Book'}</Text>
          </Pressable>
        </View>
      </View>
      {pending && (
        <View style={styles.overlay} accessibilityViewIsModal>
          <Text accessibilityLiveRegion="polite" style={styles.overlayText}>
            {status === 'recovering' ? 'Checking payment status…' : 'Placing\nBooking'}
          </Text>
          <ActivityIndicator accessibilityLabel={status === 'recovering' ? 'Checking payment status' : 'Placing Booking'} color={theme.colors.primaryText} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  checkout: { position: 'relative' },
  content: { padding: theme.spacing[24] },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.overlay, alignItems: 'center', justifyContent: 'center', gap: theme.spacing[12], borderRadius: theme.radii.md, zIndex: 1 },
  overlayText: { color: theme.colors.primaryText, fontSize: theme.fontSizes.subheading, fontWeight: theme.fontWeights.semibold, textAlign: 'center', maxWidth: 150 },
  success: { minHeight: 600, padding: theme.spacing[24], alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: theme.colors.text, fontSize: theme.fontSizes.heading, fontWeight: theme.fontWeights.bold, textAlign: 'center' },
  label: { color: theme.colors.textSecondary, fontSize: theme.fontSizes.label },
  heading: { marginTop: theme.spacing[6], fontSize: theme.fontSizes.heading, fontWeight: theme.fontWeights.semibold, color: theme.colors.text },
  unitPrice: { marginTop: theme.spacing[8], color: theme.colors.textMuted },
  section: { gap: theme.spacing[12], marginTop: theme.spacing[24], paddingTop: theme.spacing[24], borderTopWidth: 1, borderTopColor: theme.colors.border },
  sectionTitle: { fontSize: theme.fontSizes.body, fontWeight: theme.fontWeights.semibold, color: theme.colors.text },
  quantityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing[12], flexWrap: 'wrap' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[12] },
  counterButton: { width: 44, height: 44, borderRadius: theme.radii.sm, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.4 },
  counterSymbol: { fontSize: theme.fontSizes.emphasis, color: theme.colors.primaryStrong },
  quantity: { minWidth: 20, textAlign: 'center', fontSize: theme.fontSizes.subheading },
  hint: { color: theme.colors.textSubtle, fontSize: theme.fontSizes.hint },
  field: { gap: theme.spacing[6] },
  input: { minHeight: 44, paddingHorizontal: theme.spacing[12], paddingVertical: theme.spacing[10], borderWidth: 1, borderColor: theme.colors.inputBorder, borderRadius: theme.radii.sm, fontSize: theme.fontSizes.body, color: theme.colors.text, backgroundColor: theme.colors.surface },
  invalidInput: { borderColor: theme.colors.error },
  error: { color: theme.colors.error, fontSize: theme.fontSizes.label },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing[16] },
  total: { gap: theme.spacing[4] },
  totalPrice: { fontSize: theme.fontSizes.emphasis, fontWeight: theme.fontWeights.semibold, color: theme.colors.text },
  bookButton: { minWidth: 104, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.disabledBackground, borderRadius: theme.radii.sm },
  bookButtonText: { color: theme.colors.disabledText, fontSize: theme.fontSizes.body, fontWeight: theme.fontWeights.semibold },
  enabledBookButton: { backgroundColor: theme.colors.primary },
  enabledBookButtonText: { color: theme.colors.primaryText },
  submitMessage: { marginTop: theme.spacing[24] },
  recovery: { gap: theme.spacing[12], marginTop: theme.spacing[24] },
});
