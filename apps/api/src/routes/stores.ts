import { storeParamsSchema, type ApiError } from '@bounce/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { getStore } from '../repositories/stores';

export function registerStoreRoutes(app: FastifyInstance, db: Database.Database) {
  app.get('/stores/:storeId', async (request, reply) => {
    const params = storeParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_STORE_ID', message: 'Invalid store identifier.' },
      } satisfies ApiError);
    }

    const store = getStore(db, params.data.storeId);
    if (!store) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Store not found.' },
      } satisfies ApiError);
    }
    return store;
  });
}
