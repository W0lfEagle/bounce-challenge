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

## 2026-10-09 — Frontend checkout validation

### Confirmed

- Require a non-empty trimmed name without restricting name characters.
- Require a valid email after trimming surrounding whitespace; do not change its case.
- Accept only digits and ordinary spaces in card details, with 13–19 digits after removing spaces. Do not require a checksum, brand detection, expiry, or CVC.
- Format the card display into groups of four digits.
- Enable Book when the form is valid. The user explicitly approved that the button need not perform an action yet; booking/payment calls remain pending.

### Implementation choices

- Add a shared Zod checkout-details schema so validation and normalisation can later be reused by the backend. This does not define the complete booking API contract yet.
- Show inline errors only after blur, then update errors on changes to touched fields. Do not show errors on an untouched empty form.
- Format card text on blur rather than every keystroke to preserve normal cursor behaviour during edits. Preserve invalid characters so the UI can explain them rather than silently converting invalid input into a valid number.
- Use the theme's error colour token for field borders and error messages.
- Keep the bag controls within API-provided bounds and continue calculating totals in cents.
- Shared validation yields trimmed name/email and a digits-only card number for eventual submission. The current component only uses validity/errors; it does not send, log, or persist the values or imply booking success.

### Verification

- All 48 tests pass: 11 backend/database tests and 37 frontend tests.
- Tests cover whitespace-only names, unrestricted name characters, email normalisation and invalid addresses, card length boundaries, invalid separators/characters, formatting, error visibility/correction, and enabling/disabling Book.
- All workspace type checks, frontend linting, and the web build pass.
- Browser verification with synthetic inputs confirms an inline invalid-email error, clearing the error after correction, card display as `4111 1111 1111 1111`, and Book becoming enabled.

## 2026-10-09 — Frontend helper structure

- Move the pure card-number formatter into `src/lib/card-number.ts` to separate reusable non-UI helpers from components.
- Keep formatter tests alongside the helper in `src/lib/card-number.test.ts`.
- Keep UI in `src/components`, visual tokens in `src/theme.ts`, and the current small API client in `src/store-api.ts`. Add further folders when their responsibilities require them rather than scaffolding empty layers.

## 2026-10-09 — Stub checkout connection

### Authorised scope

- Commit completed frontend validation/helper changes before starting this milestone.
- Connect Book to our backend, show a spinner while pending, and show payment success after a two-second happy-path stub response.
- Do not connect the third-party payments API or create real payments/bookings yet.

### Implementation choices

- Add `POST /checkout` with shared Zod request/response contracts. Send store ID, quantity, trimmed name/email, and a normalised digits-only card number; do not accept a frontend-calculated charge amount.
- Reuse backend input validation and current database quantity bounds before waiting two seconds and returning simulated success. Do not log or persist submitted card details.
- Allow POST in development CORS, including JSON preflight requests. Return a predictable 400 for malformed JSON rather than classifying it as an internal failure.
- Put both frontend clients in `src/api` now that there is a second endpoint, sharing only the API URL configuration rather than introducing a generic request framework.
- Disable form fields, quantity controls, and Book while pending. Use an immediate request guard to prevent another submission before React updates the button state.
- Validate success responses, clear the card number from state on success, and render the requested payment-success screen. This screen represents simulated success only.
- Abort the frontend request on unmount and ignore obsolete results. Cancellation does not imply cancellation of a future provider payment.
- Preserve values after a request failure and allow a manual retry for this side-effect-free stub. Real payment integration must follow the previously agreed distinction between explicit declines and unknown outcomes.

### Verification

- All 64 tests pass: 20 backend/database tests and 44 frontend tests.
- Tests cover the two-second delay, request validation and quantity bounds, malformed JSON, POST preflight, normalised submission, malformed success responses, pending/success/error UI, repeat-submit prevention, and unmount cancellation.
- All workspace type checks, frontend linting, and contracts/API/web builds pass.
- Browser verification with synthetic details confirms the pending spinner and disabled controls, followed by the payment-success screen after the backend response.

## 2026-10-09 — Item selection and price confirmation

### Confirmed

- Replace the checkout request's top-level quantity with `items: [{ itemId, quantity }]`, retaining store ID and customer/card details.
- Require exactly one bag item for the current scope. Reject empty arrays, duplicate entries, unknown items, and invalid quantities; the array does not introduce additional purchasable item types.
- Send `expectedTotalCents` and `currency` to record the terms displayed to the user. The backend calculates its own total from current database prices and compares these values before payment processing.
- Return HTTP 409 `PRICE_CHANGED` before starting the stub when price or currency differs. Include validated current store data so the frontend can refresh the displayed pricing.
- Preserve form values, show the updated total, and require another deliberate Book action after a conflict, including a price decrease. Do not automatically resubmit.

### Implementation choices and boundaries

- Validate price-conflict responses and their store identifier before replacing frontend store data. No quote-expiry system or additional dependency is needed for this exercise.
- The stub still creates no booking/payment records. Accepted-price snapshots and idempotency are future work when checkout persistence is introduced; this change does not provide a durable price guarantee during the stub delay.
- When persistence is added, store accepted prices, quantities, currency, and total and reuse that snapshot for the same payment attempt rather than repricing a repeated request.

### Verification

- All 76 tests pass: 28 backend/database tests and 48 frontend tests.
- Tests cover item-array validation, quantity bounds, expected totals above/below current pricing, currency mismatch, rejection before the stub delay, changed database prices, and explicit resubmission with a revised total.
- Frontend tests cover both price increases and decreases, preservation of form values, no automatic retry, and validation of conflict responses.
- Workspace type checks, frontend linting, and contracts/API/web builds pass.

## 2026-10-09 — Mock-provider payments and durable idempotency

### Confirmed

- Commit the completed stub/price-confirmation milestone before this integration.
- Connect Book through our API to the documented mock payments provider, displaying booking success or the requested failure message and Retry button.
- The user explicitly approved adding booking and payment-attempt persistence and idempotency in this milestone.

### Implementation choices

- Add a migration for bookings and payment attempts. Persist accepted price snapshots and customer details before contacting the provider; never persist full card numbers or card-number hashes.
- Introduce a small checkout service for orchestration, keeping SQL in repositories and HTTP handling in routes. This is the point at which a service layer becomes useful.
- Use frontend-generated UUIDs for checkout/attempt identity. Short immediate SQLite transactions claim attempts atomically, and a partial unique index prevents concurrent unresolved attempts for one booking. No network call runs inside a database transaction.
- Repeated attempt IDs return stored results or processing/unknown state. Bind IDs to normalised non-card checkout details and reject conflicting reuse. A successful or unresolved checkout cannot start another payment attempt.
- Retry after a decline uses a fresh attempt ID. Changes to checkout/customer/pricing details after decline use a new checkout ID, preserving immutable snapshots. New attempts still validate current catalogue pricing; repeated existing attempts use their accepted snapshot.
- Validate the provider's completed transaction, amount, currency, last four digits, and other required response fields. Store transaction ID, fee, and other validated transaction metadata without passing provider error internals to the UI.
- Use a 15-second provider deadline without automatic retries. Treat documented declines/validation rejections as failed attempts; treat transport errors, malformed responses, unexpected statuses, mismatched transaction details, and failure to save provider success as unknown.
- Add a read-only checkout status endpoint returning only IDs and payment status, with no customer data and no cacheable responses. Stale processing attempts become unknown after 20 seconds when checked, rather than being replayed after a crash.
- Keep only recovery IDs in browser tab session storage. Recover pending/completed state after reload; retain confirmed IDs so reloading does not accidentally start another checkout. Native restart recovery is deferred until native delivery.
- A lost backend response triggers status recovery. Unknown results block payment retries and offer a status-check action. If no status record is found, resubmission retains the same identity so a late original request cannot race another charge.
- Use Expo Crypto for UUID generation on web and future native targets. No new form/payment UI library is needed.

### Limitations

- The provider has no documented idempotency or transaction lookup/refund API. Local uniqueness cannot guarantee exactly-once charging after an uncertain provider response; unresolved attempts remain blocked without an external reconciliation mechanism.
- The current single-store/session flow has no “book another” or reconciliation/admin screen. These are outside this milestone.
- Storage-disabled browsers and native apps fall back to in-memory IDs; durable restart recovery is guaranteed only when browser session storage is available.

### Verification

- All 102 tests pass: 45 backend/database/provider tests and 57 frontend tests.
- Tests cover provider success/decline/validation rejection, mismatched or malformed responses, transport failure, accepted-price persistence, replay after restart and catalogue changes, conflicting IDs, concurrent requests, explicit-decline retries, unknown outcomes, stale attempts, and failure to save provider success.
- Frontend tests cover the requested failure/Retry UI, fresh attempt IDs after decline, lost-response recovery without another payment, blocked retries while unknown, status-only checks, saved-ID recovery, and storage limitations.
- All workspace type checks, frontend linting, contracts/API/web builds, and local Expo dependency compatibility checks pass.
- Live browser verification with synthetic data reached the supplied mock provider and persisted a confirmed booking for 590 cents plus validated transaction metadata. Reloading recovered the confirmation without another charge request. Random provider declines are covered deterministically in automated tests.

## 2026-10-09 — Demo reset and mockup alignment

### Confirmed

- Clear browser recovery IDs and the in-memory identity after confirmed success, while keeping the success screen visible. The next reload starts an empty booking session and Book creates new identifiers.
- Preserve recovery IDs for processing/unknown outcomes and retain the existing protection against duplicate charges. Database bookings and transaction records are not deleted.
- Previously saved successful attempts are recovered once, clear their browser IDs, and allow a fresh checkout on the following reload.
- This supersedes the earlier decision to retain confirmed recovery IDs indefinitely, prioritising repeatable demo testing after an acknowledged success.

### Mockup alignment

- Re-read the Figma mockup: booking submission covers the entire checkout with a dark overlay and centred “Placing Booking” text/loading feedback. The success frame says “Booking Placed!” in the centre.
- Move checkout padding inside the component so the overlay covers the whole card, including its outer padding. Disable underlying controls and hide them from accessibility navigation while the overlay is present.
- Keep “Checking payment status” wording for status recovery so a read-only check is not described as another booking submission.

### Verification

- All 104 tests pass: 45 backend tests and 59 frontend tests.
- Tests verify clearing confirmed recovery IDs, a fresh form/new checkout identity after remount, preservation of unresolved recovery IDs, and inaccessible/disabled underlying controls during the loading overlay.
- Workspace type checks, frontend linting, and the web build pass.
- Live browser verification shows the whole-card loading overlay and centred success message, then an empty form with one bag after reload following confirmed success. Database records remain intact.

## 2026-10-09 — Escape from unresolved demo checkouts

### Confirmed

- The user explicitly approved replacing the dead-end status button with a demo-only “Start over” action, acknowledging that a new booking could create another mock transaction.
- Keep form fields and bag controls editable after an unknown result. Continue disabling them during active network requests.
- Start over clears browser recovery IDs and the in-memory identity, preserves entered values, and returns to a new booking session without making a payment request.
- Retain the old unresolved database attempt, its status, and its replay protection. Do not reclassify an uncertain outcome as a decline without evidence.
- This supersedes the previous permanent frontend lock/status-check button for unknown outcomes. Automatic recovery after a lost response or reload remains available before the user chooses a reset.

### Investigation and parser improvements

- The observed unknown attempt completed in approximately 600 ms, making a provider timeout unlikely. The original response was not recorded, so the exact cause could not be established.
- Added strict support for wrapped HTTP 400 decline envelopes alongside the documented top-level format. This is defensive compatibility, not proof that the original failure was a wrapped decline.
- Save safe reason codes for future unknown results, including invalid provider responses, network errors, timeouts, stale attempts, and persistence failures. No raw card data or provider payload is added to diagnostics.
- A single controlled mock-provider request returned success; failure/unknown paths are verified using deterministic tests.

### Tradeoff and verification

- Reset is appropriate for this mock-only demo. A production checkout would require reconciliation or provider idempotency/lookup before encouraging another purchase after an uncertain charge.
- All 106 tests pass, along with workspace type checks, frontend linting, and all builds.
- Tests verify that unknown forms remain editable, reset makes no provider request, and the next Book uses a fresh checkout identity. Existing unresolved records remain protected on the backend.
- Browser verification confirmed the new Start over button, editable fields, and returning the user's stuck page to a fresh booking form without another payment request.
