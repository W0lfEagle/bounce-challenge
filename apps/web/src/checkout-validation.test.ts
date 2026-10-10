import { checkoutDetailsSchema } from '@bounce/contracts';

const details = {
  name: ' Test User ',
  email: ' test+booking@example.com ',
  cardNumber: '4111 1111 1111 1111',
};

test('normalises valid details without modifying name characters or email case', () => {
  expect(
    checkoutDetailsSchema.parse({ ...details, name: ' 王 O’Neil ', email: ' Person@example.com ' }),
  ).toEqual({
    name: '王 O’Neil',
    email: 'Person@example.com',
    cardNumber: '4111111111111111',
  });
});

test.each(['', ' ', '\t\n'])('rejects empty or whitespace-only names', (name) => {
  expect(checkoutDetailsSchema.safeParse({ ...details, name }).success).toBe(false);
});

test.each(['', 'person', 'person@', 'person@example', 'person name@example.com'])(
  'rejects invalid email %s',
  (email) => {
    expect(checkoutDetailsSchema.safeParse({ ...details, email }).success).toBe(false);
  },
);

test.each(['1'.repeat(13), '1'.repeat(19)])(
  'accepts card length boundaries without requiring a checksum',
  (cardNumber) => {
    expect(checkoutDetailsSchema.safeParse({ ...details, cardNumber }).success).toBe(true);
  },
);

test.each([
  '',
  '1'.repeat(12),
  '1'.repeat(20),
  '4111-1111-1111-1111',
  '4111x11111111111',
  '4111\t111111111111',
])('rejects invalid card input %s', (cardNumber) => {
  expect(checkoutDetailsSchema.safeParse({ ...details, cardNumber }).success).toBe(false);
});
