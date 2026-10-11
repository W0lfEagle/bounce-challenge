import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';

/** Start a real Elixir API and wait until migrations and HTTP startup have finished. */
export async function startElixir(env: Record<string, string>) {
  const child = spawn('mix', ['run', '--no-halt'], {
    cwd: join(process.cwd(), 'apps/api-elixir'),
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  let error: Error | undefined;
  child.once('error', (cause) => {
    error = cause;
  });

  async function close() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (error)
        throw new Error(
          `Unable to start Elixir: ${error.message}. Install Elixir and run npm run setup:elixir.`,
        );
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          'Elixir exited during startup. Run npm run setup:elixir and check its output.',
        );
      try {
        const response = await fetch(`http://127.0.0.1:${env.PORT}/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return { child, close };
      } catch {
        /* Startup has not finished yet. */
      }
      await delay(100);
    }
    throw new Error('Elixir did not become healthy within 60 seconds.');
  } catch (cause) {
    await close();
    throw cause;
  }
}
