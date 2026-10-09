import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Store } from '@bounce/contracts';
import { theme } from '../theme';

export function Checkout({ store }: { store: Store }) {
  const item = store.checkoutItems[0];
  const [quantity, setQuantity] = useState(item.minQuantity);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const totalCents = quantity * item.unitPriceCents;
  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: store.currency,
  });

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
              accessibilityState={{ disabled: quantity <= item.minQuantity }}
              disabled={quantity <= item.minQuantity}
              onPress={() => setQuantity((current) => Math.max(item.minQuantity, current - 1))}
              style={[styles.counterButton, quantity <= item.minQuantity && styles.disabledButton]}
            >
              <Text style={styles.counterSymbol}>−</Text>
            </Pressable>
            <Text accessibilityLabel={`Number of bags: ${quantity}`} style={styles.quantity}>{quantity}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase number of bags"
              accessibilityState={{ disabled: quantity >= item.maxQuantity }}
              disabled={quantity >= item.maxQuantity}
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
          <TextInput accessibilityLabel="Name" value={name} onChangeText={setName} style={styles.input} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Payment information</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Card details</Text>
          <TextInput accessibilityLabel="Card details" value={cardNumber} onChangeText={setCardNumber} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        </View>
      </View>

      <View style={[styles.section, styles.summary]}>
        <View style={styles.total}>
          <Text>{quantity} {quantity === 1 ? 'bag' : 'bags'}</Text>
          <Text accessibilityLabel="Total" accessibilityLiveRegion="polite" style={styles.totalPrice}>
            {currencyFormatter.format(totalCents / 100)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.bookButton}>
          <Text style={styles.bookButtonText}>Book</Text>
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
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing[16] },
  total: { gap: theme.spacing[4] },
  totalPrice: { fontSize: theme.fontSizes.emphasis, fontWeight: theme.fontWeights.semibold, color: theme.colors.text },
  bookButton: { minWidth: 104, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.disabledBackground, borderRadius: theme.radii.sm },
  bookButtonText: { color: theme.colors.disabledText, fontSize: theme.fontSizes.body, fontWeight: theme.fontWeights.semibold },
});
