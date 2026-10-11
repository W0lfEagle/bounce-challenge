import { buildApp } from './app';
import { loggerOptions } from './logging';

async function start() {
  const app = buildApp({
    logger: loggerOptions,
    databasePath: process.env.DATABASE_PATH,
    webOrigin: process.env.WEB_ORIGIN,
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch((error: unknown) => {
        app.log.error(error);
        process.exitCode = 1;
      });
    });
  }

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
