import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { Store } from '@bounce/contracts';
import { Checkout } from './Checkout';
import { PriceChangedError, submitCheckout } from '../api/checkout';

jest.mock('../api/checkout', () => ({ ...jest.requireActual('../api/checkout'), submitCheckout: jest.fn() }));
const mockSubmitCheckout = jest.mocked(submitCheckout);
beforeEach(() => mockSubmitCheckout.mockReset());

async function fillValidDetails() {
  await fireEvent.changeText(screen.getByLabelText('Name'), ' Test User ');
  await fireEvent.changeText(screen.getByLabelText('Email'), ' test@example.com ');
  await fireEvent.changeText(screen.getByLabelText('Card details'), '4111 1111 1111 1111');
}

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

test('preserves field values when quantity changes and keeps invalid forms disabled', async () => {
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

test('shows errors only after blur and clears them as values are corrected', async () => {
  await render(<Checkout store={store} />);
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
  await fireEvent(screen.getByLabelText('Name'), 'blur');
  expect(screen.getByText('Enter your name.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Name'), '王');
  expect(screen.queryByText('Enter your name.')).toBeNull();

  await fireEvent.changeText(screen.getByLabelText('Email'), 'not an email');
  await fireEvent(screen.getByLabelText('Email'), 'blur');
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Email'), 'test@example.com');
  expect(screen.queryByText('Enter a valid email address.')).toBeNull();
});

test('formats the card on blur and enables Book only while every field is valid', async () => {
  await render(<Checkout store={store} />);
  const book = screen.getByRole('button', { name: 'Book' });
  expect(book).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Name'), ' Test User ');
  await fireEvent.changeText(screen.getByLabelText('Email'), ' test+booking@example.com ');
  expect(book).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Card details'), '4111111111111111');
  await fireEvent(screen.getByLabelText('Card details'), 'blur');
  expect(screen.getByLabelText('Card details')).toHaveDisplayValue('4111 1111 1111 1111');
  expect(book).toBeEnabled();

  await fireEvent.changeText(screen.getByLabelText('Card details'), '4111-1111-1111-1111');
  expect(book).toBeDisabled();
  expect(screen.getByText('Use only digits and spaces.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Card details'), '123');
  expect(screen.getByText('Enter a card number with 13–19 digits.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Card details'), '4111 1111 1111 1111');
  expect(book).toBeEnabled();
  await fireEvent.changeText(screen.getByLabelText('Email'), '');
  expect(book).toBeDisabled();
});

test('shows pending feedback, prevents repeated submissions, and displays success after the response', async () => {
  let resolveRequest!: () => void;
  mockSubmitCheckout.mockReturnValue(new Promise<void>((resolve) => { resolveRequest = resolve; }));
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(screen.getByLabelText('Processing payment')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Increase number of bags' })).toBeDisabled();
  expect(screen.getByLabelText('Name')).toHaveProp('editable', false);
  expect(screen.queryByText('Payment successful')).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
  expect(mockSubmitCheckout.mock.calls[0][0]).toEqual({
    storeId: 'codys-cookie-store', items: [{ itemId: 'bag', quantity: 2 }], expectedTotalCents: 1180, currency: 'USD', name: 'Test User', email: 'test@example.com', cardNumber: '4111111111111111',
  });
  resolveRequest();
  expect(await screen.findByRole('header', { name: 'Payment successful' })).toBeTruthy();
});

test('preserves the form and allows another attempt after a stub request failure', async () => {
  mockSubmitCheckout.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce();
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Unable to complete checkout. Please try again.')).toBeTruthy();
  expect(screen.getByLabelText('Name')).toHaveDisplayValue(' Test User ');
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Payment successful')).toBeTruthy();
});

test('aborts a pending checkout request on unmount', async () => {
  mockSubmitCheckout.mockReturnValue(new Promise(() => {}));
  const user = userEvent.setup();
  const view = await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  const signal = mockSubmitCheckout.mock.calls[0][1];
  await view.unmount();
  expect(signal?.aborted).toBe(true);
});

test.each([700, 500])('refreshes price to %i without automatically resubmitting', async (unitPriceCents) => {
  mockSubmitCheckout.mockRejectedValueOnce(new PriceChangedError({
    ...store, checkoutItems: [{ ...store.checkoutItems[0], unitPriceCents }],
  })).mockResolvedValueOnce();
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('The price has changed. Review the updated total and press Book again.')).toBeTruthy();
  expect(screen.getByLabelText('Total')).toHaveTextContent(unitPriceCents === 700 ? '$14.00' : '$10.00');
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Name')).toHaveDisplayValue(' Test User ');
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Payment successful')).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].expectedTotalCents).toBe(unitPriceCents * 2);
});
