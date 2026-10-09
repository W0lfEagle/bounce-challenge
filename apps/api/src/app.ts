import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { type ApiError } from '@bounce/contracts';
import { openDatabase } from './database';
import { registerStoreRoutes } from './routes/stores';
import { registerHealthRoutes } from './routes/health';
import { registerCheckoutRoutes } from './routes/checkout';
import { processPayment, type ProcessPayment } from './payments';

type AppOptions = FastifyServerOptions & {
  databasePath?: string;
  webOrigin?: string;
  pay?: ProcessPayment;
};

export function buildApp({
  databasePath,
  webOrigin = 'http://localhost:8081',
  pay = processPayment,
  ...options
}: AppOptions = {}) {
  const db = openDatabase(databasePath);
  const app = Fastify(options);

  app.addHook('onClose', async () => db.close());
  app.register(cors, { origin: webOrigin, methods: ['GET', 'POST'] });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request.' },
      } satisfies ApiError);
    }
    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    } satisfies ApiError);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Resource not found.' },
    } satisfies ApiError),
  );

  registerHealthRoutes(app);
  registerStoreRoutes(app, db);
  registerCheckoutRoutes(app, db, pay);

  return app;
}
