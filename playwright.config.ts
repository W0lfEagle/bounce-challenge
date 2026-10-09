import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/bounce-playwright-results',
  use: {
    baseURL: 'http://localhost:8082',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run web --workspace @bounce/web -- --port 8082',
    url: 'http://localhost:8082',
    reuseExistingServer: false,
    timeout: 120000,
    env: { CI: '1', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3002' },
  },
});
