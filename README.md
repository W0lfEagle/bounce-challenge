# Bounce Challenge

TypeScript project with an Expo/React Native frontend targeting web and a Fastify backend.

The frontend loads Cody's Cookie Store and its bag price from a SQLite-backed API. Shared Zod schemas validate store data on the server and in the frontend. Checkout includes a bounded bag counter, a live total, and validated name, email, and card-number inputs. Book sends a validated request to a temporary checkout stub, shows a spinner while pending, and displays a simulated payment-success screen after two seconds. No real payment or booking is created.

Names must be non-empty after trimming, emails use Zod's standard email validation after trimming, and card numbers accept only digits/spaces with 13–19 digits after spaces are removed. No checksum or brand validation is performed. Errors appear after leaving a field and update as values change. The card display is grouped in fours on blur to avoid moving the cursor during editing. Submission sends trimmed names/emails, a digits-only card number, the store ID, and quantity to our backend. Use synthetic card data for this stub; values are not logged or persisted, and no third-party payment call is made.

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm 11

## Setup

From the repository root:

```sh
npm ci
```

Installation builds the shared contracts package. Use Node.js 24 consistently: the SQLite driver includes a native binary tied to the Node.js runtime used during installation.

## Development

Run these in separate terminals from the repository root:

```sh
npm run dev:web
```

```sh
npm run dev:api
```

- Web: http://localhost:8081
- API health: http://127.0.0.1:3000/health
- Store: http://127.0.0.1:3000/stores/codys-cookie-store

Both commands watch for app changes and build shared contracts before starting. After editing `packages/contracts`, run `npm run build --workspace @bounce/contracts` or restart development commands.

The API listens on loopback by default. Override `PORT` or `HOST` when needed, for example `PORT=3001 npm run dev:api`. Expo may offer another port if 8081 is occupied.

The frontend defaults to `http://127.0.0.1:3000`. To override it, copy `apps/web/.env.example` to `apps/web/.env` and set `EXPO_PUBLIC_API_URL`, then restart Expo. This is a public URL, not a place for secrets. Set `WEB_ORIGIN` on the API if using a web origin other than `http://localhost:8081`. Native devices will need a reachable API URL; native deployment remains outside this milestone.

## Database and migrations

The API creates `apps/api/data/bounce.sqlite` on first startup. Set `DATABASE_PATH` to use another file. Database files are ignored by Git.

Startup applies pending SQL files in `apps/api/migrations` in filename order and records successful migrations in `schema_migrations`. Each migration runs transactionally; a failure rolls it back and prevents API startup. Migrations are forward-only: add a new numbered file rather than changing a previously applied migration.

You can also apply migrations without starting the server:

```sh
npm run db:migrate
```

The initial schema has `stores` and `checkout_items` tables, with foreign keys and constraints for integer pricing and valid quantity bounds. A separate seed migration inserts Cody's Cookie Store and its single bag item (590 USD cents, quantity 1–10). Applied migrations are skipped, so restarts neither duplicate the records nor reset edited prices.

The driver is `better-sqlite3`; queries use plain SQL and bound parameters, without an ORM. Its synchronous calls are appropriate for this small local application; expensive queries would block the API process.

## Store endpoint

`GET /stores/:storeId` returns:

```json
{
  "id": "codys-cookie-store",
  "name": "Cody's Cookie Store",
  "currency": "USD",
  "checkoutItems": [
    {
      "id": "bag",
      "name": "Bag",
      "unitPriceCents": 590,
      "minQuantity": 1,
      "maxQuantity": 10
    }
  ]
}
```

Invalid store identifiers return 400; unknown stores return 404. Errors use `{ "error": { "code": "...", "message": "..." } }`. Internal failures return a generic 500 message. The frontend displays loading and retry states and does not render unvalidated response data.

## Temporary checkout endpoint

`POST /checkout` accepts JSON containing `storeId`, `items: [{ "itemId": "bag", "quantity": 2 }]`, `expectedTotalCents`, `currency`, `name`, `email`, and `cardNumber`. The array must contain exactly one bag entry for this milestone; empty arrays, duplicates, unknown items, and invalid quantities are rejected. The backend reads the current item price and quantity bounds from SQLite and computes the total in cents.

If the expected total or currency differs, the API returns HTTP 409 with `PRICE_CHANGED` and the current store data, before starting the stub. The frontend validates that data, updates the price/total, preserves the form, and requires a new Book action even if the price decreased. Matching requests wait two seconds and return `{ "status": "succeeded" }`. The expected total is a comparison value, not a trusted charge amount.

This is a practice endpoint with no booking writes, transaction IDs, payment-provider calls, or payment guarantees. The frontend locks the form while pending, prevents repeated submissions, validates the response before showing success, and clears the card number from component state on success. Failed requests preserve the form for another attempt; this is safe for the stub and must be revisited under the agreed unknown-payment rules before real payment integration.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run check
```

`check` runs type checking for all workspaces, frontend linting, and both test suites. Jest uses `jest-expo` and React Native Testing Library for the frontend, and `ts-jest` with Fastify request injection for the API. Database tests use isolated memory or temporary-file databases.

Run checks for one app:

```sh
npm run typecheck --workspace @bounce/web
npm test --workspace @bounce/web
npm run typecheck --workspace @bounce/api
npm test --workspace @bounce/api
```

Watch tests with `npm run test:watch --workspace @bounce/web` or `npm run test:watch --workspace @bounce/api`.

## Builds

```sh
npm run build
```

This builds shared contracts first, exports the web app to `apps/web/dist`, and compiles the API to `apps/api/dist`. Run the compiled API with `npm start --workspace @bounce/api`. Keep `apps/api/migrations` alongside the API build; the compiled server reads these SQL files at startup.

## Layout

- `apps/web`: Expo app, retaining the option of future Android and iOS delivery. Native builds have not been verified.
  - `src/components`: checkout UI; `src/api`: store and checkout API clients and shared API URL.
  - `src/lib`: pure helpers such as card formatting; `src/theme.ts`: shared visual tokens.
- `apps/api`: Fastify endpoints, SQLite queries, migrations, and backend tests.
  - `src/routes`: HTTP request validation and responses; calls repository functions.
  - `src/repositories`: parameterised database queries and conversion to API data.
  - `src/app.ts`: Fastify setup, route registration, error handling, and database lifecycle.
  - `src/database.ts`: database connections and migrations; `src/server.ts`: process startup.
- `packages/contracts`: shared Zod schemas and inferred API types. Database models remain server-only.
- `docs/decision-log.md`: agreed decisions, reasoning, and open questions.

npm workspaces provide one dependency install and lockfile without an additional build orchestrator. The Expo app uses the blank TypeScript template; routing and state-management libraries are deferred until needed.

React and `test-renderer` versions are pinned through root overrides to match Expo SDK 57. This prevents npm from installing a newer peer React copy that causes hook errors and React DOM version mismatches.

Frontend styles reference the static tokens in `apps/web/src/theme.ts` for colours, spacing, radii, and typography. Component-specific layout dimensions stay local. Dark mode with an animated colour transition is recorded as a future UI polish idea.

## Dependency advisory status

The initial dependency audit reports advisories in the Expo/React Native and Jest toolchains, including transitive `braces`, `node-forge`, `sprintf-js`, and `uuid` dependencies. Compatible fixes were applied; advisories remain. Forced audit fixes suggest incompatible framework changes, including an Expo downgrade, so they were not applied. Recheck with `npm audit` when updating dependencies; the install is not advisory-free.
