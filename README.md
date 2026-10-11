# Bounce Booking

A single-store bag booking flow: select a quantity, enter customer and synthetic card details, and book through either a Node/Fastify or Elixir/Plug API. Both use SQLite and the supplied mock payment provider. The frontend is an Expo/React Native app targeting web, with a backend demo picker.

Learn from the working port: [Porting our Node backend to Elixir](docs/node-to-elixir.md), [Elixir syntax reference](docs/elixir-syntax-reference.md), and [Elixir API setup](apps/api-elixir/README.md). The tutorial links corresponding source files and explains syntax, pattern matching, processes, supervision, persistence, and tradeoffs.

Sources: [challenge brief](https://you.ashbyhq.com/Bounce/assignment/5b7a5a3c-8a66-4d2a-a511-1bdabbbf3d42), [Figma flow](https://www.figma.com/design/OcHovHR2QBveB3Q0j1ogkc/Bounce-FullStack-Challenge?node-id=1-3604), [payment API documentation](https://fullstack-challenge-api.usebounce.io/v1/docs).

## Quick start

Prerequisites: Node.js 24 (`.nvmrc`), npm 11, and Elixir 1.18+ with compatible Erlang/OTP ([installation guide](https://elixir-lang.org/install.html); verified with Elixir 1.20.4 / OTP 29). Use the same Node version for installation and execution because SQLite uses a native driver.

```sh
npm ci
npm run setup:elixir
npm run demo
```

Open [http://localhost:8082](http://localhost:8082) and choose Node.js or Elixir above the checkout. The demo starts the real frontend, both APIs, and a local deterministic payment simulator with separate temporary databases. It requires ports 8082, 3002 (Node), and 3003 (Elixir) to be free. Stop with Ctrl-C; the temporary databases are removed. Switching resets the form; returning to a backend recovers its pending booking. Reload remembers the selection.

Use a name such as `Reviewer Example`, email `reviewer@example.com`, and one of these synthetic numbers:

| Card number | Local demo behavior |
| --- | --- |
| `4111 1111 1111 1111` | Success |
| `4111 1111 1111 0002` | Explicit decline; change to the success number and press Retry |
| `4111 1111 1111 0003` | Success after three seconds; reload while waiting to see status recovery |

These behaviors belong to the local simulator. The supplied provider has its own behavior.

To use the supplied provider, run these commands in separate terminals:

```sh
npm run dev:web
npm run dev:api
npm run dev:elixir
```

Web: [http://localhost:8081](http://localhost:8081). Node API: [health](http://127.0.0.1:3000/health), [store](http://127.0.0.1:3000/stores/codys-cookie-store). Elixir API: [health](http://127.0.0.1:3001/health), [store](http://127.0.0.1:3001/stores/codys-cookie-store). The provider is a simulation; use synthetic card details. Node-only development remains available without an Elixir runtime.

## Reviewer reading path

| Requirement | Start here | Representative verification |
| --- | --- | --- |
| Booking flow from Figma | [checkout coordinator](apps/web/src/components/Checkout.tsx), [form](apps/web/src/components/CheckoutForm.tsx) | [component tests](apps/web/src/components/Checkout.test.tsx) |
| Backend booking logic | [checkout service](apps/api/src/services/checkout.ts) | [HTTP checkout tests](apps/api/src/routes/checkout.test.ts) |
| Supplied payment integration | [provider adapter](apps/api/src/payments.ts) | [provider tests](apps/api/src/payments.test.ts) |
| Database persistence | [booking queries](apps/api/src/repositories/bookings.ts), [migrations](apps/api/migrations) | [restart/confirmation tests](apps/api/src/routes/checkout.test.ts), [migration tests](apps/api/src/database.test.ts) |
| End-to-end behavior | [browser checks](e2e/checkout.spec.ts) | Real frontend, HTTP API, adapter and SQLite; only the external provider is simulated |

Read the [shared contracts](packages/contracts/src/index.ts) first, then [Checkout.tsx](apps/web/src/components/Checkout.tsx) for submission, accepted terms, result handling and reset decisions, and the [attempt policy](apps/web/src/lib/checkout-attempt.ts) for retry identities. For field behavior or lifecycle detail, [CheckoutForm.tsx](apps/web/src/components/CheckoutForm.tsx) owns validation and presentation, while adjacent [recovery mechanics](apps/web/src/components/checkout-recovery.ts) handle cancellable status polling. The form stays mounted through failures and pending requests to preserve inputs. The backend service keeps claim → provider → persist visible in one place.

[Design and API details](docs/design.md) include payment-response coverage and sequence/state diagrams. [Architecture and application boundaries](docs/architecture.md) show current components, the universal web/iOS/Android layout and proposed wider application modules. [Operations](docs/operations.md) covers structured logs, proposed monitors and uncertain-payment triage. [Current decisions](docs/decision-log.md) record tradeoffs; the [reviewer guide](docs/reviewer-guide.md) provides a walkthrough and verification checklist.

## Verify

```sh
npm run check
npm run check:elixir
npm run build
npm run format:check
npx playwright install chromium
npm run test:e2e
```

`check` runs workspace type checks, frontend linting and the Jest suites. `check:elixir` checks formatting, compiles with warnings treated as errors, and runs ExUnit. Tests use isolated in-memory or temporary SQLite databases. The browser suite runs the same scenarios against both backends using Chromium, ports 8082/3002/3003 and fresh databases per scenario; it makes no calls to the supplied provider. It also checks switching during pending payments and the test harness's types. Browser failure traces are saved under `/tmp/bounce-playwright-results`.

`build` compiles contracts and the API and exports the frontend to `apps/web/dist`. Run the compiled API with `npm start --workspace @bounce/api`; keep `apps/api/migrations` alongside it. `npm run format` applies the repository's formatting rules. App-specific checks and test watch commands are available in each workspace.

## Scope and tradeoffs

- Web is the verified delivery target. Expo preserves the option of native delivery; Android/iOS builds and durable native recovery have not been verified.
- One USD bag item is supported. The solution chooses $5.90 and quantities 1–10 for this store; the server owns those values and validates them again before payment.
- Integer cents avoid floating-point price calculations. A changed total or quantity limit updates the form and requires another deliberate Book action.
- Local attempt IDs prevent replaying a payment. A timeout cannot establish whether the provider charged: unknown outcomes retain their IDs. The provider exposes no documented idempotency, lookup or refund operation, so this is not an exactly-once payment guarantee.
- Reload starts fresh after success or an explicit decline. Browser recovery remembers unfinished submissions only; Retry on the current page still keeps the declined checkout and creates a fresh attempt.
- “Start over” is a deliberate escape after an unknown result in this mock demo. It can create a second mock transaction. A production checkout would need reconciliation before offering another purchase after uncertainty.
- Full card numbers remain in memory and transit to the provider; they are never logged or stored. Browser recovery stores only opaque IDs. Customer details and accepted prices are saved in SQLite.
- Checkout logs correlate provider and persisted outcomes without customer/card data. Monitoring infrastructure and provider reconciliation are described as future work.

## Configuration

Node creates `apps/api/data/bounce.sqlite`; Elixir creates `apps/api-elixir/data/bounce.sqlite`. Both apply numbered SQL migrations on startup. Set `DATABASE_PATH` for a different file; each backend must use its own database because request fingerprints have different internal encodings. Run `npm run db:migrate` to migrate Node without starting the server. Add new migrations rather than editing already-applied ones, and keep Elixir's packaged `priv/migrations` copies synchronized.

Both APIs accept `PORT`, `HOST`, `WEB_ORIGIN` and `PAYMENTS_API_URL`. Node defaults to port 3000 and Elixir to 3001. The frontend defaults to `http://127.0.0.1:3000` and `http://127.0.0.1:3001`; copy `apps/web/.env.example` to `apps/web/.env` to set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ELIXIR_API_URL`, then restart Expo. These public URLs are not a place for secrets. Keep each API's allowed origin aligned with the frontend URL.

Shared contracts build during installation and before root development/check commands. After changing them, rebuild with `npm run build --workspace @bounce/contracts` or restart development commands.

The Expo/React Native and Jest dependency trees contain transitive security advisories. Compatible fixes were applied; forced audit fixes would change framework compatibility. Recheck `npm audit` when updating dependencies.
