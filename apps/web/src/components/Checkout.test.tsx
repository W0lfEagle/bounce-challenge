import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { Store, CheckoutResponse } from '@bounce/contracts';
import { Checkout } from './Checkout';
import {
  loadAttemptIds,
  createAttemptIds,
  clearAttemptIds,
  saveAttemptIds,
} from '../lib/checkout-attempt';
import {
  CheckoutNotFoundError,
  CheckoutRejectedError,
  PriceChangedError,
  QuantityChangedError,
  getCheckoutStatus,
  submitCheckout,
} from '../api/checkout';

jest.mock('../api/checkout', () => ({
  ...jest.requireActual('../api/checkout'),
  submitCheckout: jest.fn(),
  getCheckoutStatus: jest.fn(),
}));
const mockSubmitCheckout = jest.mocked(submitCheckout);
const mockGetCheckoutStatus = jest.mocked(getCheckoutStatus);
const ids = {
  checkoutId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
};
const success = { ...ids, status: 'succeeded' as const };
jest.mock('../lib/checkout-attempt', () => ({
  ...jest.requireActual('../lib/checkout-attempt'),
  createAttemptIds: jest.fn(),
  loadAttemptIds: jest.fn(),
  saveAttemptIds: jest.fn(),
  clearAttemptIds: jest.fn(),
}));
beforeEach(() => {
  mockSubmitCheckout.mockReset();
  mockGetCheckoutStatus.mockReset();
  jest.mocked(loadAttemptIds).mockReset();
  let sequence = 0;
  jest
    .mocked(createAttemptIds)
    .mockReset()
    .mockImplementation((checkoutId?: string) => {
      sequence += 1;
      const suffix = String(sequence).padStart(12, '0');
      return {
        checkoutId:
          checkoutId ?? (sequence === 1 ? ids.checkoutId : `10000000-0000-4000-8000-${suffix}`),
        attemptId: sequence === 1 ? ids.attemptId : `20000000-0000-4000-8000-${suffix}`,
      };
    });
  jest.mocked(clearAttemptIds).mockClear();
  jest.mocked(saveAttemptIds).mockClear();
});

async function fillValidDetails() {
  await fireEvent.changeText(screen.getByLabelText('Name'), ' Test User ');
  await fireEvent.changeText(screen.getByLabelText('Email'), ' test@example.com ');
  await fireEvent.changeText(screen.getByLabelText('Card details'), '4111 1111 1111 1111');
}

const store: Store = {
  id: 'codys-cookie-store',
  name: "Cody's Cookie Store",
  currency: 'USD',
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
  await render(
    <Checkout
      store={{
        ...store,
        checkoutItems: [
          { ...store.checkoutItems[0], minQuantity: 2, maxQuantity: 3, unitPriceCents: 725 },
        ],
      }}
    />,
  );
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
  let resolveRequest!: (result: CheckoutResponse) => void;
  mockSubmitCheckout.mockReturnValue(
    new Promise<CheckoutResponse>((resolve) => {
      resolveRequest = resolve;
    }),
  );
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(screen.getByLabelText('Placing Booking')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Book' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Book', includeHiddenElements: true })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Increase number of bags', includeHiddenElements: true }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Name', { includeHiddenElements: true })).toHaveProp(
    'editable',
    false,
  );
  expect(screen.queryByText('Booking Placed!')).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Book', includeHiddenElements: true }));
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
  expect(mockSubmitCheckout.mock.calls[0][0]).toEqual({
    ...ids,
    storeId: 'codys-cookie-store',
    items: [{ itemId: 'bag', quantity: 2 }],
    expectedTotalCents: 1180,
    currency: 'USD',
    name: 'Test User',
    email: 'test@example.com',
    cardNumber: '4111111111111111',
  });
  resolveRequest(success);
  expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
});

test('replays the same unchanged checkout after a lost response and missing status record', async () => {
  mockSubmitCheckout.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(success);
  mockGetCheckoutStatus.mockRejectedValueOnce(new CheckoutNotFoundError());
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Unable to complete checkout. Please try again.')).toBeTruthy();
  expect(screen.getByLabelText('Name')).toHaveDisplayValue(' Test User ');
  expect(screen.getByLabelText('Name')).toHaveProp('editable', false);
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].attemptId).toBe(
    mockSubmitCheckout.mock.calls[0][0].attemptId,
  );
  expect(createAttemptIds).toHaveBeenCalledTimes(1);
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

test.each([700, 500])(
  'refreshes price to %i without automatically resubmitting',
  async (unitPriceCents) => {
    mockSubmitCheckout
      .mockRejectedValueOnce(
        new PriceChangedError({
          ...store,
          checkoutItems: [{ ...store.checkoutItems[0], unitPriceCents }],
        }),
      )
      .mockResolvedValueOnce(success);
    const user = userEvent.setup();
    await render(<Checkout store={store} />);
    await fillValidDetails();
    await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
    await user.press(screen.getByRole('button', { name: 'Book' }));
    expect(
      await screen.findByText(
        'The price has changed. Review the updated total and press Book again.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Total')).toHaveTextContent(
      unitPriceCents === 700 ? '$14.00' : '$10.00',
    );
    expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Name')).toHaveDisplayValue(' Test User ');
    await user.press(screen.getByRole('button', { name: 'Book' }));
    expect(await screen.findByText('Booking Placed!')).toBeTruthy();
    expect(mockSubmitCheckout.mock.calls[1][0].expectedTotalCents).toBe(unitPriceCents * 2);
  },
);

test('shows a decline and Retry creates a new attempt for the same checkout', async () => {
  const retryIds = { ...ids, attemptId: '33333333-3333-4333-8333-333333333333' };
  jest.mocked(createAttemptIds).mockReturnValueOnce(ids).mockReturnValueOnce(retryIds);
  mockSubmitCheckout
    .mockResolvedValueOnce({ ...ids, status: 'declined' })
    .mockResolvedValueOnce({ ...retryIds, status: 'succeeded' });
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Your booking has failed. Please try again.')).toBeTruthy();
  expect(screen.getByLabelText('Card details')).toHaveDisplayValue('4111 1111 1111 1111');
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).toBe(ids.checkoutId);
  expect(mockSubmitCheckout.mock.calls[1][0].attemptId).toBe(retryIds.attemptId);
});

test('lets an unknown outcome be edited and explicitly reset for a fresh demo checkout', async () => {
  const freshIds = {
    checkoutId: '66666666-6666-4666-8666-666666666666',
    attemptId: '77777777-7777-4777-8777-777777777777',
  };
  jest.mocked(createAttemptIds).mockReturnValueOnce(ids).mockReturnValueOnce(freshIds);
  mockSubmitCheckout
    .mockResolvedValueOnce({ ...ids, status: 'unknown' })
    .mockResolvedValueOnce({ ...freshIds, status: 'succeeded' });
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(
    await screen.findByText(
      'We couldn’t confirm your booking. The previous payment may have completed. You can start over for this demo.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check payment status' })).toBeNull();
  expect(screen.getByLabelText('Name')).toHaveProp('editable', true);
  await fireEvent.changeText(screen.getByLabelText('Name'), 'New Demo User');
  await user.press(screen.getByRole('button', { name: 'Start over' }));
  expect(clearAttemptIds).toHaveBeenCalledWith(store.id);
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
  expect(mockGetCheckoutStatus).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).toBe(freshIds.checkoutId);
  expect(mockSubmitCheckout.mock.calls[1][0].name).toBe('New Demo User');
});

test('recovers success after a lost backend response without resubmitting', async () => {
  mockSubmitCheckout.mockRejectedValue(new Error('Connection lost'));
  mockGetCheckoutStatus.mockResolvedValue(success);
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
});

test('recovers a saved attempt after remount without storing or resubmitting card details', async () => {
  jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
  mockGetCheckoutStatus.mockResolvedValue(success);
  await render(<Checkout store={store} />);
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockGetCheckoutStatus).toHaveBeenCalledWith(ids.checkoutId, expect.any(AbortSignal));
  expect(mockSubmitCheckout).not.toHaveBeenCalled();
  expect(clearAttemptIds).toHaveBeenCalledWith(store.id);
});

test('clears successful recovery IDs so remount starts a fresh booking with new identifiers', async () => {
  const newIds = {
    checkoutId: '44444444-4444-4444-8444-444444444444',
    attemptId: '55555555-5555-4555-8555-555555555555',
  };
  jest.mocked(createAttemptIds).mockReturnValueOnce(ids).mockReturnValueOnce(newIds);
  mockSubmitCheckout
    .mockResolvedValueOnce(success)
    .mockResolvedValueOnce({ ...newIds, status: 'succeeded' });
  const user = userEvent.setup();
  const first = await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(clearAttemptIds).toHaveBeenCalledWith(store.id);
  await first.unmount();

  await render(<Checkout store={store} />);
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('');
  expect(screen.getByLabelText('Number of bags: 1')).toBeTruthy();
  expect(mockGetCheckoutStatus).not.toHaveBeenCalled();
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  expect(await screen.findByText('Booking Placed!')).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).toBe(newIds.checkoutId);
});

test('retains saved recovery IDs when a reloaded payment remains unresolved', async () => {
  jest.mocked(loadAttemptIds).mockReturnValue(ids);
  mockGetCheckoutStatus.mockResolvedValue({ ...ids, status: 'unknown' });
  const first = await render(<Checkout store={store} />);
  expect(
    await screen.findByText(
      'We couldn’t confirm your booking. The previous payment may have completed. You can start over for this demo.',
    ),
  ).toBeTruthy();
  expect(saveAttemptIds).toHaveBeenCalledWith(store.id, ids);
  expect(clearAttemptIds).not.toHaveBeenCalled();
  await first.unmount();
  await render(<Checkout store={store} />);
  expect(
    await screen.findByText(
      'We couldn’t confirm your booking. The previous payment may have completed. You can start over for this demo.',
    ),
  ).toBeTruthy();
  expect(mockGetCheckoutStatus).toHaveBeenCalledTimes(2);
  expect(mockSubmitCheckout).not.toHaveBeenCalled();
  expect(clearAttemptIds).not.toHaveBeenCalled();
});

test.each(['succeeded', 'declined', 'unknown'] as const)(
  'keeps processing locked on reload until status becomes %s',
  async (finalStatus) => {
    jest.useFakeTimers();
    try {
      jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
      mockGetCheckoutStatus
        .mockResolvedValueOnce({ ...ids, status: 'processing' })
        .mockResolvedValueOnce({ ...ids, status: finalStatus });
      await render(<Checkout store={store} />);

      expect(screen.getByLabelText('Checking payment status')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
      expect(screen.getByLabelText('Name', { includeHiddenElements: true })).toHaveProp(
        'editable',
        false,
      );
      expect(mockSubmitCheckout).not.toHaveBeenCalled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });

      if (finalStatus === 'succeeded') {
        expect(screen.getByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
        expect(clearAttemptIds).toHaveBeenCalledWith(store.id);
      } else if (finalStatus === 'declined') {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(clearAttemptIds).not.toHaveBeenCalled();
      } else {
        expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
        expect(clearAttemptIds).not.toHaveBeenCalled();
      }
      expect(mockGetCheckoutStatus).toHaveBeenCalledTimes(2);
      expect(mockSubmitCheckout).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('stops status polling when recovery is unmounted', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
    mockGetCheckoutStatus.mockResolvedValue({ ...ids, status: 'processing' });
    const view = await render(<Checkout store={store} />);
    const signal = mockGetCheckoutStatus.mock.calls[0][1];

    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(signal?.aborted).toBe(true);
    expect(mockGetCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(mockSubmitCheckout).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('bounds status recovery and preserves IDs if processing never resolves', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
    mockGetCheckoutStatus.mockResolvedValue({ ...ids, status: 'processing' });
    await render(<Checkout store={store} />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
    expect(mockGetCheckoutStatus.mock.calls[0][1]?.aborted).toBe(true);
    expect(saveAttemptIds).toHaveBeenCalledWith(store.id, ids);
    expect(clearAttemptIds).not.toHaveBeenCalled();
    expect(mockSubmitCheckout).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  { label: 'lower maximum', selected: 10, minQuantity: 1, maxQuantity: 6, expected: 6 },
  { label: 'higher minimum', selected: 1, minQuantity: 3, maxQuantity: 10, expected: 3 },
])(
  'refreshes a $label and requires deliberate resubmission',
  async ({ selected, minQuantity, maxQuantity, expected }) => {
    const updatedStore = {
      ...store,
      checkoutItems: [{ ...store.checkoutItems[0], minQuantity, maxQuantity }],
    };
    mockSubmitCheckout
      .mockRejectedValueOnce(new QuantityChangedError(updatedStore))
      .mockResolvedValueOnce(success);
    const user = userEvent.setup();
    await render(<Checkout store={store} />);
    await fillValidDetails();
    for (let count = 1; count < selected; count += 1) {
      await user.press(screen.getByRole('button', { name: 'Increase number of bags' }));
    }
    await user.press(screen.getByRole('button', { name: 'Book' }));

    expect(
      await screen.findByText(
        'The available bag quantities have changed. Review your selection and press Book again.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText(`Number of bags: ${expected}`)).toBeTruthy();
    expect(screen.getByText(`Choose ${minQuantity}–${maxQuantity} bags`)).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveDisplayValue(' Test User ');
    expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
    expect(mockGetCheckoutStatus).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Book' }));
    expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
    expect(mockSubmitCheckout.mock.calls[1][0].items[0].quantity).toBe(expected);
    expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).not.toBe(ids.checkoutId);
  },
);

test('shows a definite rejection without querying payment status and permits corrected details', async () => {
  mockSubmitCheckout.mockRejectedValueOnce(
    new CheckoutRejectedError(400, 'INVALID_CHECKOUT', 'Invalid checkout details.'),
  );
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));

  expect(await screen.findByText('Invalid checkout details.')).toBeTruthy();
  expect(mockGetCheckoutStatus).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Name')).toHaveProp('editable', true);
  expect(clearAttemptIds).toHaveBeenCalledWith(store.id);
});

test('recovers an identifier conflict rather than resetting an existing payment', async () => {
  mockSubmitCheckout.mockRejectedValueOnce(
    new CheckoutRejectedError(
      409,
      'REQUEST_CONFLICT',
      'Checkout identifiers were reused with different details.',
    ),
  );
  mockGetCheckoutStatus.mockResolvedValue(success);
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));

  expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
  expect(mockGetCheckoutStatus).toHaveBeenCalledWith(ids.checkoutId, expect.any(AbortSignal));
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
});

test.each([
  {
    label: 'name',
    edit: async () => fireEvent.changeText(screen.getByLabelText('Name'), 'Another User'),
  },
  {
    label: 'email',
    edit: async () => fireEvent.changeText(screen.getByLabelText('Email'), 'another@example.com'),
  },
  {
    label: 'quantity',
    edit: async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Increase number of bags' })),
  },
])('starts a new checkout after a declined $label changes', async ({ edit }) => {
  mockSubmitCheckout
    .mockResolvedValueOnce({ ...ids, status: 'declined' })
    .mockResolvedValueOnce(success);
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  await screen.findByRole('button', { name: 'Retry' });
  await edit();
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).not.toBe(ids.checkoutId);
  expect(mockSubmitCheckout.mock.calls[1][0].attemptId).not.toBe(ids.attemptId);
});

test('changes only the payment attempt when retrying with another card', async () => {
  mockSubmitCheckout
    .mockResolvedValueOnce({ ...ids, status: 'declined' })
    .mockResolvedValueOnce(success);
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));
  await screen.findByRole('button', { name: 'Retry' });
  await fireEvent.changeText(screen.getByLabelText('Card details'), '4242424242424242');
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
  expect(mockSubmitCheckout.mock.calls[1][0].checkoutId).toBe(ids.checkoutId);
  expect(mockSubmitCheckout.mock.calls[1][0].attemptId).not.toBe(ids.attemptId);
  expect(mockSubmitCheckout.mock.calls[1][0].cardNumber).toBe('4242424242424242');
});

test('submits a valid checkout from the card keyboard action', async () => {
  mockSubmitCheckout.mockResolvedValue(success);
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await fireEvent(screen.getByLabelText('Card details'), 'submitEditing');

  expect(await screen.findByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
});

test('keeps an observed processing payment locked through a transient status-read failure', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
    mockGetCheckoutStatus
      .mockResolvedValueOnce({ ...ids, status: 'processing' })
      .mockRejectedValueOnce(new Error('Briefly offline'))
      .mockResolvedValueOnce(success);
    await render(<Checkout store={store} />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByLabelText('Checking payment status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole('header', { name: 'Booking Placed!' })).toBeTruthy();
    expect(mockGetCheckoutStatus).toHaveBeenCalledTimes(3);
    expect(mockSubmitCheckout).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('does not replay saved IDs with new details when reload recovery finds no record', async () => {
  jest.mocked(loadAttemptIds).mockReturnValueOnce(ids);
  mockGetCheckoutStatus.mockRejectedValueOnce(new CheckoutNotFoundError());
  await render(<Checkout store={store} />);

  expect(await screen.findByRole('button', { name: 'Start over' })).toBeTruthy();
  expect(screen.getByLabelText('Name')).toHaveDisplayValue('');
  expect(clearAttemptIds).not.toHaveBeenCalled();
  expect(mockSubmitCheckout).not.toHaveBeenCalled();
});

test('retains recovery IDs if an identifier conflict cannot be checked', async () => {
  mockSubmitCheckout.mockRejectedValueOnce(
    new CheckoutRejectedError(409, 'REQUEST_CONFLICT', 'Conflicting checkout details.'),
  );
  mockGetCheckoutStatus.mockRejectedValueOnce(new Error('Status unavailable'));
  const user = userEvent.setup();
  await render(<Checkout store={store} />);
  await fillValidDetails();
  await user.press(screen.getByRole('button', { name: 'Book' }));

  expect(await screen.findByRole('button', { name: 'Start over' })).toBeTruthy();
  expect(clearAttemptIds).not.toHaveBeenCalled();
  expect(saveAttemptIds).toHaveBeenCalledWith(store.id, ids);
  expect(mockSubmitCheckout).toHaveBeenCalledTimes(1);
});
