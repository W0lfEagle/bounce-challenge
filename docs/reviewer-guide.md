# Interview walkthrough and delivery

## Suggested walkthrough

Start with `npm ci` and `npm run demo`, then open `http://localhost:8082`. The demo requires ports 8082/3002 to be free and makes no calls to the supplied provider.

1. Show the store and total. Increase/decrease quantity and explain that the API owns the price and bounds, while the UI derives its display in cents.
2. Enter `Reviewer Example`, `reviewer@example.com` and `4111 1111 1111 0002`. Book, show the explicit decline, change the card to `4111 1111 1111 1111`, and Retry. The booking is retained but the attempt is fresh.
3. Reload the confirmed screen to start a fresh form. Use `4111 1111 1111 0003` and reload during the three-second delay. Status recovery waits for the existing payment and reaches confirmation.
4. Open the checkout service. Explain the claim → provider → persist sequence, the short transactions, and the replay checks before repricing.
5. Show the browser test assertions for persisted totals, attempt counts and no duplicate provider POST. Show a targeted Jest test for an unknown outcome or failed confirmation write.
6. Explain the provider limitation: a timeout is not a decline, and local IDs cannot supply missing provider idempotency/lookup. The mock-only reset is a conscious demo compromise.

Before the interview, run `npm run check`, `npm run build`, `npm run format:check` and `npm run test:e2e`. Verify keyboard focus, Enter submission, error announcements and a narrow viewport manually. The assignment values usable flow, clear choices and defensible tradeoffs; native builds and extra styling are outside this submission's scope.

## Git bundle submission

A bundle contains committed Git history. Uncommitted files, ignored databases, dependencies and build exports are not included. Commit the intended solution before creating the bundle, and place the bundle outside the repository.

The following example exports the current branch's history and verifies it:

```sh
git status --short
git bundle create ../bounce-challenge.bundle HEAD
git bundle verify ../bounce-challenge.bundle
```

Check that `git status` is clean for the intended files. If exporting a named branch instead, use its actual name rather than assuming `main`.

Test the delivered artifact from a fresh directory:

```sh
git clone ../bounce-challenge.bundle ../bounce-submission-check
cd ../bounce-submission-check
npm ci
npm run check
npm run build
npm run format:check
npx playwright install chromium
npm run test:e2e
```

Use Node.js 24 in the fresh checkout. Browser binaries are downloaded separately from npm dependencies. A clean install/check/build establishes that the bundle does not depend on ignored local artifacts; browser checks verify the complete flow. Run `npm run demo` in that clone for the same manual walkthrough.

Submit the verified `.bundle` through the assignment form. Supply the requested 1.5-hour interview availability separately; it is not part of the software deliverable.
