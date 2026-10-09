import { buildApp } from './app';

async function start() {
  const app = buildApp({ logger: true });
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
