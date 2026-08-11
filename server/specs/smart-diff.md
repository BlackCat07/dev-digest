# Smart Diff

A reviewer can ask what a pull request's changed files are FOR — business logic,
wiring, or generated noise — and get the answer instantly, for free, before any
review has run.

## Behaviour

`GET /pulls/:id/smart-diff` returns the `SmartDiff` contract for one pull request.

1. **Every changed file is assigned exactly one role** — `core`, `wiring` or
   `boilerplate` — from its PATH alone. No patch content, no repository index, no
   model. A path is present the instant a PR is imported, which is what makes the
   answer available before a review and free to recompute.
2. **A dependency lock file is ALWAYS `boilerplate`.** This is universal over the
   set named by `LOCK_FILE_NAMES`, at any directory depth and in any case.
3. **A path no pattern recognises is `core`.** The two mistakes do not cost the
   same: a false `core` costs the reviewer one extra expanded file, a false
   `boilerplate` hides a change inside a group the client starts collapsed. Every
   pattern is therefore a claim of certainty, and the default is the safe direction.
4. **Groups come back in reading order** — `core`, then `wiring`, then
   `boilerplate` — and a role with no files is omitted rather than returned empty.
5. **Files within a group are totally ordered**: `(additions + deletions)`
   descending, then `path` ascending, then `id` ascending. `getPrFiles` issues no
   `ORDER BY`, so anything less than a total order lets rows move between reads.
6. **Findings overlay the files without reordering them.** `finding_lines` carries
   one entry per finding, at its `start_line`, deduplicated and ascending. The
   grouping is identical before and after a review; only the overlay appears.
7. **The findings are the union of the newest `kind: 'review'` row per agent.** A
   review fans out over agents and writes one row each, so re-running one agent
   replaces its overlay rather than doubling it.
8. **A finding citing a file the PR no longer changes is dropped**, with one
   `debug` line. It is expected drift, not a fault.
9. **`pseudocode_summary` quotes, never generates.** It is the declared names taken
   from the patch's `@@ … @@` header tails — git's enclosing-function context — and
   `null` when there is nothing to quote.
10. **`split_suggestion.too_big` is evaluated on `core` + `wiring` only**, while
    `total_lines` counts every file. A large lock diff is not a review burden.
11. **`proposed_splits` partition the changed files**: every file appears in exactly
    one split, or `proposed_splits` is empty.
12. **No model request is made, on any path.** Not "none is made today" — the
    service is constructed with a single port and has no way to reach one.

### Diagram — where each field comes from

```mermaid
flowchart LR
  subgraph stored["already in Postgres"]
    PF[pr_files<br/>path · additions · deletions · patch]
    RV[reviews + findings<br/>file · start_line · severity]
  end

  PF --> CL[classify.ts<br/>path → role]
  PF --> SM[summary.ts<br/>@@ tails → symbols]
  RV --> FD[findings.ts<br/>latest per agent → lines]

  CL --> GR[groups.ts<br/>ordered groups]
  SM --> GR
  FD --> GR
  CL --> SP[split.ts<br/>too_big + splits]

  GR --> R[["SmartDiff"]]
  SP --> R

  style stored fill:none,stroke-dasharray: 4 4
```

Nothing enters from the right-hand side: no GitHub call, no git call, no LLM, no job.

## Data

| Field | Source |
|---|---|
| `groups[].role` | `classifyPath(pr_files.path)` — `constants.ts` patterns |
| `groups[].files[].path` | `pr_files.path`, **verbatim** (the client joins on it) |
| `groups[].files[].additions` / `.deletions` | `pr_files` columns |
| `groups[].files[].pseudocode_summary` | `pseudocodeSummary(pr_files.patch)` |
| `groups[].files[].finding_lines` | `findings.start_line`, via `findings.review_id → reviews.id` |
| `split_suggestion.total_lines` | Σ `additions + deletions` over every file |
| `split_suggestion.too_big` | the same sum over `core` + `wiring` only |

Contract: `SmartDiff` / `SmartDiffResponse` in `src/vendor/shared/contracts/brief.ts`
and `contracts/review-api.ts`. **Both already existed** — this feature changed no
contract file, and `test/contracts.test.ts` already covered the shape.

The route declares `params` only, no `response:` schema, matching every other route
in this server. `test/smart-diff.it.test.ts` runs `SmartDiff.parse` on the real body
instead; that is what stands in for a serializer this codebase does not use.

### Two things the module deliberately does not own

**No repository.** `pr_files`, `reviews` and `findings` belong to the review
domain's data layer and are reached through `container.reviewRepo`, exactly as
`modules/intent/` does. Two repositories over one table is the failure onion
layering exists to prevent.

**No writer.** The response is derived fresh on every request. There is no cache
row, so no freshness rule, no staleness window, and none of the problems the Intent
Layer had to solve. In particular the route does **not** fetch from GitHub when
`pr_files` is empty: `GET /pulls/:id` is the only writer of that table by design,
and adding a second one is how the Intent Layer came to classify PRs from their
title alone.

## States

| State | Response |
|---|---|
| PR not in this workspace, or absent | **404** `not_found`. The `getPull(workspaceId, prId)` lookup IS the authorization check — `pr_files` and `findings` carry no `workspace_id` — so it is the first await, before either read. |
| `:id` is not a uuid | **422** `validation_error`, from `IdParams` before the handler runs. |
| No `pr_files` rows | **200** with `groups: []` and `total_lines: 0`. The common case: nobody has opened the PR detail route yet. Never a 404 — the PR exists, the material does not. |
| No review yet | **200**, full groups, every `finding_lines: []`. |
| Only `kind: 'summary'` reviews | As above; the kind filter empties the set. |
| A file with `patch === null` | **200**, that file's `pseudocode_summary: null`. Roles and counts are path- and column-derived, so they are unaffected. |
| Findings citing files no longer changed | **200**, dropped, one `log.debug` with the count. |

## Non-goals

- **`repo-intel`'s `file_rank` percentile.** The obvious "importance" signal, and
  unusable as the primary one: it needs an indexed clone, and the demo repo's clone
  job fails, so the input would be empty on the only repository a fresh install has.
  A path-only classifier works immediately after import, which is a stated
  requirement. A later percentile-based *enrichment* is what the "smart-diff"
  mentions in `repo-intel/service.ts` refer to.
- **A `docs` role.** `SmartDiffRole` is frozen at three members, so prose lands in
  `boilerplate`. The label is a reading-order bucket, not a claim of worthlessness.
- **Per-finding detail in the response.** `finding_lines` is a flat line list with
  no severity, by contract. The client joins severity from the findings it already
  has, which is also the only source carrying `dismissed_at`.
- **An index on `pr_files.pr_id`.** The column is unindexed and this route
  seq-scans — but `GET /pulls/:id` already does the identical read, so no new access
  pattern is introduced. Worth fixing; not here.
- **Content-based classification.** Reading diff bodies would make this a different
  feature with a different cost. The patch is used for exactly one thing: quoting
  `@@` header tails.

## Implementation

| File | Carries |
|---|---|
| `src/modules/smart-diff/routes.ts` | the one route; no rate limit, no `response:` schema |
| `src/modules/smart-diff/service.ts` | resolve-and-scope, then the pure builders |
| `src/modules/smart-diff/types.ts` | `SmartDiffStore` / `SmartDiffDeps` ports (one port, which is the no-LLM claim in the type system) |
| `src/modules/smart-diff/constants.ts` | every pattern and threshold, each with its reason |
| `src/modules/smart-diff/classify.ts` | `classifyPath`, `normalizePath` — pure |
| `src/modules/smart-diff/findings.ts` | latest-per-agent union, `path → lines` — pure |
| `src/modules/smart-diff/summary.ts` | `pseudocodeSummary` — pure |
| `src/modules/smart-diff/groups.ts` | group assembly and the total order — pure |
| `src/modules/smart-diff/split.ts` | `buildSplitSuggestion` — pure |
| `src/modules/index.ts` | one import, one registry entry (absent = silent 404) |
| `src/platform/container.ts` | `get smartDiff()` |
| `src/db/seed.ts` | `SEED_PR_PATCHES` and the derived `SEED_PR_TOTALS` |

Client half: `../client/specs/smart-diff.md`.

## History

`2026-08-11` — Added, with the module, the route, and the seed's patches.

Three decisions are worth the record because each was reached by being wrong first.

**The split suggestion originally sorted its buckets by size alone.** On the demo
data that put *"Generated, tests & lock files"* (940 lines) above *"Core:
src/api"* (300) — so a too-big PR was advised to split out its lock file first,
which is the exact inversion the whole feature exists to correct. Buckets now sort
by ROLE first, then size, then name. Caught by
`test/smart-diff-split.test.ts` ("orders splits by role first"); the test comment
that noticed it is preserved there.

**`pseudocodeSummary` first cut each `@@` tail at its first `(`.** That works for
`export function rateLimit(` and fails for Go's method receiver
(`func (s *Server) Handle(` → the keyword `func`). It now takes the first identifier
immediately preceding a `(`, which also fixes a default argument holding a call
(`function foo(bar = baz())` → `foo`, not `baz`).

**The lock-file check is a statement above the pattern table, not its first row —
and this is load-bearing rather than defensive.** `pnpm-lock.yaml` and
`package-lock.json` both match the wiring block's config-by-extension catch-all
(`.yaml`, `.json`) and nothing in the boilerplate blocks above it matches them
first, so the table ALONE really does misclassify them.
`test/smart-diff-classify.test.ts` asserts that directly ("is not redundant with the
table"), because a test that only checked `classifyPath` would pass either way.

Also on the record: **the seed changed shape.** `SEED_PR_FILES` had four rows with
`patch === null` while `pull_requests` hand-wrote `additions: 247, deletions: 38,
filesCount: 9` — figures its own rows summed to `126 / 8`, with nothing to notice.
It now holds nine files with real unified-diff text, `additions`/`deletions` are
COUNTED from each patch, and the PR row's three totals are summed from those, so the
header cannot disagree with the list again (`test/seed-pr-fixture.test.ts` pins it).
Two knock-on corrections were required rather than optional: a real derivation over
patched rows reads a `hunk_headers` source, so the seeded intent's `sources` gained
one, its confidence moved `0.40 → 0.45` (0.50 available × a 0.8 self-report), its
"No hunk headers were available" missing-context line became false and was replaced,
and `e2e/specs/11-pr-intent.flow.json` moved from asserting `40%` to `45%`.

`src/api/users.ts` classifies as **`core`**, which diverges from the design mock's
placement of it under Boilerplate. No path rule yields boilerplate for `src/api/`,
and it is the file carrying the seeded WARNING — putting it in the collapsed group
would fight the criterion it exists to demonstrate.
