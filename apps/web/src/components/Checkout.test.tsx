import { render, screen, userEvent } from '@testing-library/react-native';
import type { Store } from '@bounce/contracts';
import { Checkout } from './Checkout';

const store: Store = {
  id: 'codys-cookie-store', name: "Cody's Cookie Store", currency: 'USD',
  checkoutItems: [{ id: 'bag', name: 'Bag', unitPriceCents: 590, minQuantity: 1, maxQuantity: 10 }],
};

test('updates the total when increasing and decreasing bag quantity', async () => {
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  expect(screen.getByLabelText('Total')).toHaveTextContent('$5.90');

  await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
  expect(screen.getByLabelText('Number of bags: 2')).toBeTruthy();
  expect(screen.getByLabelText('Total')).toHaveTextContent('$11.80');

  await user.press(screen.getByRole('button', { name: 'Decrease number of bags' }));
  expect(screen.getByLabelText('Total')).toHaveTextContent('$5.90');
});

test('uses API-provided bounds and price and prevents changes past either bound', async () => {
  const user = userEvent.setup();
  await render(<Checkout store={{ ...store, checkoutItems: [{ ...store.checkoutItems[0], minQuantity: 2, maxQuantity: 3, unitPriceCents: 725 }] }} />);
  const decrease = screen.getByRole('button', { name: 'Decrease number of bags' });
  const increase = screen.getByRole('button', { name: 'Increase number of bags' });
  expect(decrease).toBeDisabled();
  await user.press(decrease);
  expect(screen.getByLabelText('Number of bags: 2')).toBeTruthy();
  expect(screen.getByLabelText('Total')).toHaveTextContent('$14.50');

  await user.press(increase);
  expect(increase).toBeDisabled();
  await user.press(increase);
  expect(screen.getByLabelText('Number of bags: 3')).toBeTruthy();
  expect(screen.getByLabelText('Total')).toHaveTextContent('$21.75');

  await user.press(decrease);
  expect(increase).toBeEnabled();
});

test('keeps all fields as plain text without validation or formatting', async () => {
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await user.type(screen.getByLabelText('Name'), 'Test User');
  await user.type(screen.getByLabelText('Email'), 'not an email');
  await user.type(screen.getByLabelText('Card details'), 'plain card text');
  await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));

  expect(screen.getByLabelText('Name')).toHaveDisplayValue('Test User');
  expect(screen.getByLabelText('Email')).toHaveDisplayValue('not an email');
  expect(screen.getByLabelText('Card details')).toHaveDisplayValue('plain card text');
  expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
});
