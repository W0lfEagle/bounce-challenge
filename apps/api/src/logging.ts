import type { PaymentResult } from './payments';

// Event fields are explicitly selected; redaction is a second line of defence.
export const loggerOptions = {
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'req.body',
      'body',
      'name',
      'email',
      'cardNumber',
      'card_number',
      'signature',
      'request_fingerprint',
      'transaction',
      'providerBody',
    ],
    censor: '[REDACTED]',
  },
};

const unknownDiagnosticCodes = new Set([
  'INVALID_PROVIDER_RESPONSE',
  'UNEXPECTED_PROVIDER_STATUS',
  'PROVIDER_NETWORK_ERROR',
  'PROVIDER_TIMEOUT',
  'PROVIDER_REQUEST_FAILED',
]);

export function paymentDiagnostic(result: PaymentResult): string | undefined {
  if (result.status === 'succeeded') return undefined;
  if (result.status === 'declined') {
    return result.errorCode === 'PAYMENT_VALIDATION_FAILED'
      ? 'PAYMENT_VALIDATION_FAILED'
      : 'PAYMENT_DECLINED';
  }
  // Provider codes are arbitrary strings, so never copy them into operational logs.
  return result.errorCode && unknownDiagnosticCodes.has(result.errorCode)
    ? result.errorCode
    : 'PAYMENT_OUTCOME_UNKNOWN';
}
