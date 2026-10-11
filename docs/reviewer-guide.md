# Checkout walkthrough and delivery

## Suggested walkthrough

Start with `npm ci` and `npm run demo`, then open `http://localhost:8082`. The demo requires ports 8082/3002 to be free and makes no calls to the supplied provider.

1. Show the store and total. Increase/decrease quantity and explain that the API owns the price and bounds, while the UI derives its display in cents.
2. Enter `Reviewer Example`, `reviewer@example.com` and `4111 1111 1111 0002`. Book, show the explicit decline, change the card to `4111 1111 1111 1111`, and Retry. The booking is retained but the attempt is fresh.
3. Reload the confirmed screen to start a fresh form. Use `4111 1111 1111 0003` and reload during the three-second delay. Status recovery waits for the existing payment and reaches confirmation.
4. Open `Checkout.tsx` for accepted terms, attempt selection and result handling. Explain how `CheckoutForm.tsx` retains fields through pending/failure states and hands normalized details to the coordinator. Then open the backend checkout service for claim → provider → persist, short transactions and replay checks before repricing.
5. Show the browser test assertions for persisted totals, attempt counts and no duplicate provider POST. Show a targeted Jest test for an unknown outcome or failed confirmation write.
6. Explain the provider limitation: a timeout is not a decline, and local IDs cannot supply missing provider idempotency/lookup. The mock-only reset is a conscious demo compromise.
7. Use the [design diagrams and response matrix](design.md) to explain failure states. Open [architecture](architecture.md) for shared web/iOS/Android components and missing ownership/availability workflows. Use [operations](operations.md) to explain why provider success and saved booking success need separate logs, and why a 202 response can require investigation.

Reload also starts fresh after an explicit decline; only unfinished submissions are remembered. Same-page Retry keeps the checkout identity with a fresh payment attempt.

Before sharing a release, run `npm run check`, `npm run build`, `npm run format:check` and `npm run test:e2e`. Verify keyboard focus, Enter submission, error announcements and a narrow viewport manually. Web is the verified delivery target; native builds require separate validation.

## Portable Git bundle

A bundle contains committed Git history. Uncommitted files, ignored databases, dependencies and build exports are not included. Commit the intended changes before creating the bundle, and place the bundle outside the repository.

The following example exports the current branch's history and verifies it:

```sh
git status --short
bundle_branch=$(git branch --show-current)
git bundle create ../bounce-challenge.bundle HEAD "$bundle_branch"
git bundle verify ../bounce-challenge.bundle
```

Check that `git status` is clean for the intended files and that you are on the intended named branch. Include both `HEAD` and that branch: exporting only a named branch can leave a fresh clone unable to select its checkout automatically. Do not assume the exported branch is `main`.

Test the delivered artifact from a fresh directory:

```sh
git clone ../bounce-challenge.bundle ../bounce-bundle-check
cd ../bounce-bundle-check
npm ci
npm run check
npm run build
npm run format:check
npx playwright install chromium
npm run test:e2e
```

Use Node.js 24 in the fresh checkout. Browser binaries are downloaded separately from npm dependencies. A clean install/check/build establishes that the bundle does not depend on ignored local artifacts; browser checks verify the complete flow. Run `npm run demo` in that clone for the same manual walkthrough.

Share the verified `.bundle` when an offline copy of the repository is needed.
