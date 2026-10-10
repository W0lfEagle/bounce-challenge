import { test as base, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app';
import { startMockProvider } from './support/mock-provider';

type CheckoutFixture = {
  db: Database.Database;
  provider: Awaited<ReturnType<typeof startMockProvider>>;
};

export const test = base.extend<{ checkout: CheckoutFixture }>({
  checkout: async ({}, use) => {
    const directory = mkdtempSync(join(tmpdir(), 'bounce-e2e-'));
    const path = join(directory, 'checkout.sqlite');
    const provider = await startMockProvider({ holdPayments: true });
    const previousProviderUrl = process.env.PAYMENTS_API_URL;
    process.env.PAYMENTS_API_URL = provider.url;
    const app = buildApp({ databasePath: path, webOrigin: 'http://localhost:8082' });
    const db = new Database(path, { readonly: true });

    try {
      await app.listen({ host: '127.0.0.1', port: 3002 });
      await use({ db, provider });
    } finally {
      await provider.close();
      await app.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
      if (previousProviderUrl === undefined) delete process.env.PAYMENTS_API_URL;
      else process.env.PAYMENTS_API_URL = previousProviderUrl;
    }
  },
});

export { expect };
