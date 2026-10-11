import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockProvider } from './support/mock-provider';
import { startElixir } from './support/elixir';

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'bounce-demo-'));
  const provider = await startMockProvider();
  let elixir: Awaited<ReturnType<typeof startElixir>>;
  try {
    elixir = await startElixir({
      PORT: '3003',
      HOST: '127.0.0.1',
      WEB_ORIGIN: 'http://localhost:8082',
      DATABASE_PATH: join(directory, 'elixir.sqlite'),
      PAYMENTS_API_URL: provider.url,
    });
  } catch (error) {
    await provider.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const api = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '3002',
      HOST: '127.0.0.1',
      WEB_ORIGIN: 'http://localhost:8082',
      DATABASE_PATH: join(directory, 'checkout.sqlite'),
      PAYMENTS_API_URL: provider.url,
    },
  });
  const web = spawn(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'start', '--web', '--localhost', '--port', '8082'],
    {
      cwd: join(process.cwd(), 'apps/web'),
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3002',
        EXPO_PUBLIC_ELIXIR_API_URL: 'http://127.0.0.1:3003',
      },
    },
  );
  console.log(
    '\nDemo: http://localhost:8082\nChoose Node.js or Elixir in the backend picker. APIs: 3002 / 3003.\nCard endings: 1111 succeeds, 0002 declines, 0003 succeeds after three seconds.\nUse synthetic 16-digit card numbers. Stop with Ctrl-C.\n',
  );

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    const exited = Promise.all(
      [api, web].map((child) =>
        child.exitCode !== null || child.signalCode !== null || !child.pid
          ? Promise.resolve()
          : new Promise<void>((resolve) => child.once('exit', () => resolve())),
      ),
    );
    api.kill('SIGTERM');
    web.kill('SIGTERM');
    await elixir.close();
    await provider.close();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  for (const child of [api, web, elixir.child]) {
    child.once('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
      void stop();
    });
    child.once('exit', (code) => {
      if (!stopping) {
        process.exitCode = code ?? 1;
        void stop();
      }
    });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
