# Checkout design and API

## Flow and boundaries

The frontend loads one store, renders its bag price and bounds, and derives the displayed total from quantity × unit price. Name, email and card inputs use shared validation. Name/email are trimmed; card numbers accept digits and ordinary spaces, normalize to 13–19 digits and format in groups of four on blur. Errors appear after leaving a field and then update while correcting it.

`Checkout.tsx` is the coordinator: it owns store/quantity, accepted terms, attempt selection, submission, result/error handling and reset decisions. The interesting payment policy stays visible in this entry point.

`CheckoutForm.tsx` owns name/email/card state, touched fields, validation, keyboard focus and the rendered form. Its six props are `store`, `quantity`, `onQuantityChange`, `state`, `onBook(details)` and `onStartOver`. Passing normalized details on Book avoids lifting every keystroke into the coordinator. The form remains mounted during pending requests and failures so inputs survive; confirmation unmounts it and releases those values.

`lib/checkout-attempt.ts` selects identities and stores recovery IDs. Adjacent `components/checkout-recovery.ts` handles the polling interval, deadline and cancellation, reports processing and returns a terminal result; the coordinator applies that result or chooses the error state. `api/checkout.ts` verifies responses and distinguishes definite rejections from transport uncertainty. `CheckoutState` is exported by the coordinator and imported only as a type by the form, so sharing the view state introduces no runtime cycle. Adjacent styles keep presentation separate from the flow.

The backend checkout service follows three steps:

1. Inside a short immediate SQLite transaction, replay an existing attempt or validate current store terms, save the immutable booking snapshot and claim an attempt.
2. Call the payment provider outside the database transaction.
3. Atomically save the result and, on success, confirm the booking. If confirmation fails, retain an unknown outcome rather than invite another charge.

Routes handle HTTP shapes/statuses; repositories contain parameterized SQL. The service receives a provider function for isolated tests. Browser tests exercise the normal provider adapter against a local HTTP simulator.

## HTTP interface

All errors use `{ "error": { "code": "...", "message": "..." } }`. Internal errors expose a generic message. Framework client errors such as malformed JSON, excessive request size and unsupported content types retain their 4xx statuses.

### GET /stores/:storeId

```json
{
  "id": "codys-cookie-store",
  "name": "Cody's Cookie Store",
  "currency": "USD",
  "checkoutItems": [
    { "id": "bag", "name": "Bag", "unitPriceCents": 590, "minQuantity": 1, "maxQuantity": 10 }
  ]
}
```

The contract requires exactly one bag item. Invalid identifiers return 400; missing stores return 404. The frontend has loading and Retry states and a ten-second request deadline; unvalidated response data never reaches the form.

### POST /checkout

```json
{
  "checkoutId": "11111111-1111-4111-8111-111111111111",
  "attemptId": "22222222-2222-4222-8222-222222222222",
  "storeId": "codys-cookie-store",
  "items": [{ "itemId": "bag", "quantity": 2 }],
  "expectedTotalCents": 1180,
  "currency": "USD",
  "name": "Reviewer Example",
  "email": "reviewer@example.com",
  "cardNumber": "4111111111111111"
}
```

The server rejects empty/multiple selections, unknown items, non-integer/out-of-range quantities and invalid customer/card data. It calculates the amount from SQLite. `expectedTotalCents` records displayed terms and is never trusted as the charge amount.

Before claiming a new attempt, a total/currency mismatch returns 409 `PRICE_CHANGED` with current store data. A quantity outside changed limits returns 400 `INVALID_CHECKOUT` with current store data. The client verifies that store, clamps the selection into its bounds, shows the new terms and requires another Book action. Ordinary definite validation rejections show their safe message without a status lookup.

```json
{
  "checkoutId": "11111111-1111-4111-8111-111111111111",
  "attemptId": "22222222-2222-4222-8222-222222222222",
  "status": "succeeded"
}
```

Statuses are `succeeded`, `declined`, `processing` and `unknown`. Success/decline return 200; processing/unknown return 202. An existing attempt returns its stored outcome without repricing or calling the provider. IDs reused with changed non-card details return 409 `REQUEST_CONFLICT`; the frontend attempts recovery because a payment may already exist.

### GET /checkout/:checkoutId

Returns the latest attempt's IDs and status, without customer/card details or a provider call. A malformed ID returns 400; a missing record returns 404. Checkout responses use `Cache-Control: no-store`.

## Retry and recovery rules

| Situation | Client behavior | Provider behavior |
| --- | --- | --- |
| Double click or replay | Reuse the attempt IDs; an immediate request guard also prevents duplicate submission | Existing result/processing state is returned |
| Explicit decline, same non-card details | Keep the checkout ID, generate a fresh attempt ID; card may be changed | New payment attempt |
| Non-card details edited after decline | Generate a new checkout and attempt | New accepted booking snapshot |
| Price or quantity terms changed before claim | Update the form, clear unused identity, require Book again | No payment until terms are accepted |
| POST response lost or unverifiable | Look up the existing checkout with GET | No automatic payment retry |
| Provider still processing, including after reload | Retain IDs, lock the form, poll status once per second within a 30-second recovery budget | No second payment POST |
| A status GET fails after processing was observed | Keep the form locked and retry reads within the same recovery budget | No second payment POST; expiry becomes unknown |
| Missing status record while original form remains mounted | Preserve IDs and unchanged details for a deliberate replay; lock edits | A late original request cannot race a separate identity |
| Missing status record after reload | Original details are unavailable; display unknown/reset | No blind replay of empty or changed details |
| Unknown provider outcome | Preserve IDs; offer explicit mock-only Start over | Old unresolved attempt remains protected |
| Confirmed success | Show “Booking Placed!”, clear card and recovery IDs; next reload starts fresh | Confirmed database records remain intact |

Browser tab session storage contains only UUID recovery IDs. Inputs stay in memory. Restricted-storage browsers and native clients fall back to memory; reload/restart recovery then has no durable guarantee. A recovered decline does not restore personal/card details: entering fresh details starts a new checkout because the original signature is unavailable.

An initial lookup failure is passed to the coordinator, which distinguishes a missing record that can be replayed with unchanged details from an unknown outcome. Once a status GET has reported processing, transient failures keep polling within the existing deadline. Unmount cancels requests and waits.

## Provider boundary and persistence

The default adapter calls `https://fullstack-challenge-api.usebounce.io/v1/payments` with `name`, `email`, integer-cent `amount`, `currency` and `card_number`. A success must contain a completed transaction with matching amount, currency and last four digits. Processing fees are metadata and do not increase the advertised charge.

The provider deadline is 15 seconds. Explicit validated 400 decline envelopes and documented 422 validation rejections permit retry. Timeouts, transport failures, unexpected statuses, invalid JSON and unverifiable transactions become unknown. There are no automatic provider retries. A processing record older than 20 seconds becomes unknown on the next status/replay check; a later valid provider result may still finalize it.

Bookings store customer details, accepted item prices/quantities, currency, total and confirmation state. Attempts store status, timestamps, safe diagnostic codes and validated transaction metadata. Full card numbers and card hashes are never persisted. A unique attempt ID and a partial unique index prevent concurrent unresolved attempts for one booking.

The mock provider exposes no documented idempotency keys, lookup or refunds. Local replay protection cannot guarantee exactly-once charging across a lost provider response or failed database write. The demo reset allows a separate checkout despite this uncertainty; production would need provider reconciliation or an equivalent recovery mechanism.

SQLite uses `better-sqlite3`, foreign keys and WAL mode. Startup applies filename-ordered SQL migrations transactionally and records them in `schema_migrations`. Seeds run once and do not reset edited prices. Database files are ignored by Git.

## Verification approach

Jest tests use real SQLite and Fastify request injection for database/HTTP policy, isolated fetch responses for provider parsing, and user-visible component assertions for form transitions. Parameterized validation cases cover boundaries. Browser tests use real storage, frontend networking, API routes, provider adapter and SQLite together; only the external provider is simulated.

The browser scenarios cover Enter submission and confirmed persistence, decline then a new attempt, and reload during an in-flight payment with one provider call. They also verify clearing successful recovery IDs and removing the locked form inputs from keyboard focus. The simulator records amount/currency/last-four audit data in memory and stores no full card data. Each scenario has a temporary database and fresh browser context. Runtime entry points and visual styling do not need artificial tests merely to raise a coverage percentage.

## Dependency audit

The 9 October 2026 registry audit reports 60 affected package entries (47 high, 13 moderate, no critical) in the Expo/React Native and Jest dependency trees. Neither added tool, Playwright nor Prettier, is flagged. Suggested forced fixes include downgrading Expo to SDK 44 and replacing the selected React Native/Jest versions, so they were not applied. Address compatible upstream updates when available; the current dependency tree is not advisory-free. These package counts include downstream affected entries and do not represent 60 distinct vulnerabilities.
