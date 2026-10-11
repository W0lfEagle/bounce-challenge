import { test as base, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app';
import { startMockProvider } from './support/mock-provider';
import { startElixir } from './support/elixir';

type CheckoutFixture = {
  db: Database.Database;
  provider: Awaited<ReturnType<typeof startMockProvider>>;
  backend: 'node' | 'elixir';
};

export const test = base.extend<{ checkout: CheckoutFixture; backend: 'node' | 'elixir' }>({
  backend: ['node', { option: true }],
  checkout: async ({ backend }, use) => {
    const directory = mkdtempSync(join(tmpdir(), 'bounce-e2e-'));
    const path = join(directory, 'node.sqlite');
    const elixirPath = join(directory, 'elixir.sqlite');
    const provider = await startMockProvider({ holdPayments: true });
    const previousProviderUrl = process.env.PAYMENTS_API_URL;
    process.env.PAYMENTS_API_URL = provider.url;
    const app = buildApp({ databasePath: path, webOrigin: 'http://localhost:8082' });
    let elixir: Awaited<ReturnType<typeof startElixir>> | undefined;
    let db: Database.Database | undefined;

    try {
      await app.listen({ host: '127.0.0.1', port: 3002 });
      elixir = await startElixir({
        PORT: '3003',
        HOST: '127.0.0.1',
        WEB_ORIGIN: 'http://localhost:8082',
        DATABASE_PATH: elixirPath,
        PAYMENTS_API_URL: provider.url,
      });
      db = new Database(backend === 'node' ? path : elixirPath, { readonly: true });
      await use({ db, provider, backend });
    } finally {
      await provider.close();
      await elixir?.close();
      await app.close();
      db?.close();
      rmSync(directory, { recursive: true, force: true });
      if (previousProviderUrl === undefined) delete process.env.PAYMENTS_API_URL;
      else process.env.PAYMENTS_API_URL = previousProviderUrl;
    }
  },
});

export { expect };
