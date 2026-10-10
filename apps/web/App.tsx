import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Store } from '@bounce/contracts';
import { fetchStore } from './src/api/stores';
import { Checkout } from './src/components/Checkout';
import { theme } from './src/theme';

type StoreState = { status: 'loading' } | { status: 'loaded'; store: Store } | { status: 'error' };

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
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        {state.status === 'loading' && (
          <View style={[styles.section, styles.statusContent]}>
            <ActivityIndicator accessibilityLabel="Loading store" />
            <Text>Loading store…</Text>
          </View>
        )}
        {state.status === 'error' && (
          <View style={[styles.section, styles.statusContent]}>
            <Text accessibilityRole="alert">
              Unable to load store information. Please try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt((value) => value + 1)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {state.status === 'loaded' && <Checkout store={state.store} />}
      </View>
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
  },
  statusContent: { padding: 24 },
  section: { gap: 12 },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.sm,
  },
  buttonText: { color: theme.colors.primaryText, fontWeight: theme.fontWeights.semibold },
});
