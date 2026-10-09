# Bounce Challenge

TypeScript project with an Expo/React Native frontend targeting web and a Fastify backend.

The frontend loads Cody's Cookie Store and its bag price from a SQLite-backed API. Shared Zod schemas validate store data on the server and in the frontend. Book submits a validated checkout to the backend, which persists a booking/payment attempt and calls the supplied mock payments API. Success shows a booking-confirmation screen; an explicit decline shows the failure message and Retry button. The provider is a simulation, so use synthetic card details.

Names must be non-empty after trimming, emails use Zod's standard email validation after trimming, and card numbers accept only digits/spaces with 13–19 digits after spaces are removed. No checksum or brand validation is performed. Errors appear after leaving a field and update as values change. The card display is grouped in fours on blur to avoid moving the cursor during editing. Full card numbers are transmitted to the mock provider through our backend but are not logged or stored. Customer name/email, accepted pricing, and validated transaction metadata are persisted.

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

## Checkout and payments

`POST /checkout` accepts JSON containing UUID `checkoutId` and `attemptId` values, `storeId`, `items: [{ "itemId": "bag", "quantity": 2 }]`, `expectedTotalCents`, `currency`, `name`, `email`, and `cardNumber`. The array must contain exactly one bag entry; empty arrays, duplicates, unknown items, and invalid quantities are rejected. The backend reads current item prices and bounds from SQLite and computes the total in cents.

Before a new payment attempt, a price/currency mismatch returns HTTP 409 with `PRICE_CHANGED` and current store data. The frontend updates the total and requires another deliberate Book action, even if the price decreased. The expected total is a comparison value, not a trusted charge amount. A repeated attempt returns its existing result without consulting current prices or charging again.

The API responds with `{ "checkoutId": "...", "attemptId": "...", "status": "succeeded|declined|processing|unknown" }`. Confirmed success and explicit declines return HTTP 200; processing/unknown results return 202. `GET /checkout/:checkoutId` retrieves the latest attempt without making a provider call or returning customer/card information. Status responses are not cacheable.

The backend calls `https://fullstack-challenge-api.usebounce.io/v1/payments` by default. Override `PAYMENTS_API_URL` in the API process environment for a test provider. The request uses integer cents and the provider's documented `card_number` field. Success requires a valid completed transaction with matching amount, currency, and last four digits; processing fees are stored separately and do not increase the advertised charge. There is no artificial two-second delay anymore.

Provider requests have a 15-second deadline. Explicit 400 declines and documented 422 validation rejections permit a deliberate new payment attempt. Transport failures, timeouts, unexpected statuses, malformed responses, and unverifiable success data produce an unknown outcome and are never automatically retried. A stale processing attempt becomes unknown after 20 seconds when its status is next checked.

Bookings store immutable accepted item prices, quantities, currency, total, and customer details. Payment attempts store status and validated transaction metadata, including transaction ID, processing fee, and last four digits. Short SQLite transactions claim an attempt before contacting the provider and atomically persist success/booking confirmation afterward. Unique attempt IDs and a database constraint prevent concurrent unresolved attempts for one booking. Reusing IDs with changed non-card checkout details returns `REQUEST_CONFLICT`.

The frontend covers the whole checkout with a dark “Placing Booking” overlay while submitting, matching the Figma loading state. The underlying form is locked and hidden from accessibility navigation. Confirmed success displays the centred “Booking Placed!” message and clears browser recovery IDs, so the next reload begins an empty checkout with new IDs generated on Book. Database booking and transaction records remain intact. A previously saved successful attempt is recovered once and cleared; the following reload starts fresh.

An explicit decline displays “Your booking has failed. Please try again.” and Retry. An unchanged checkout reuses its checkout ID with a fresh attempt ID; edits after a decline create a new checkout. A lost backend response triggers a status lookup, not another payment. Unknown outcomes keep the form editable and replace Book with an explicit “Start over” action for this mock-only demo. Start over clears browser recovery IDs, preserves the current input values, and makes no payment request; a subsequent Book creates a new checkout identity. The old unresolved attempt remains in the database and is still protected against replay. This deliberate demo escape can create another mock transaction and is not a production reconciliation strategy.

Recovery on reload still uses “Checking payment status” wording. Names, emails, and card numbers are never placed in browser storage; only recovery IDs are kept in tab session storage, with an in-memory fallback. The IDs permit status recovery and should be treated as opaque capabilities. Native restart recovery needs durable native storage before native deployment.

The mock provider offers neither idempotency keys nor transaction lookup/refunds. A charge followed by a lost response or failed database write may therefore remain unknown. Local idempotency prevents replaying known attempts, but does not provide an exactly-once guarantee across that provider boundary. Unknown attempts block further charges for the same checkout and require external reconciliation; the app has no reconciliation/admin workflow in this exercise. The explicit demo reset permits a separate new checkout despite that uncertainty. Keeping the same IDs when a status lookup finds no record also prevents a late original request from racing a second charge.

Provider decline parsing accepts strictly validated top-level and wrapped decline envelopes on HTTP 400. Unknown results record safe diagnostic codes in `payment_attempts.error_code` (for example `PROVIDER_TIMEOUT`, `PROVIDER_NETWORK_ERROR`, `INVALID_PROVIDER_RESPONSE`, or `PAYMENT_PERSISTENCE_FAILED`), without storing raw provider payloads or full card numbers. Older unknown records without a reason cannot be retrospectively classified as declines.

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
  - `src/services/checkout.ts`: checkout claiming, price confirmation, and payment orchestration.
  - `src/payments.ts`: the mock-provider client and response validation.
  - `src/app.ts`: Fastify setup, route registration, error handling, and database lifecycle.
  - `src/database.ts`: database connections and migrations; `src/server.ts`: process startup.
- `packages/contracts`: shared Zod schemas and inferred API types. Database models remain server-only.
- `docs/decision-log.md`: agreed decisions, reasoning, and open questions.

npm workspaces provide one dependency install and lockfile without an additional build orchestrator. The Expo app uses the blank TypeScript template; routing and state-management libraries are deferred until needed.

React and `test-renderer` versions are pinned through root overrides to match Expo SDK 57. This prevents npm from installing a newer peer React copy that causes hook errors and React DOM version mismatches.

Frontend styles reference the static tokens in `apps/web/src/theme.ts` for colours, spacing, radii, and typography. Component-specific layout dimensions stay local. Dark mode with an animated colour transition is recorded as a future UI polish idea.

## Dependency advisory status

The initial dependency audit reports advisories in the Expo/React Native and Jest toolchains, including transitive `braces`, `node-forge`, `sprintf-js`, and `uuid` dependencies. Compatible fixes were applied; advisories remain. Forced audit fixes suggest incompatible framework changes, including an Expo downgrade, so they were not applied. Recheck with `npm audit` when updating dependencies; the install is not advisory-free.
