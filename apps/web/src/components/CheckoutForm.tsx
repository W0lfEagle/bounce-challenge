import { useRef, useState, type Dispatch, type Ref, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { checkoutDetailsSchema, type CheckoutDetails, type Store } from '@bounce/contracts';
import { theme } from '../theme';
import { formatCardNumber } from '../lib/card-number';
import type { CheckoutState } from './Checkout';
import { styles } from './Checkout.styles';

type CheckoutFormProps = {
  store: Store;
  quantity: number;
  onQuantityChange: Dispatch<SetStateAction<number>>;
  state: CheckoutState;
  onBook: (details: CheckoutDetails) => Promise<void>;
  onStartOver: () => void;
};

export function CheckoutForm({
  store,
  quantity,
  onQuantityChange,
  state,
  onBook,
  onStartOver,
}: CheckoutFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, cardNumber: false });
  const emailInput = useRef<TextInput>(null);
  const cardInput = useRef<TextInput>(null);
  const item = store.checkoutItems[0];
  const status = state.status;
  const pending = status === 'pending' || status === 'recovering' || status === 'processing';
  // A missing status record must replay the same details, so those fields stay locked.
  const locked = pending || status === 'error';
  const validation = checkoutDetailsSchema.safeParse({ name, email, cardNumber });
  const errors = validation.success ? {} : validation.error.flatten().fieldErrors;
  const nameError = touched.name ? errors.name?.[0] : undefined;
  const emailError = touched.email ? errors.email?.[0] : undefined;
  const cardError = touched.cardNumber ? errors.cardNumber?.[0] : undefined;
  const canBook = validation.success && !pending && status !== 'unknown';
  const canUseButton = canBook || status === 'unknown';
  const inputProps = { editable: !locked, tabIndex: pending ? (-1 as const) : (0 as const) };
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: store.currency,
  });

  function book() {
    if (!canBook || !validation.success) return;
    cardInput.current?.blur();
    void onBook(validation.data);
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
                onPress={() =>
                  onQuantityChange((current) => Math.max(item.minQuantity, current - 1))
                }
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
                onPress={() =>
                  onQuantityChange((current) => Math.min(item.maxQuantity, current + 1))
                }
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
          <Field
            {...inputProps}
            label="Name"
            error={nameError}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            enterKeyHint="next"
            onSubmitEditing={() => emailInput.current?.focus()}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
          />
          <Field
            {...inputProps}
            inputRef={emailInput}
            label="Email"
            error={emailError}
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            enterKeyHint="next"
            onSubmitEditing={() => cardInput.current?.focus()}
            onBlur={() => setTouched((current) => ({ ...current, email: true }))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment information</Text>
          <Field
            {...inputProps}
            inputRef={cardInput}
            label="Card details"
            error={cardError}
            value={cardNumber}
            onChangeText={setCardNumber}
            autoComplete="off"
            enterKeyHint="done"
            onSubmitEditing={book}
            onBlur={() => {
              setCardNumber(formatCardNumber(cardNumber));
              setTouched((current) => ({ ...current, cardNumber: true }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
          />
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
              {currencyFormatter.format((quantity * item.unitPriceCents) / 100)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canUseButton }}
            disabled={!canUseButton}
            onPress={status === 'unknown' ? onStartOver : book}
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

type FieldProps = TextInputProps & { label: string; error?: string; inputRef?: Ref<TextInput> };

function Field({ label, error, inputRef, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        ref={inputRef}
        accessibilityLabel={label}
        style={[styles.input, error && styles.invalidInput]}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
