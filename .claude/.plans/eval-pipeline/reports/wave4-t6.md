# Implementation report — Eval Pipeline (SPEC-04) / T6

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 0 files changed, 6 added, nothing committed. `server/pnpm-workspace.yaml` was checked per `DDG-WIRE-005` and is a **tracked, deliberate** pnpm-10 settings file with no `packages:` key (commit `29e2b64`, and its own header says so) — not the scaffold that invariant warns about, so nothing was deleted.

## Coverage

- INSIGHTS server: entries supplied verbatim in the dispatch and in the plan's `## Constraints`; taken as read, not re-opened. Relevant and applied: 2026-08-06 (ordering on a non-unique column returns heap order and an update moves a row — the whole reason `eval-order.it.test.ts` exists), 2026-08-05 (a `Date` in a raw `sql` template throws at runtime and typechecks), 2026-08-03 (`count()` maps to a real `number`; `agent_id` is nullable so grouping needs a fallback key), 2026-08-14 (`import type` does not exempt `no-cross-module-internals`, measured 22 → 24), 2026-08-19 (a whole-file `grep` gate makes implementers reword prose), 2026-08-20 (a feature module may not import any `node:` specifier; the module count is the only evidence `depcruise` analysed new files), 2026-08-02 (never `pnpm <script>`), 2026-08-06 (a mixed `vitest run` silently skips `.it.test.ts`).
- INSIGHTS client, reviewer-core, e2e, mcp-server, evals: 0 relevant to these paths, per the dispatch.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded (+ `rules.md`, `layer-map.md`/`enforcement.md` consulted, `.dependency-cruiser.cjs` read) | all four `server/src/modules/eval/*.ts` |
| `drizzle-orm-patterns` | preloaded (+ `references/queries-joins-aggregations.md`) | `repository.ts` |
| `zod` | preloaded (+ `references/parse-use-safeparse.md`, `references/schema-use-unknown-not-any.md`) | `helpers.ts`, `repository.ts` |
| `typescript-expert` | preloaded | all six files |
| `security` | preloaded | `repository.ts`, `types.ts` (workspace scoping on every read and both deletes) |
| `postgresql-table-design` | preloaded | — `n/a`: `db/schema/**` is T4's and untouched; index names were read, not written |
| `fastify-best-practices`, `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library` | preloaded | — `n/a`: no route, plugin or client file in this task |

Matches the plan's routing table for T6: yes, plus `security`, whose row matched `repository.ts` (every query is scoped by a workspace parameter, including `pruneAgentBatches`, which does not strictly need one).

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/eval/constants.ts` | T6 | yes | new — the eight bounds with the reason beside each |
| `server/src/modules/eval/types.ts` | T6 | yes | new — `DiffParser`, `EvalFindingSource`, `EvalAgentSource`, the narrow persisted views, the write shapes, `EvalStore`, `Evals`. Imports only `@devdigest/shared`; no sibling module, no Row type in any signature |
| `server/src/modules/eval/helpers.ts` | T6 | yes | new — `normaliseAnchor`, `anchorsOverlap`, `readExpectedAnchors`/`withExpectedAnchors`, `diffFragmentFor`, `diffByteLength`, `periodStart`, `readExpectation`, `toEvalAgentCase`/`toEvalBatch`/`toEvalBatchCaseResult`/`toEvalBatchTrendPoint`, `passFromOutcome`. No `db/`, no `drizzle-orm` |
| `server/src/modules/eval/repository.ts` | T6 | yes | new — `EvalRepository implements EvalStore`; the only file here touching `db/schema` + `drizzle-orm`. 18 methods, no `db.transaction`, no raw `sql` template |
| `server/test/eval-helpers.test.ts` | T6 | yes | new — 37 hermetic tests; no `test/helpers/pg.ts` import (`DDG-TEST-001`) |
| `server/test/eval-order.it.test.ts` | T6 | yes | new — the DB-backed order/retention file, **written but not run** per the dispatch |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 — case creation (persistence half) | T6 | yes — `insertCase` stores expectation, anchors (inside `expected_output`), `source_finding_id`, owner kind/id; `diffFragmentFor` cuts the one-file diff in the exact shape `diffFromPrFiles` uses, proven by a round-trip through the real `parseUnifiedDiff` |
| R2 — the six refusals (their reads) | T6 | yes — `countCases` (limit), `findCaseBySourceFinding` (duplicate, `id asc limit 1` so a retry names the same case), `listCaseAnchors` + `anchorsOverlap` (conflict), `diffByteLength` (64 KB in bytes). The refusals themselves are T8's |
| R3 — the set read, total order | T6 | yes — `name asc, id asc`, most-recent-execution attached by `DISTINCT ON (case_id) … ORDER BY case_id, ran_at desc, id desc`. Asserted in `eval-order.it.test.ts` (not run) |
| R4 — save/delete (persistence half) | T6 | yes — `updateCase` persists name, diff, expectation and anchors as submitted and sets `edited` itself; `deleteCase` touches no `eval_batches` column, so recorded metrics and counts are unchanged by construction |
| R11 — metrics recording | T6 | yes — `updateBatch` writes only the fields present in the patch, so a failure path cannot invent a metric it never computed; every metric/count/cost stays nullable end to end |
| R12 — history + retention | T6 | yes — `listAgentBatches` is `started_at desc, id desc`; `pruneAgentBatches` scans in that same total order and returns the count deleted |
| R15 — dashboard reads | T6 | yes — `listWorkspaceBatches` (one read, not one per agent), `countCasesByOwner` (`GROUP BY`, no over-fetch), `toEvalBatchTrendPoint`. The per-agent grouping is deliberately left to T8 because `agent_id` is nullable and needs the `agentId ?? 'row:' + id` fallback key |
| Acceptance line — no `node:` specifier under `modules/eval/` | T6 | yes for imports — the Done-condition grep `^import .* from 'node:` returns 0 lines. Two mentions remain in a `helpers.ts` doc comment explaining why `Buffer` is used instead of a `node:buffer` import; the plan's own constraint forbids rewording prose to satisfy a text search, and AC-98 requires the gate be scoped to import statements. Flagged below |
| Acceptance line — no raw SDK import | T6 | yes — `drizzle-orm` is not on `modules-no-raw-sdk`'s list and `repository.ts` is the persistence file; `depcruise` reports 0 errors |
| Acceptance line — no sibling-module import | T6 | yes — `grep -arnE "from '\.\./[a-z_-]+/" src/modules/eval/` returns 0 lines; warnings stayed at 22 |
| Acceptance line — `expected_output` parsed, never cast | T6 | yes — `StoredExpectedOutput.safeParse`; no `as` anywhere in the module (`no-explicit-any` and the four `no-unsafe-*` rules are clean) |
| Acceptance line — every ordering has a unique tiebreaker | T6 | yes — five orderings, each ending in an id: cases `name,id`; history and workspace list `started_at desc,id desc`; batch results `name,id,ran_at desc,id desc`; latest-execution `case_id,ran_at desc,id desc`; duplicate lookup `id asc` |

## Deviations from the plan

- **The two nulls at the Row → DTO boundary, decided and documented.** `eval_cases.expectation` and `eval_cases.input_diff` are nullable columns feeding non-nullable contract fields. Both are resolved with `safeParse` plus a fallback chosen so an unreadable row makes the agent look **worse**, never better: `expectation` → `must_find` (a `must_find` case with no anchors scores `failed` and turns its findings into false positives, whereas a `must_not_flag` fallback would pass for free at zero cost and silently raise every batch's pass count), and `input_diff` → `''` (parses to zero files ⇒ `not_run` / `diff_unparseable`, no model call). Same principle for `status` → `error` and `outcome` → `not_run` + `not_scorable`. All four are covered by named tests.
- **The persisted row shapes are declared in `types.ts`, not inferred from `db/schema`.** The plan put the Row → DTO mappers in `helpers.ts`; `helpers.ts` is inside `application-no-db-schema`'s glob, so a `typeof t.evalCases.$inferSelect` there would have added a 23rd `depcruise` warning against a baseline that must stay at 22. Importing them from `./repository.js` instead (the `agents/helpers.ts` shape) would have created the same `helpers ↔ repository` cycle already on the `no-circular` burn-down list. So `StoredEvalCase`/`StoredEvalBatch`/`StoredEvalRunResult`/`StoredEvalCaseExecution` are narrow field-by-field views in `types.ts`, satisfied structurally by the real rows — which is also what makes the hermetic test build them as plain objects.
- **`types.ts` also declares `EvalStore` and the write shapes.** T6's prose named four interfaces; the plan's `## Tests` row for T8 requires "a fake repository through the consumer-declared interface in `modules/eval/types.ts`", so the store interface belongs here. `EvalRepository implements EvalStore`, matching `BriefRepository`/`OnboardingRepository`.
- **`EvalAgentSource`'s methods are `list` / `getById` / `getVersion`.** The plan wrote "get"; structural satisfaction is by name and `AgentsRepository` exposes `getById`, so renaming would have forced an adapter that exists only to rename.
- **`periodStart` returns `Date | null`, not `Date`.** `all` has no start, and null lets the caller omit the predicate entirely rather than scan against a sentinel date. The `Date`-in-raw-`sql` trap is avoided structurally: the module writes no raw `sql` template at all and binds every window through `gte()`.
- **Two helpers beyond the three named mappers** — `toEvalBatchTrendPoint` (R15's trend is a pure map from a batch) and `passFromOutcome` (keeps the shipped `eval_runs.pass` column consistent with the `outcome` column added beside it — `null` for `not_run`, because an infrastructure failure is not a wrong answer).
- **A compile-time port assertion lives in `test/eval-helpers.test.ts`.** `type Satisfies<Port, Impl extends Port>` proves `ReviewRepository` satisfies `EvalFindingSource`, `AgentsRepository` satisfies `EvalAgentSource`, and `parseUnifiedDiff` satisfies `DiffParser`. It has to be in `test/` because the module imports no sibling, so `tsc -p tsconfig.json` never sees the two shapes together; `tsconfig.eslint.json` widens the include, which is what makes those three lines checked rather than decorative. **All three compile** — so T8 and T10 will not discover a port that cannot be satisfied.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| server | typecheck (test files) | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | pass — 16 errors, the documented baseline, all in the same six unrelated files; **0** in `test/eval*` |
| server | lint | `./node_modules/.bin/eslint` over all six Owned paths | pass — 0 errors, 1 warning (`Unused eslint-disable directive` on the Docker-skip `console.warn`), identical to all four existing `*.it.test.ts` files; kept for consistency with them |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings. 240 modules, 821 dependencies cruised.` Baseline measured before the first edit: `0 errors, 22 warnings. 236 modules, 808 dependencies`. Module count **risen 236 → 240**; no `modules/eval` line in the output |
| server | unit (targeted) | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' eval-helpers` | pass — 1 file, 37 tests |
| server | unit (full) | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 57 files, 778 tests. Baseline before the first edit: 56 files, 741 tests, all green — so no pre-existing failures and none introduced |
| server | `DDG-WIRE-002` (ESM `.js`) | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | no `node:` import | `grep -arnE "^import .* from 'node:" src/modules/eval/` | pass — 0 lines |
| server | no sibling-module import | `grep -arnE "from '\.\./[a-z_-]+/" src/modules/eval/` | pass — 0 lines |
| server | `DDG-WIRE-001` | the `for m in $(ls -d src/modules/*/ …)` loop from `gate.md`, verbatim | pass — no `UNREGISTERED:` line. `modules/eval/` has no `routes.ts` yet, so it is correctly out of scope; registration is T10's |
| server | SQL dry-run (extra) | `.toSQL()` over the three shapes the it-test would exercise | pass — `OFFSET $n` with no `LIMIT` is valid Postgres; `DISTINCT ON (case_id) … ORDER BY case_id asc, …` puts the distinct expression first as Postgres requires; the period window binds as a parameter, not raw interpolation. Scratch file removed |
| server | integration (`eval-order.it`) | `./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork eval-order.it` | **gate did not run — withheld from this task by the dispatch** (Docker not authorised; the parent runs it serially in Phase 2) |
| client | — | — | gate did not run — no client file was touched (T7 owns the client half of this wave) |
| reviewer-core | — | — | gate did not run — no `reviewer-core` file was touched; `depcruise` cruised `../reviewer-core/src` as part of the server onion gate |

## Not done

- `not checked` — `server/test/eval-order.it.test.ts` has never executed. It is written as if it will: fixed non-random uuids in two disjoint id spaces so insertion order provably disagrees with sorted order, every assertion compares against the **independently sorted** ids (plus an explicit `expect(sortedIds).not.toEqual(insertedIds)` so the assertion cannot pass on a query with no `ORDER BY` at all), and the update-then-re-read step is present in both order blocks. It covers AC-14, AC-37 and AC-38 plus the `eval_runs` cascade a retention delete triggers. Read the `↓` lines when running it, not the pass count.
- `absent` — the service, runner, schemas, routes, module registration and container wiring. T8 and T10, by design; `modules/eval/` is deliberately unregistered this wave.
- `absent` — the client half of wave 4 (T7). Another implementer's.
- `not checked` — the live-API `curl` checks (`localhost:3001/eval/...`). They belong to T10 and there is no route yet.

## For the parent

- **T12's AC-98-style grep must be scoped to import statements, not whole-file text.** `server/src/modules/eval/helpers.ts` contains two `node:` occurrences in a doc comment explaining why `Buffer.byteLength` is used *instead of* a `node:buffer` import. A whole-file grep over `src/modules/` would flag it. The plan's own `## Constraints` records that this exact trap made two implementers reword prose and one write `String.prototype.match` where `.exec()` was natural, and AC-98 already states the constraint — so the fix is the gate's phrasing, not the comment. Every grep in T6's Done-condition is already import-scoped and returns 0 lines.
- **Three ports are now proven satisfiable, before T8 and T10 need them.** `test/eval-helpers.test.ts` carries a compile-time `Satisfies<Port, Impl>` assertion for `EvalFindingSource` ← `ReviewRepository`, `EvalAgentSource` ← `AgentsRepository`, and `DiffParser` ← `parseUnifiedDiff`, and all three compile under `tsconfig.eslint.json`. T10's container binding therefore needs no adapter and no cast. Note the method names in `types.ts` deliberately mirror the real repositories' (`getById`, not `get`).
- **T8 will need two decisions this task deliberately left to the service ring, and both are recorded in `types.ts`/`repository.ts` doc comments:** the per-agent grouping of `listWorkspaceBatches` needs the `agentId ?? 'row:' + row.id` fallback key (a map on the raw nullable value collapses every agent-deleted row into one bucket and a cost sum then drops all but one with no error), and `listRunningBatches` returns a **list** because which of them is stale is a `BATCH_DEADLINE_MS` rule, not a query.
- **`server/pnpm-workspace.yaml` is not the `DDG-WIRE-005` scaffold.** It is tracked (commit `29e2b64`), carries no `packages:` key, and its own header explains it exists so `pnpm <script>` does not die on `ERR_PNPM_IGNORED_BUILDS`. A naive `test -f` check on that invariant produces a false positive — worth knowing before someone deletes it.
- Candidate for `server/INSIGHTS.md`: `.dependency-cruiser.cjs`'s `application-no-db-schema` glob includes `helpers.ts`, so a Row → DTO mapper that infers its input with `typeof t.<table>.$inferSelect` adds a warning, while importing the Row type from the module's own `repository.ts` instead creates the `helpers ↔ repository` cycle already on the `no-circular` burn-down list. Both roads add a warning; the third — declaring narrow field-by-field views in `types.ts` and letting the real rows satisfy them structurally — adds none, and is what `OA-DEEP-002`'s "a Row type in `helpers.ts` doing Row → DTO is that permission working as intended" reads as in *this* config. Evidence: `server/src/modules/eval/types.ts` (`StoredEvalCase`), `server/.dependency-cruiser.cjs:78`, measured `0 errors, 22 warnings, 240 modules`.
- Candidate for `server/INSIGHTS.md`: drizzle 0.38.4's `.offset(n)` with no `.limit()` emits bare `OFFSET $n` (valid Postgres, which is what a "keep the newest N, delete the rest" retention scan needs), and `selectDistinctOn([col])` emits the distinct expression first in `ORDER BY` as Postgres requires — both verified without a database by building the query and reading `.toSQL().sql` over a `postgres()` handle that never connects. That is a cheap way to de-risk a query in a `*.it.test.ts` you are not allowed to run. Evidence: `server/src/modules/eval/repository.ts` (`pruneAgentBatches`, `withExecutions`).
- `plan-verifier` has not been run, and neither have `test-writer`, `architecture-reviewer` or `/pr-self-review`. Those are the next steps and none is mine.
