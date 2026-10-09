# Improvement plan implementation

The review of `0aec1d2` led to these focused changes. See the [README](../README.md) for setup and source links, [design](design.md) for current behavior, and [reviewer guide](reviewer-guide.md) for the interview and bundle checklist.

| Planned improvement | Implemented change | Evidence |
| --- | --- | --- |
| Preserve processing | A distinct processing state keeps the form locked; status GETs poll within a cancellable 30-second budget. Transient read failures after observed processing do not expose reset immediately. | Component transitions and browser reload with one provider call. |
| Refresh changed bag limits | A validated quantity rejection includes the current store. The UI clamps the quantity, preserves input values and requires Book again. | Raised/lowered limits on both sides of the API. |
| Separate rejection from uncertainty | Typed client errors retain HTTP status/code. Pre-claim rejection clears unused IDs; identifier conflicts and lost responses recover existing payments. | Rejection, conflict, missing-record and lost-response tests. |
| Preserve client-error statuses | Safe HTTP 413/415 responses remain client errors. | Fastify request-injection regressions with zero provider calls. |
| Bound store loading | One small JSON helper covers connection/body deadlines and caller cancellation; store loading uses ten seconds. | Hung request/body, cancellation and late-response tests. |
| Make checkout logic readable | Explicit UI states, a pure reuse/create policy, one recovery operation, adjacent styles, consistent formatting and simpler spacing. Backend claim → provider → persist remains visible. | Direct source reading; existing behavior checks retained. |
| Test consequential boundaries | Added separate-connection claims, cross-checkout ID conflicts, late success, decline/repricing, real abort deadlines and three deterministic browser flows. | Real SQLite, HTTP, provider adapter and browser storage; only external payments are simulated. |
| Improve web usability | Name/email autofill, keyboard navigation/submission, and hidden pending inputs removed from the tab order. | Real browser Enter/Tab checks and a narrow-viewport inspection. |
| Improve reviewer documentation | Short quick start and source tour, current decisions, detailed API/recovery rules, repeatable demo and delivery instructions. | Portable repository links; local demo startup/shutdown verification. |

The implementation keeps TypeScript, Expo web, Fastify, SQLite, shared Zod contracts and integer cents. It adds no routing, ORM, form framework or state-machine library.

## Deliberate limits

The provider has no documented idempotency/lookup API, so a lost provider response or failed confirmation write can remain unknown. The explicit mock-only reset can create a second transaction; production would need reconciliation. Native delivery and durable native restart recovery remain outside scope. Card validation checks basic structure, not checksum or brand.

These are current tradeoffs, rather than unfinished requirements of this challenge. The original review is preserved separately from the submission documentation.
