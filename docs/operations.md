# Checkout observability and recovery

The API writes structured JSON logs to stdout through Fastify's logger. HTTP requests carry a server-generated `reqId`; checkout events also carry validated `checkoutId` and `attemptId`. This is enough to trace an attempt through claim, provider response and persistence locally. There is no deployed log collector, metrics endpoint, tracing SDK, dashboard, alert service or reconciliation worker.

## Events emitted now

| Event | Level | Meaning and useful fields |
| --- | --- | --- |
| `checkout.attempt_claimed` | info | A processing attempt was committed before calling the provider |
| `checkout.attempt_replayed` | info | An existing attempt/outcome was returned; `status` describes it and no new provider call occurred |
| `payment.result` | info for success/decline; warn for unknown/validation rejection | Provider function finished; `status`, fixed `diagnosticCode` when applicable, and `durationMs` excluding database work |
| `checkout.result_persisted` | info | The outcome was committed; `status` is the saved result, including an unknown fallback |
| `checkout.attempt_stale` | warn | A lookup aged a processing attempt to unknown; `diagnosticCode: STALE_ATTEMPT` |
| `checkout.persistence_failed` | error | Initial result/confirmation write failed; `providerOutcome` records what had returned, with `PAYMENT_PERSISTENCE_FAILED` |
| `request.failed` | error | An unhandled request failure reached the generic HTTP 500 handler; fixed `INTERNAL_ERROR` and request correlation |

Routine status reads add no payment-result events. Already-unknown records do not repeatedly generate stale events. Staleness is detected on a status/replay request, not by a scheduled worker. Logs are not a transactional audit ledger: crashes can lose events, and concurrent observers can report the same transition. Use the database as the authority for saved state.

For example, a provider success followed by failed confirmation produces this sequence for the same checkout/attempt IDs:

```text
checkout.attempt_claimed
payment.result                status=succeeded
checkout.persistence_failed   providerOutcome=succeeded
checkout.result_persisted     status=unknown
```

If the unknown fallback also fails, there is no `checkout.result_persisted`; instead `request.failed` accompanies HTTP 500. The original processing attempt remains until a lookup marks it stale. This difference matters: a 202 response can represent a serious payment incident even when the HTTP server is functioning correctly.

## Privacy and diagnostic boundaries

Checkout events select their fields explicitly. They contain no name, email, card number, checkout signature/fingerprint, transaction payload, provider response body or raw exception message. Arbitrary provider decline codes become the fixed log category `PAYMENT_DECLINED`; validation rejections use `PAYMENT_VALIDATION_FAILED`. Unknown outcomes log only recognised local categories, otherwise `PAYMENT_OUTCOME_UNKNOWN`.

The production entry point also configures defensive redaction for authorization/cookie headers, request bodies and sensitive top-level fields. This is an extra guard, not a guarantee for arbitrary nested objects: avoid logging request/provider objects in the first place. Raw handled provider and database exceptions are deliberately not emitted, because their messages can contain input data. Server startup/shutdown errors remain separate from checkout event logging.

Provider decline codes and validated transaction metadata can exist in the database, along with customer information. Database access and logs need separate access/retention policies. Checkout IDs permit the current unauthenticated status lookup, so restrict log access and avoid exposing them through third-party analytics. Never use UUIDs, transaction IDs or customer details as metric labels; they create sensitive, unbounded cardinality.

Logs do not preserve the full provider success response if its database write fails. They establish that success was observed and correlate the attempt, but cannot recover the missing provider metadata or prove a charge exactly once. A production provider-supported reconciliation path is still required.

## Proposed monitoring

These monitors are documented recommendations; no infrastructure is provisioned. Derive low-cardinality operational counters from events, and use the database for unresolved backlog/age. Start with a dashboard and measure traffic before assigning rate/latency alert thresholds.

| Signal | What to measure | Suggested response |
| --- | --- | --- |
| Persistence failure | Every `checkout.persistence_failed`, especially `providerOutcome=succeeded`; absence of a saved fallback | Urgent investigation of payment evidence and database health; do not retry the payment |
| Unresolved backlog | Count/oldest age of unknown attempts and processing attempts past the 20-second window, using database state | Triage individual cases; a future worker is needed to find records that nobody polls |
| Provider uncertainty | Count/rate by fixed unknown category, deduplicated by attempt for analysis | Investigate timeouts, network problems or unexpected provider responses; avoid automatic POST retries |
| Provider latency | Distribution of `payment.result.durationMs`, with timeout counts and the 15-second deadline | Compare against measured baseline; investigate sustained degradation before the deadline |
| Provider validation drift | `PAYMENT_VALIDATION_FAILED` rate | Compare outgoing fields/contracts with provider validation; do not treat this as ordinary issuer decline |
| Booking persistence/conversion | Claims, observed provider results and persisted outcomes | Identify lost confirmations; business conversion is distinct from technical payment reliability |
| API availability and latency | HTTP failures/latency and a synthetic store-loading check | Investigate service/network/database problems; HTTP 5xx alone misses unknown payments returned as 202 |
| Client recovery failures | Future privacy-safe telemetry for lookup failure, recovery deadline and storage failure | Distinguish browser lifecycle/network issues from backend/provider failures |

The supplied mock documents approximately 20% random payment declines. A monitor that expects nearly every payment to succeed would create false alarms. Track legitimate declines separately from unknown outcomes and integration validation failures. A useful technical reliability measure is the proportion reaching a verified success or explicit rejection, rather than the percentage charged successfully.

`GET /health` currently proves API liveness only. Startup opens/migrates SQLite, but the health endpoint does not query it or test the provider. Production would have a separate readiness check for local dependencies, with provider health monitored separately; do not make every health probe initiate a payment.

Use the deterministic local simulator for CI/demo synthetic checkout checks, not real cards or uncontrolled live-provider payment probes. Deployment, alert routing/ownership, baseline-derived thresholds, tracing, access controls and log retention remain production work. In an Elixir implementation, equivalent structured domain events and telemetry would preserve the same operational distinctions.

## Uncertain payment triage

1. Keep the checkout and attempt IDs. Find their correlated claim, provider-result, persistence and replay events. A result belonging to a different attempt is not evidence for this one.
2. Read the stored attempt and booking state through an authorised operational tool. In the current implementation, the status endpoint returns the latest attempt only and may age stale processing records to unknown.
3. If still processing, wait/check status within the client recovery budget. If unknown, preserve it; no log message or elapsed deadline proves the customer was not charged.
4. For persistence failures, inspect database availability and the saved fallback. A logged provider success with a pending booking is a reconciliation incident, not permission to charge again.
5. Resolve with supported provider lookup/webhook evidence or an authorised manual process before initiating a replacement purchase. The supplied API documents no lookup, refund or idempotency operation, so this demo cannot complete that reconciliation automatically.

The UI's Start over is explicitly a mock demonstration escape. It creates a separate booking and can create a duplicate transaction. Restarting the API, deleting local recovery IDs, or changing IDs does not cancel the old provider payment.

## Verification

[Observability integration tests](../apps/api/src/checkout-observability.test.ts) capture actual Fastify JSON logs while exercising SQLite and HTTP routes. They verify correlation, bounded diagnostic categories, secret-header redaction, absence of personal/card/transaction data, both persistence-failure paths, and non-repeating stale detection. [Provider tests](../apps/api/src/payments.test.ts) cover the response matrix and abort deadlines, including a stalled response body. The empty 422 integration case uses the real adapter with a simulated fetch response and verifies a fresh attempt can succeed.
