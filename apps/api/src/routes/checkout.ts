import { checkoutRequestSchema, type ApiError } from '@bounce/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { getStore } from '../repositories/stores';

export function registerCheckoutRoutes(app: FastifyInstance, db: Database.Database) {
  app.post('/checkout', async (request, reply) => {
    const checkout = checkoutRequestSchema.safeParse(request.body);
    if (!checkout.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_CHECKOUT', message: 'Invalid checkout details.' },
      } satisfies ApiError);
    }

    const store = getStore(db, checkout.data.storeId);
    if (!store) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Store not found.' },
      } satisfies ApiError);
    }
    const selection = checkout.data.items[0];
    const item = store.checkoutItems.find((candidate) => candidate.id === selection.itemId);
    if (!item || selection.quantity < item.minQuantity || selection.quantity > item.maxQuantity) {
      return reply.code(400).send({
        error: { code: 'INVALID_CHECKOUT', message: 'Bag quantity is outside the store limits.' },
      } satisfies ApiError);
    }

    const totalCents = item.unitPriceCents * selection.quantity;
    if (checkout.data.expectedTotalCents !== totalCents || checkout.data.currency !== store.currency) {
      return reply.code(409).send({
        error: { code: 'PRICE_CHANGED', message: 'The price has changed. Review the updated total before booking.' },
        store,
      });
    }

    // Stub only: no database write or payment-provider call.
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    return { status: 'succeeded' };
  });
}
