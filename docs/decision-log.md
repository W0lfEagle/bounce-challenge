# Decision log

Record agreed decisions and their reasoning as the challenge develops. Keep proposals, assumptions, and open questions distinct from confirmed decisions. Update entries when new requirements change a decision.

## 2026-10-09 — Initial working agreements

### Confirmed

- Use TypeScript and React for the web app.
- Keep the solution appropriate for an interview: basic, readable, and easy to explain. Avoid unnecessary abstractions and dependencies.
- Review requirements, assumptions, edge cases, and validation needs before writing implementation code.
- Maintain this log so repository choices can be explained later.

### Initially pending (resolved below)

- Whether an API is needed. Fastify is a candidate, not a committed choice.
- All challenge-specific requirements and implementation choices, pending the challenge prompt.

### Review approach

For each meaningful decision, record the requirement it addresses, the chosen approach, its rationale and tradeoffs, and any assumptions or validation still needed. Add alternatives only when they materially explain the choice.

## 2026-10-09 — Architecture and checkout configuration

### Confirmed

- Adopt architecture A: Expo with React Native and TypeScript, a Fastify REST API, SQLite persistence, and shared Zod runtime schemas with inferred TypeScript types.
- Target web for implementation and review. Use React Native components to support a shared frontend for future Android and iOS deployment. Native deployment and verification are outside the current acceptance scope.
- Use Jest for all tests, with jest-expo and React Native Testing Library for frontend component tests. A single test runner avoids unnecessary tooling; Vitest is not needed.
- Represent USD amounts as integer cents.
- This store charges 590 cents per bag. Other stores may have different prices; store-specific pricing remains backend-owned.
- The backend provides store-specific pricing and minimum/maximum bag quantities to checkout. For this store, quantity bounds are 1 through 10 inclusive. Backend validation must enforce these bounds independently of the UI.
- The lead engineer approves significant architecture and implementation choices before code is written. Implement in small, reviewable increments once approved.

### Rationale and tradeoffs

- REST makes the small API explicit and easy to inspect without adding RPC framework conventions.
- SQLite keeps local setup simple while meeting the assignment's persistence requirement.
- Shared schemas provide runtime validation and compile-time contract types without sharing database models.
- Web is the current delivery target for ease of implementation; using Expo preserves the option of native delivery, which will still require platform testing.
- Store configuration comes from the API so the frontend does not independently own pricing or quantity rules. The backend remains authoritative when calculating the payment amount.

### Pending

- Agree the implementation time budget or an ordered stopping point if no fixed budget is available.
- Agree detailed validation and persistence/API behaviour before implementation.

## 2026-10-09 — Payment retry rules

### Confirmed

- An explicit provider decline preserves the form and allows a deliberate retry as a new payment attempt.
- Double clicks and repeated submissions for an existing attempt reuse its result or processing state without another provider call.
- If the browser loses connection to our backend, recover the existing attempt's saved result through our backend.
- If the backend loses the provider response, report that the payment could not be confirmed and block another charge for that unresolved attempt.
- Confirmed success is persisted; repeated requests return the saved result.

### Rationale and limitations

- A timeout does not establish that a payment failed. The documented provider exposes payment creation but no idempotency or transaction lookup operation, so an unknown provider outcome cannot always be resolved automatically.

## 2026-10-09 — Card-number input

### Confirmed

- Use a standard React Native text input with our own basic card-number validation and readable formatting.
- Do not add card-validator or a third-party card-input component for this exercise.
- Keep the field limited to the card number required by the mock API.

### Rationale and tradeoffs

- The exercise has a single card-number field, so a small implementation avoids an additional dependency and stays easy to explain.
- Local validation checks input structure; it cannot establish whether a card exists or whether payment will succeed.
- Presentation formatting must remain separate from the normalised number sent to the backend.

### Confirmed input rules

- Accept digits and spaces, removing spaces before submission.
- Display numbers in groups of four digits for readability.
- Accept 13–19 digits and repeat validation on the backend.
- Skip checksum validation, brand detection, and logos for this exercise.

## 2026-10-09 — Development scaffold

### Authorised scope

- Set up a running Expo web app and Fastify backend with working type-checking and test commands for both.
- Implement no checkout, booking, or payment details in this milestone.

### Setup choices

- Use npm workspaces with `apps/web` and `apps/api`, one root lockfile, and separate development commands. This keeps the two apps independent without an additional build orchestrator.
- Use the official blank TypeScript Expo template, with no routing or state-management dependency until needed.
- Use Node.js 24 and the stable Expo SDK selected by the template.
- Keep Fastify application creation separate from the listening process so Jest can exercise the health endpoint using request injection.
- Add one frontend rendering smoke test and one API health smoke test to prove that both test setups execute.
- Defer database integration and the shared-schema package until real contracts and persistence requirements are implemented.

### Verification

- Both workspace type checks pass.
- Frontend linting passes.
- Both Jest smoke tests pass.
- API compilation and Expo web export pass.
- The running API returns HTTP 200 and `{"status":"ok"}` at `/health`.
- The web development server renders the placeholder screen in the browser.
- Expo's dependency compatibility check passes.
- Jest uses its built-in file crawler rather than requiring a Watchman service.

### Known limitation

- The dependency audit still reports advisories in transitive Expo/React Native and Jest dependencies after compatible fixes. Forced fixes would change framework compatibility and were not applied. See the README for the affected dependency families.

## 2026-10-09 — Store catalogue from SQLite

### Authorised scope

- Persist Cody's Cookie Store and one bag checkout item, with a 590-cent USD price.
- Create tables through migrations and seed a fresh database.
- Share Zod schemas/types between API and frontend and display the fetched store and price.
- Include the previously agreed API-provided quantity bounds of 1–10.

### Implementation choices and reasoning

- Expose `GET /stores/:storeId`, using the stable identifier `codys-cookie-store` for the initial store. The frontend selects that store but does not own its name, price, currency, or bounds.
- Use two tables, `stores` and `checkout_items`, linked by a foreign key. Prices and quantity bounds belong to each store's bag item, allowing another store to have different values without adding bag types or sizes.
- Use `better-sqlite3` with parameterised SQL and no ORM. Short synchronous queries keep the implementation small; expensive queries would block the API and need reassessment at a larger scale. The native driver requires consistent Node.js versions during installation and execution.
- Apply numbered SQL migrations on startup, recording their filenames and applying each inside a transaction. The seed is a separate versioned migration. Do not rerun seeds or overwrite existing prices on restart.
- Add SQLite constraints for currency, integer prices, valid bounds, and store references. Validate outbound database data and inbound frontend responses with the same Zod store schema.
- Keep shared contracts in a small npm workspace compiled to JavaScript and declaration files. Build it during install and before root development/check commands; rebuild it after schema edits.
- Configure browser CORS for the development frontend origin. The API URL and allowed web origin can be overridden for other environments.
- Use predictable 400/404/500 errors; return no database or validation internals in 500 responses.
- Provide a loading state and manual retry for store fetch failures. Abort requests on unmount and ignore obsolete results.
- Pin React and the component test renderer to Expo-compatible versions. A newer auto-installed peer React caused hook errors and a React DOM version mismatch during verification.

### Scope boundary

- This milestone displays the catalogue; it does not implement bag selection, booking, card inputs, or payments.
- Only USD and a single bag item per store are currently supported, as agreed. Broader currencies or item types need a deliberate contract change.

### Verification

- All 19 Jest tests pass: 9 backend/database tests and 10 frontend tests.
- Type checking for the API, frontend, and contracts package passes; frontend linting and all builds pass.
- Tests cover fresh-file initialisation, seed repeatability and preservation of edits on restart, migration rollback, database constraints, shared response validation, 400/404/500 responses, CORS, frontend loading/retry, and request cancellation.
- The running API returns the seeded record and the web browser renders Cody's Cookie Store, $5.90 per bag, and quantity bounds of 1–10.

## 2026-10-09 — API structure

### Confirmed

- Separate HTTP handlers into `src/routes` and database queries into `src/repositories`, with tests beside each module.
- Route registration functions receive Fastify and, where needed, the database connection explicitly. Repositories receive the database connection and return API data without HTTP concerns.
- Keep connection/migration setup in `database.ts`, application composition and common error handling in `app.ts`, and process startup in `server.ts`.
- Do not introduce a service layer, repository classes/interfaces, or a dependency-injection framework for the current read-only endpoint. Reconsider a service layer when booking and payment orchestration require it.

### Rationale

- Clear boundaries make request behaviour and SQL easier to find and test without adding abstraction to a small app.

### Verification

- All 21 tests pass: 11 backend/database tests and 10 frontend tests.
- Repository tests verify missing-store behaviour and isolation of store-specific prices and quantity bounds.
- All workspace type checks, frontend linting, and API/contracts/web builds pass after the reorganisation.

## 2026-10-09 — Checkout UI

### Authorised scope

- Add plus/minus bag controls using the store item's minimum and maximum bounds.
- Display a live total calculated from the API-provided unit price and selected quantity, retaining integer cents for calculation.
- Add plain name, email, and card-details text inputs with no validation logic in this milestone. Card formatting and the previously agreed input validation rules are deferred.
- Show a Book CTA. Booking and payment submission remain outside this milestone; the button is disabled until submission is implemented, independently of input contents.

### Implementation choices

- Keep store loading and errors in `App.tsx`; put the loaded checkout form in a small `Checkout` component with local state. No form library or global state is needed.
- Start quantity at the item's minimum and disable controls at either bound. Clamp control updates to preserve the bounds during repeated presses.
- Derive the total instead of storing it as additional state, and format cents as USD only for display.
- Keep inputs in memory without logging, transmitting, or persisting their values.
- Use a scrollable layout so all fields and the summary remain reachable on smaller screens. Bag controls have accessible labels and disabled states.

### Verification

- All 24 tests pass: 11 backend/database tests and 13 frontend tests. New component tests cover quantity changes, API-provided bounds and pricing, totals, and preservation of unrestricted input text.
- All workspace type checks, frontend linting, and the Expo web build pass.
- Browser verification confirms the loaded checkout, labelled inputs, and a total change from $5.90 to $11.80 when increasing from one bag to two.

## 2026-10-09 — Shared static theme

### Confirmed

- Centralise semantic colours, spacing, radii, font sizes, and font weights in `apps/web/src/theme.ts`.
- Keep component styles in `StyleSheet.create`, referencing shared tokens instead of repeating visual values.
- Keep layout-specific dimensions local. No theme provider, styling library, or theme switching is needed yet.

### Implementation choices

- Use semantic colour names such as `surface`, `text`, and `disabledBackground`.
- Use a numeric spacing scale to preserve the current layout while giving components a common set of values.
- Export a typed constant object with no added runtime dependency.

### Future UI polish

- Revisit a light/dark theme switch with a delightful animated colour transition. Consider accessibility and reduced-motion preferences when designing the animation.
- The user asked to record this idea for a future UI polish step, rather than schedule a timed reminder.
