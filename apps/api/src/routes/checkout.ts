import { checkoutRequestSchema, checkoutResponseSchema, type ApiError } from '@bounce/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  CheckoutError,
  checkout as processCheckout,
  getCheckoutStatus,
} from '../services/checkout';
import type { ProcessPayment } from '../payments';

export function registerCheckoutRoutes(
  app: FastifyInstance,
  db: Database.Database,
  pay: ProcessPayment,
) {
  // TODO(production): bind submission/replay and status reads to a verified user or guest session.
  app.post('/checkout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const checkout = checkoutRequestSchema.safeParse(request.body);
    if (!checkout.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_CHECKOUT', message: 'Invalid checkout details.' },
      } satisfies ApiError);
    }

    try {
      const result = await processCheckout(db, checkout.data, pay, request.log);
      const statusCode = result.status === 'processing' || result.status === 'unknown' ? 202 : 200;
      return reply.code(statusCode).send(result);
    } catch (error) {
      if (error instanceof CheckoutError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          ...(error.store && { store: error.store }),
        });
      }
      throw error;
    }
  });

  app.get('/checkout/:checkoutId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = checkoutResponseSchema.pick({ checkoutId: true }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid checkout identifier.' },
      } satisfies ApiError);
    }
    const result = getCheckoutStatus(db, params.data.checkoutId, request.log);
    if (!result) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Checkout not found.' },
      } satisfies ApiError);
    }
    return result;
  });
}
