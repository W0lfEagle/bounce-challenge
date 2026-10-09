import { buildApp } from './app';

test('serves the health endpoint', async () => {
  const app = buildApp({ databasePath: ':memory:' });

  try {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  } finally {
    await app.close();
  }
});
