import { formatCardNumber } from './card-number';

test.each([
  ['4111111111111111', '4111 1111 1111 1111'],
  ['1234567890123456789', '1234 5678 9012 3456 789'],
  ['4111  1111 1111 1111', '4111 1111 1111 1111'],
  ['', ''],
  ['4111x11111111111', '4111x11111111111'],
])('formats %s without hiding invalid characters', (input, expected) => {
  expect(formatCardNumber(input)).toBe(expected);
});
