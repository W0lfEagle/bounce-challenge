import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkoutDetailsSchema, type CheckoutDetails, type Store } from '@bounce/contracts';
import { theme } from '../theme';
import { formatCardNumber } from '../lib/card-number';
import { PriceChangedError, submitCheckout } from '../api/checkout';

export function Checkout({ store: initialStore }: { store: Store }) {
  const [store, setStore] = useState(initialStore);
  const item = store.checkoutItems[0];
  const [quantity, setQuantity] = useState(item.minQuantity);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, cardNumber: false });
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error' | 'priceChanged'>('idle');
  const request = useRef<AbortController | null>(null);
  const pending = status === 'pending';
  useEffect(() => () => request.current?.abort(), []);
  const validation = checkoutDetailsSchema.safeParse({ name, email, cardNumber });
  const errors: Partial<Record<keyof CheckoutDetails, string[]>> = validation.success
    ? {}
    : validation.error.flatten().fieldErrors;
  const nameError = touched.name ? errors.name?.[0] : undefined;
  const emailError = touched.email ? errors.email?.[0] : undefined;
  const cardError = touched.cardNumber ? errors.cardNumber?.[0] : undefined;
  const canBook = validation.success && !pending;
  const totalCents = quantity * item.unitPriceCents;
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: store.currency,
  });

  async function book() {
    if (!validation.success || request.current || status === 'success') return;
    const controller = new AbortController();
    request.current = controller;
    setStatus('pending');
    try {
      await submitCheckout({
        ...validation.data,
        storeId: store.id,
        items: [{ itemId: item.id, quantity }],
        expectedTotalCents: totalCents,
        currency: store.currency,
      }, controller.signal);
      if (!controller.signal.aborted) {
        setCardNumber('');
        setStatus('success');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof PriceChangedError) {
          setStore(error.store);
          const updatedItem = error.store.checkoutItems[0];
          setQuantity((current) => Math.min(updatedItem.maxQuantity, Math.max(updatedItem.minQuantity, current)));
          setStatus('priceChanged');
        } else {
          setStatus('error');
        }
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  if (status === 'success') {
    return <Text accessibilityRole="header" style={styles.heading}>Payment successful</Text>;
  }

  return (
    <View>
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
              accessibilityState={{ disabled: pending || quantity <= item.minQuantity }}
              disabled={pending || quantity <= item.minQuantity}
              onPress={() => setQuantity((current) => Math.max(item.minQuantity, current - 1))}
              style={[styles.counterButton, quantity <= item.minQuantity && styles.disabledButton]}
            >
              <Text style={styles.counterSymbol}>−</Text>
            </Pressable>
            <Text accessibilityLabel={`Number of bags: ${quantity}`} style={styles.quantity}>{quantity}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase number of bags"
              accessibilityState={{ disabled: pending || quantity >= item.maxQuantity }}
              disabled={pending || quantity >= item.maxQuantity}
              onPress={() => setQuantity((current) => Math.min(item.maxQuantity, current + 1))}
              style={[styles.counterButton, quantity >= item.maxQuantity && styles.disabledButton]}
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
            accessibilityLabel="Name" value={name} onChangeText={setName} editable={!pending}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
            style={[styles.input, nameError && styles.invalidInput]}
          />
          {nameError && <Text accessibilityRole="alert" style={styles.error}>{nameError}</Text>}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email" value={email} onChangeText={setEmail} editable={!pending}
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
            accessibilityLabel="Card details" value={cardNumber} onChangeText={setCardNumber} editable={!pending}
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
      {status === 'priceChanged' && <Text accessibilityRole="alert" style={[styles.error, styles.submitMessage]}>The price has changed. Review the updated total and press Book again.</Text>}
      {pending && (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="Processing payment" color={theme.colors.primary} />
          <Text accessibilityLiveRegion="polite">Processing payment…</Text>
        </View>
      )}
      <View style={[styles.section, styles.summary]}>
        <View style={styles.total}>
          <Text>{quantity} {quantity === 1 ? 'bag' : 'bags'}</Text>
          <Text accessibilityLabel="Total" accessibilityLiveRegion="polite" style={styles.totalPrice}>
            {currencyFormatter.format(totalCents / 100)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canBook }} disabled={!canBook} onPress={() => void book()} style={[styles.bookButton, canBook && styles.enabledBookButton]}>
          <Text style={[styles.bookButtonText, canBook && styles.enabledBookButtonText]}>Book</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  loading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[12], marginTop: theme.spacing[24] },
  submitMessage: { marginTop: theme.spacing[24] },
});
