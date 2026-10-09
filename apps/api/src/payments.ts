import { z } from 'zod';

const transactionSchema = z.object({
  transaction_id: z.string().min(1),
  status: z.literal('completed'),
  amount: z.number().int().positive(),
  currency: z.string(),
  last_four_digits: z.string().regex(/^[0-9]{4}$/),
  payment_method: z.string(),
  timestamp: z.string(),
  merchant_reference: z.string(),
  processing_fee: z.number().int().nonnegative(),
});
const declineSchema = z.object({ detail: z.string(), error_code: z.string().min(1) });
const providerDeclineSchema = z.union([
  declineSchema,
  z.object({ detail: declineSchema }).transform((body) => body.detail),
]);
const validationErrorSchema = z.object({ detail: z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), type: z.string() })) });

export type PaymentInput = { name: string; email: string; amount: number; currency: string; cardNumber: string };
export type PaymentResult =
  | { status: 'succeeded'; transaction: z.infer<typeof transactionSchema> }
  | { status: 'declined'; errorCode: string }
  | { status: 'unknown'; errorCode?: string };
export type ProcessPayment = (input: PaymentInput) => Promise<PaymentResult>;
export const paymentTimeoutMs = 15000;

export async function processPayment(input: PaymentInput): Promise<PaymentResult> {
  try {
    const response = await fetch(process.env.PAYMENTS_API_URL ?? 'https://fullstack-challenge-api.usebounce.io/v1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, email: input.email, amount: input.amount, currency: input.currency, card_number: input.cardNumber }),
      signal: AbortSignal.timeout(paymentTimeoutMs),
      redirect: 'error',
    });
    const body: unknown = await response.json();
    if (response.status === 200) {
      const transaction = transactionSchema.safeParse(body);
      if (transaction.success && transaction.data.amount === input.amount && transaction.data.currency === input.currency && transaction.data.last_four_digits === input.cardNumber.slice(-4)) {
        return { status: 'succeeded', transaction: transaction.data };
      }
    }
    if (response.status === 400) {
      const decline = providerDeclineSchema.safeParse(body);
      if (decline.success) return { status: 'declined', errorCode: decline.data.error_code };
    }
    if (response.status === 422 && validationErrorSchema.safeParse(body).success) {
      return { status: 'declined', errorCode: 'PAYMENT_VALIDATION_FAILED' };
    }
    return { status: 'unknown', errorCode: [200, 400, 422].includes(response.status) ? 'INVALID_PROVIDER_RESPONSE' : 'UNEXPECTED_PROVIDER_STATUS' };
  } catch (error) {
    // A transport error does not establish that no charge occurred. Do not retry.
    const errorCode = error instanceof SyntaxError ? 'INVALID_PROVIDER_RESPONSE'
      : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'PROVIDER_TIMEOUT'
        : 'PROVIDER_NETWORK_ERROR';
    return { status: 'unknown', errorCode };
  }
}
