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
