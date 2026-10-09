import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Store } from '@bounce/contracts';
import { fetchStore } from './src/store-api';

type StoreState =
  | { status: 'loading' }
  | { status: 'loaded'; store: Store }
  | { status: 'error' };

const storeId = 'codys-cookie-store';

export default function App() {
  const [state, setState] = useState<StoreState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchStore(storeId, controller.signal).then(
      (store) => {
        if (!controller.signal.aborted) setState({ status: 'loaded', store });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );

    return () => controller.abort();
  }, [attempt]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {state.status === 'loading' && (
          <View style={styles.section}>
            <ActivityIndicator accessibilityLabel="Loading store" />
            <Text>Loading store…</Text>
          </View>
        )}
        {state.status === 'error' && (
          <View style={styles.section}>
            <Text accessibilityRole="alert">Unable to load store information. Please try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.button}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {state.status === 'loaded' && (
          <View style={styles.section}>
            <Text>Booking storage at:</Text>
            <Text accessibilityRole="header" style={styles.heading}>{state.store.name}</Text>
            {state.store.checkoutItems.map((item) => (
              <View key={item.id} style={styles.item}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.price}>
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: state.store.currency }).format(item.unitPriceCents / 100)} per bag
                </Text>
                <Text>Quantity: {item.minQuantity}–{item.maxQuantity} bags</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6f8',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 440, padding: 24, backgroundColor: '#fff', borderRadius: 12 },
  section: { gap: 12 },
  heading: { fontSize: 24, fontWeight: '600' },
  item: { gap: 8, marginTop: 12, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  itemName: { fontSize: 18, fontWeight: '600' },
  price: { fontSize: 20 },
  button: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#2563eb', borderRadius: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
