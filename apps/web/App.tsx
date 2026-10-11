import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Store } from '@bounce/contracts';
import { fetchStore } from './src/api/stores';
import { Checkout } from './src/components/Checkout';
import { theme } from './src/theme';
import { backends, loadBackend, saveBackend, type Backend } from './src/api/config';

type StoreState = { status: 'loading' } | { status: 'loaded'; store: Store } | { status: 'error' };

const storeId = 'codys-cookie-store';

export default function App() {
  const [backend, setBackend] = useState(loadBackend);

  function selectBackend(next: Backend) {
    saveBackend(next);
    setBackend(next);
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.demo}>
        <Text style={styles.demoTitle}>Backend demo</Text>
        <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Backend">
          {backends.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: option.id === backend.id }}
              aria-checked={option.id === backend.id}
              onPress={() => selectBackend(option)}
              style={[styles.option, option.id === backend.id && styles.optionSelected]}
            >
              <Text
                style={[styles.optionText, option.id === backend.id && styles.optionTextSelected]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.demoHint}>
          Same checkout, two backends. Switching resets the form; return to recover pending
          bookings.
        </Text>
      </View>
      <StoreCheckout key={backend.id} backend={backend} />
      <StatusBar style="auto" />
    </ScrollView>
  );
}

function StoreCheckout({ backend }: { backend: Backend }) {
  const [state, setState] = useState<StoreState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchStore(storeId, controller.signal, backend.url).then(
      (store) => {
        if (!controller.signal.aborted) setState({ status: 'loaded', store });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );

    return () => controller.abort();
  }, [attempt, backend.url]);

  return (
    <View style={styles.card}>
      {state.status === 'loading' && (
        <View style={[styles.section, styles.statusContent]}>
          <ActivityIndicator accessibilityLabel="Loading store" />
          <Text>Loading store…</Text>
        </View>
      )}
      {state.status === 'error' && (
        <View style={[styles.section, styles.statusContent]}>
          <Text accessibilityRole="alert">Unable to load store information. Please try again.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((value) => value + 1)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'loaded' && <Checkout store={state.store} backend={backend} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 16,
  },
  demo: { width: '100%', maxWidth: 440, gap: 10 },
  demoTitle: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSizes.hint,
    fontWeight: theme.fontWeights.semibold,
  },
  demoHint: { color: theme.colors.textMuted, fontSize: theme.fontSizes.hint, lineHeight: 19 },
  picker: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
  },
  option: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: theme.radii.sm },
  optionSelected: { backgroundColor: theme.colors.primary },
  optionText: { color: theme.colors.textSecondary, fontWeight: theme.fontWeights.semibold },
  optionTextSelected: { color: theme.colors.primaryText },
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
