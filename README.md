# Bounce Challenge

Minimal TypeScript scaffold for an Expo/React Native frontend targeting web and a Fastify backend.

This milestone includes a placeholder screen, a backend health endpoint, type checking, and Jest smoke tests. Booking, checkout, payment integration, database persistence, and shared API schemas will be implemented in later milestones after their details are agreed.

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm 11

## Setup

From the repository root:

```sh
npm ci
```

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

Both commands watch for changes. The frontend is a standalone placeholder and does not call the backend yet.

The API listens on loopback by default. Override `PORT` or `HOST` when needed, for example `PORT=3001 npm run dev:api`. Expo may offer another port if 8081 is occupied.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run check
```

`check` runs type checking for both workspaces, frontend linting, and both test suites. Jest uses `jest-expo` and React Native Testing Library for the frontend, and `ts-jest` with Fastify request injection for the API.

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

This exports the web app to `apps/web/dist` and compiles the API to `apps/api/dist`. Run the compiled API with `npm start --workspace @bounce/api`.

## Layout

- `apps/web`: Expo app, retaining the option of future Android and iOS delivery. Native builds have not been verified.
- `apps/api`: Fastify app factory, process entry point, and health test.
- `docs/decision-log.md`: agreed decisions, reasoning, and open questions.

npm workspaces provide one dependency install and lockfile without an additional build orchestrator. The Expo app uses the blank TypeScript template; routing and state-management libraries are deferred until needed.

## Dependency advisory status

The initial dependency audit reports advisories in the Expo/React Native and Jest toolchains, including transitive `braces`, `node-forge`, `sprintf-js`, and `uuid` dependencies. Compatible fixes were applied; advisories remain. Forced audit fixes suggest incompatible framework changes, including an Expo downgrade, so they were not applied. Recheck with `npm audit` when updating dependencies; the install is not advisory-free.
