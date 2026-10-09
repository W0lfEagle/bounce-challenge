export function formatCardNumber(value: string): string {
  // Keep invalid characters visible so validation can explain the problem.
  if (!/^[0-9 ]*$/.test(value)) return value;
  const digits = value.replace(/ /g, '');
  return digits.match(/.{1,4}/g)?.join(' ') ?? '';
}
