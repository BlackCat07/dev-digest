# Findings severity — per-severity counts on the API

The PR list payload carries a per-severity finding breakdown per PR, so the client can show
how bad a PR is without fetching its reviews.

Client half of this feature: [`../../client/specs/findings-severity.md`](../../client/specs/findings-severity.md).

## Behaviour

1. `GET /repos/:repoId/pulls` returns `findings_by_severity` on every `PrMeta` — an object
   with the three uppercase keys `CRITICAL`, `WARNING`, `SUGGESTION`.
2. The counts **sum every persisted review run** of that PR, latest or not. Re-running the
   same agent three times triples them. This is deliberately *not* the
   latest-run-per-agent basis that `score` and `cost_usd` use on the same payload — the
   column has to equal the "Agent runs" tab badge on the PR detail page.
3. Only `reviews.kind = 'review'` rows contribute. Any other kind (a future
   `kind: 'summary'`) is excluded, on both this endpoint and the client's own totals.
4. A never-reviewed PR gets all-zero counts, not `null` and not an absent key. The client
   renders all-zero and absent identically.
5. A stored severity outside the contract enum contributes to **no** bucket, so the three
   numbers can sum to less than the PR's true finding count.
6. `findings_by_severity` is produced by the **list endpoint only**. Every other `PrMeta`
   producer omits it, which is why the field is `nullish` in the contract.
7. The hover panel's data comes from the existing `GET /pulls/:id/reviews` — this feature
   added no endpoint for it.

## Data

| Field | Computed from |
|---|---|
| `findings_by_severity` | `findings` joined to `reviews` on `findings.review_id`, filtered to the PR set and `reviews.kind = 'review'`, `GROUP BY (reviews.pr_id, findings.severity)` |

`findings` carries neither `pr_id` nor `run_id`, so `findings.review_id → reviews.id` is the
only path to a PR and the PR filter sits on the joined table. Counting happens in SQL (at
most three rows per PR) rather than by over-fetching and reducing in JS — possible here
precisely *because* there is no per-agent latest-row collapse to do.

Full rationale, and the four traps around the neighbouring `score` / `cost_usd` columns:
[`../docs/scores-and-costs.md`](../docs/scores-and-costs.md).

## Contract changes

This feature **extended `src/vendor/shared/`**, which is a do-not-touch path
([`../CLAUDE.md`](../CLAUDE.md)). Recorded here so the coordination is on the record:

| File | Change |
|---|---|
| `contracts/findings.ts` | **new** `FindingsBySeverity` Zod object — three `int` keys, uppercase, mirroring `Severity` |
| `contracts/platform.ts` | `PrMeta.findings_by_severity` added as `FindingsBySeverity.nullish()`, importing from `./findings.js` |

Both were **additions, not reshapes** of existing symbols, per the do-not-touch rule. The
same two edits were applied by hand to `client/src/vendor/shared/` — that copy is a manual
mirror with no sync script and no CI check, so the two must be changed together or the
client/server types drift.

## States

| Case | Response |
|---|---|
| PR never reviewed | `{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }` (the shared frozen constant) |
| PR reviewed, no findings | same all-zero object |
| Findings with an off-enum severity | ignored; the three counts under-report the total |
| Empty PR list | no queries run at all — the aggregate block is skipped when there are no PR ids |

## Non-goals

- **No denormalized counter column.** Computed on read, like `score` and `cost_usd`.
- **No per-run breakdown in this payload.** The detail page already has the reviews.
- **No pg enum or `CHECK` on `findings.severity`.** The column stays plain `text`; the
  rollups ignore unknown values rather than rejecting or bucketing them.
- **No filtering by severity server-side.** The filter is client state (see the client
  spec).

## Implementation

| File | Role |
|---|---|
| `src/modules/pulls/status.ts` | `countFindingsBySeverity`, `EMPTY_FINDINGS_BY_SEVERITY`, `rollupSeverities` |
| `src/modules/pulls/routes.ts` | the grouped severity query and the `PrMeta` mapping |
| `src/modules/pulls/latest.ts` | doc-comment stating why FINDINGS does *not* live there |
| `src/vendor/shared/contracts/{findings,platform}.ts` | the contract additions above |
| `test/pulls-status.test.ts`, `test/contracts.test.ts` | hermetic coverage |
| `test/integration.it.test.ts` | DB-backed coverage (needs Docker) |

## History

- **2026-08-03** — Added with the client-side severity feature (`a52dc05`).
