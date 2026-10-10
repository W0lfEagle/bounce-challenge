import { render, screen, userEvent } from '@testing-library/react-native';
import type { Store } from '@bounce/contracts';
import App from './App';
import { fetchStore } from './src/api/stores';

jest.mock('./src/api/stores', () => ({ fetchStore: jest.fn() }));
const mockFetchStore = jest.mocked(fetchStore);
const store: Store = {
  id: 'codys-cookie-store',
  name: "Cody's Cookie Store",
  currency: 'USD',
  checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 }],
};

beforeEach(() => mockFetchStore.mockReset());

test('shows loading while the request is pending', async () => {
  mockFetchStore.mockReturnValue(new Promise(() => {}));
  await render(<App />);
  expect(screen.getByText('Loading store…')).toBeTruthy();
});

test('displays the store, price, and bounds returned by the API', async () => {
  mockFetchStore.mockResolvedValue({
    ...store,
    checkoutItems: [{ ...store.checkoutItems[0], unitPriceCents: 725, maxQuantity: 6 }],
  });
  await render(<App />);
  expect(await screen.findByRole('header', { name: "Cody's Cookie Store" })).toBeTruthy();
  expect(screen.getByText('$7.25 per bag')).toBeTruthy();
  expect(screen.getByText('Choose 1–6 bags')).toBeTruthy();
});

test('allows retry after a failed request', async () => {
  mockFetchStore
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce(store);
  const user = userEvent.setup();
  await render(<App />);
  await user.press(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('$5.90 per bag')).toBeTruthy();
  expect(mockFetchStore).toHaveBeenCalledTimes(2);
});

test('aborts the request when unmounted', async () => {
  mockFetchStore.mockReturnValue(new Promise(() => {}));
  const view = await render(<App />);
  const signal = mockFetchStore.mock.calls[0][1];
  await view.unmount();
  expect(signal?.aborted).toBe(true);
});
