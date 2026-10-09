# Bounce Challenge

TypeScript project with an Expo/React Native frontend targeting web and a Fastify backend.

The frontend loads Cody's Cookie Store and its bag price from a SQLite-backed API. Shared Zod schemas validate store data on the server and in the frontend. Checkout includes a bounded bag counter, a live total, and plain name, email, and card-number inputs. Input validation and booking/payment submission are later milestones; the Book button is currently disabled.

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
