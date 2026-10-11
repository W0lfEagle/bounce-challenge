# Bounce Elixir API

The Node API continues to live in `../api`. This backend implements the same HTTP booking contract using Elixir, Plug/Bandit, Req, and Exqlite. Start with the [Node-to-Elixir tutorial](../../docs/node-to-elixir.md) and [syntax reference](../../docs/elixir-syntax-reference.md).

## Setup and run

Install Elixir 1.18+ with compatible Erlang/OTP ([installation](https://elixir-lang.org/install.html)). Verified with Elixir 1.20.4 / OTP 29. From the repository root:

```sh
npm run setup:elixir
npm run dev:elixir
```

The health route is [127.0.0.1:3001/health](http://127.0.0.1:3001/health). Run `npm run dev:api` and `npm run dev:web` in separate terminals, then select a backend in the web app. `npm run demo` starts both APIs, the web app, and a deterministic local provider with fresh separate databases.

## Configuration

| Environment variable | Default |
| --- | --- |
| `PORT` | `3001` |
| `HOST` | `127.0.0.1` (an IP address) |
| `DATABASE_PATH` | `apps/api-elixir/data/bounce.sqlite` |
| `WEB_ORIGIN` | `http://localhost:8081` |
| `PAYMENTS_API_URL` | `https://fullstack-challenge-api.usebounce.io/v1/payments` |

Runtime configuration is read when the application starts. The frontend uses `EXPO_PUBLIC_ELIXIR_API_URL` for this API and `EXPO_PUBLIC_API_URL` for Node; restart Expo after changing either.

Each backend owns its database. Although the SQL schema matches, fingerprints are private to each implementation; sharing a booking database between runtimes is not supported. The `priv/migrations` SQL is packaged with the application. Keep it synchronized with Node's migrations; an ExUnit test checks this.

## Verify and release

```sh
npm run check:elixir
npm run test:e2e

cd apps/api-elixir
MIX_ENV=prod mix release
PORT=3001 _build/prod/rel/bounce/bin/bounce start
```

The browser suite runs the same checkout scenarios against both implementations and verifies switching away from a pending payment. ExUnit tests run with isolated SQLite databases, without starting the default HTTP server or calling the supplied external provider. Build releases for the deployment operating system and architecture because SQLite has a native component.
