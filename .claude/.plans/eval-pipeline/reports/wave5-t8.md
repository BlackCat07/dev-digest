# Implementation report — eval-pipeline / T8

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 0 files changed, 4 added, nothing committed.

## Coverage

- INSIGHTS server: entries supplied verbatim in the brief and in the plan's `## Constraints` (not re-read from the file, per the dispatch), 8 relevant — 2026-08-06 (`StructuredRequest.timeoutMs` silently ignored, retry default of two; `JobRunner`'s fixed 120 s timeout; concurrency tuning does not converge; ordering on a non-unique column); 2026-08-07 (a discarded `done` promise killed the API); 2026-08-03 (grouping rows by agent needs a fallback key; a missing per-case cost must null the total); 2026-08-20 (no `node:` specifier in a feature module; `INJECTION_GUARD` is module-private; `depcruise`'s module count is the only signal new files were analysed); 2026-08-14 (`import type` does not exempt `no-cross-module-internals`); 2026-08-19 (`grep -a` over `src/modules/`); 2026-08-02 / 2026-08-04 (never `pnpm <script>`); plus the documented 16-error `tsconfig.eslint.json` baseline.
- INSIGHTS client, reviewer-core, e2e, mcp-server, evals: 0 relevant (per the brief; no file in those packages was touched).

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `server/src/modules/eval/{service,runner}.ts` — read `layer-map.md`, `rules.md`, `enforcement.md` |
| `security` | preloaded | `server/src/modules/eval/{service,runner}.ts` — read `checklists.md` |
| `typescript-expert` | preloaded | all four files |
| `zod` | preloaded | `service.ts`, `runner.ts` (`parse-use-safeparse` on the stored provider id) |
| `fastify-best-practices` | preloaded | not applied — no route file is in T8's Owned paths (`routes.ts` is T10's) |
| `drizzle-orm-patterns`, `postgresql-table-design` | preloaded | not applied — no `db/**` file is in T8's Owned paths |
| `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library` | preloaded | not applied — no `client/**` file was touched |

Matches the plan's routing table for T8 (`onion-architecture`, `security`, `typescript-expert`, `zod`): yes, exactly.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/eval/service.ts` | T8 | yes | new — `EvalService implements Evals`: case creation with all six refusals, save/delete, batch creation with the version+prompt+model snapshot and the staleness rule, history, comparison, both dashboards, `Run all agents`. Plus `EvalRefusal`, `EvalDeps` and the pure row/alert/delta helpers |
| `server/src/modules/eval/runner.ts` | T8 | yes | new — `EvalRunner implements EvalBatchRunner`: detached execution, bounded concurrency, per-case deadline race, the three `not_run` reasons, per-case `insertRun` + event, one whole-batch `scoreEvalBatch`, the batch patch, the failure path. Plus `EvalProgressBus`, `ReviewEngine`, `EvalRunnerDeps`, `BATCH_DEADLINE_ERROR` |
| `server/test/eval-service.test.ts` | T8 | yes | new — 33 tests, hermetic |
| `server/test/eval-runner.test.ts` | T8 | yes | new — 11 tests, hermetic |

## Acceptance

T8's `Acceptance` line, item by item:

| Requirement | Met |
|---|---|
| a fake provider recording in-flight calls never observes a fourth | yes — `peak` asserted `<= 3` on every release and `toBe(3)` at the end, 9 cases |
| every `reviewPullRequest` call carries `maxRetries: 0` | yes — asserted per call; `grep -an maxRetries runner.ts` is one line and it reads `0` |
| running a batch leaves `reviews`, `findings`, `agent_runs` counts unchanged | yes — `EvalRunnerDeps` holds no port that can reach them; additionally every `EvalStore` method but `insertRun`/`updateBatch` throws by name in the fake, and the fake `LLMProvider`'s four methods throw too |
| a four-case batch with two passes, one failure, one `not_run` reads `cases_passed: 2, cases_covered: 4` | yes |
| an all-`not_run` batch records three null metrics | yes — and `cost_usd: null`, not `0` |

Requirements the plan assigns to T8:

| Requirement | Met |
|---|---|
| R2 — six refusals, no row written | yes — each proven by an unreachable `insertCase`, not by a spy count |
| R4 — save as submitted, `anchor_not_in_diff`, delete leaves batch metrics | yes |
| R6 — `running` ack before the first case, snapshot once | yes |
| R7 — no `pull_requests`/`reviews`/`findings`/`agent_runs` row, no clone | yes |
| R9 — 3 concurrent, caller-owned 120 000 ms deadline, retries off | yes |
| R10 — `deadline` / `provider_error` / `diff_unparseable`, batch `error` past its deadline, staleness unblocks | yes |
| R11 — metrics over cases covered, nulls not zeroes, zero model requests before completion, null cost | yes |
| R12 — retention applied | yes, the T8 half: `pruneAgentBatches(…, BATCH_RETENTION)` on every batch open. The two total orders are T6's repository and are covered by `eval-order.it.test.ts`, which did not run (see Gates) |
| R13 — null change, `same_config`, `cross_agent_compare` | yes |
| R15 — dashboards, period filter, per-agent grouping, `Run all agents` skips, deleted agent readable | yes for the service half; the client half is T11's |

## Deviations from the plan

- **Refusals are `AppError` subclasses whose `code` IS the `EvalRefusalReason`, not `ValidationError`.** The plan says "mapped to `ValidationError` (`422`)". `ValidationError`'s code is the fixed literal `validation_error`, and the already-landed client keys off `ApiError.code`: `FindingsPanel.tsx:161-162` reads `error.code` and `messages/en/prReview.json` carries one sentence per refusal member under `evalRefusal.*`. Statuses are as the plan specifies — 422 everywhere, 409 for the duplicate carrying `{ case_id, case_name }`.
- **`batch_already_running` is 422, not 409.** The plan fixes 409 only for the duplicate and gives no status for this one; 422 matches the repo's existing "already running" refusals (`brief/service.ts:301`, `onboarding/service.ts:220`, `conventions/service.ts:185`).
- **`EvalDeps`, `EvalRunnerDeps`, `EvalProgressBus` and `ReviewEngine` are declared in `service.ts` / `runner.ts`.** `types.ts` is T6's and forbidden to me, and it declares no LLM factory, no event bus and no dependency list for this ring. All four are consumer-declared and satisfied structurally: `container.runBus` satisfies `EvalProgressBus`, `(id) => container.llm(id)` satisfies `llm`.
- **`BATCH_DEADLINE_ERROR` lives in `runner.ts`, imported by `service.ts`.** Putting it in `service.ts` made `runner.ts → service.ts → runner.ts` a cycle, which `no-circular` would have added to the 22-warning baseline.
- **The engine is injectable behind a default (`EvalRunnerDeps.review`, defaulting to `reviewPullRequest`).** `maxRetries: 0` and the snapshot pass-through are only observable at the call, and this package has **no** `vi.mock` anywhere (`grep -rln vi.mock test/` returns nothing) — introducing module mocking for one seam would add a second testing dialect. The import and the default are unchanged, so the engine is still reached exactly as `run-executor.ts` reaches it, with no eval-specific parameter.
- **`runAllAgents` returns an already-in-flight batch in `created`** for an enabled, non-empty agent whose previous batch is genuinely still running. `EvalRunAllResult.skipped[].reason` is `z.enum(['agent_disabled','no_cases'])` — a T1 contract I may not widen — so this state cannot be named as a skip. The alternatives were a silent omission (contradicts AC-48's "every agent skipped") or letting the refusal abort the whole request. This writes no second row and leaves the postcondition "exactly one running batch per eligible agent" true. Flagged under `## For the parent`.
- **`saveCase` also enforces `DIFF_MAX_BYTES`.** AC-16 names only `anchor_not_in_diff`; a 64 KB bound that holds only at creation is not a bound, and the case editor is a text area. Same named reason (`diff_too_large`), no new symbol.
- **`anchor_not_in_diff` is reused at creation** when the PR carries no patch for the finding's file (binary or oversized file, or the file is absent). The plan names no reason for that case; this one is already in the contract and in the client catalogue, and it says the true thing.
- **`compare` refuses `cross_agent_compare` when *either* `agent_id` is null**, not only when they differ. AC-41 covers "different agents"; two batches whose agents are both deleted cannot be shown to be the same agent's.
- **`startBatch` closes a stale `running` batch as `status: error` with `BATCH_DEADLINE_ERROR`** rather than merely ignoring it, so AC-30's "a batch past its deadline becomes `error` with a recorded reason" also holds for one whose process died.
- **Each case is scored through `scoreEvalBatch([one])` as it resolves, and the whole batch once at the end.** T6's `EvalRunInsert` doc says a run is "recorded as it resolves rather than at the end", and the row and the event both need that case's outcome. Nothing is recounted: both readings come from the same pure scorer, so they cannot disagree. The batch-level call is still exactly once, after the last case.
- **The four bounds are overridable in `EvalRunnerDeps`,** defaulting to the constants, so a deadline test runs in milliseconds instead of minutes. Production passes none of them.

## Mutation verification

The negatives are proven by fakes, so each fake was checked to actually fail. Every mutation was reverted and the suites re-run green (44 passed).

| Mutation | Result |
|---|---|
| `runner.ts` — one `store.listCases(…)` added inside `runCase` | **fail**, 10 of 11 tests red, `listCases must not be reached in this case` |
| `runner.ts` — provider resolved before the diff is parsed | **fail**, exactly the 2 tests that claim zero provider contact for `diff_unparseable` |
| `runner.ts` — `maxRetries: 0` deleted | **fail**, "carries a zero retry budget and the BATCH snapshot on every call" |
| `service.ts` — one `store.countCases(…)` moved above the `review_has_no_agent` refusal | **fail**, 6 tests red, `countCases must not be reached in this case` |

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| server | unit (T8) | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' eval-service eval-runner` | pass — 2 files, 44 tests |
| server | unit (whole hermetic suite) | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 59 files, 822 tests. Baseline before my first edit: 57 files, 778 tests, all green — no pre-existing failure |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — **0 errors, 22 warnings, 242 modules, 834 dependencies**. Baseline measured before my first edit this run: 0 errors, 22 warnings, **240** modules, 821 dependencies. The count rose by exactly the two new source files |
| server | lint | `./node_modules/.bin/eslint` over all four Owned paths | pass |
| server | `maxRetries` (T8 Done-condition 4) | `grep -an "maxRetries" src/modules/eval/runner.ts` | pass — one line, `415: maxRetries: 0,` |
| server | not a job (T8 Done-condition 5) | `grep -an "container.jobs\|jobs.enqueue" src/modules/eval/*.ts` | pass — 0 lines |
| server | no `node:` (T8 Done-condition 6) | `grep -arnE "^import .* from 'node:" src/modules/eval/` | pass — 0 lines |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | `DDG-WIRE-001` | the `gate.md` loop over `src/modules/*/` against `src/modules/index.ts` | pass — no `UNREGISTERED:` line. `modules/eval/` has no `routes.ts` yet, so it is correctly out of scope until T10 |
| server | test-file typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | pass — **exactly 16 errors across the same six unrelated files** as the documented baseline; my two test files contribute none. This gate caught 4 real errors in them that nothing else did (see `## For the parent`) |
| server | integration | `./node_modules/.bin/vitest run .it.test` | gate did not run — needs Docker, not authorised. `test/eval-order.it.test.ts` (T6's) is therefore unverified this run |
| client | — | — | gate did not run — no client file was touched (the `Evals` tab is the other implementer's, same wave) |
| reviewer-core | — | — | gate did not run — `reviewer-core/**` is forbidden to T8 and untouched |

## Not done

- `absent` — `server/src/modules/eval/routes.ts` and the `container.ts` bindings. T10's, by the plan; the service is registered nowhere yet, so no route answers and no `curl` will. Expected.
- `not checked` — the running stack. No migration was applied and no request was issued: the `## Parent-run checks` are the orchestrator's, after wave 7.
- `not checked` — `test/eval-order.it.test.ts`, the e2e flows, and `scripts/verify-l06.sh` (T12). None was requested and the first two need Docker.

## For the parent

- **T10 needs this wiring shape**, since `container.ts` is not mine: `get eval(): Evals` → `new EvalService({ store: new EvalRepository(this.db), findings: this.reviewRepo, agents: this.agentsRepo, parseDiff: this.diffParser, runner: new EvalRunner({ store: <the same EvalRepository instance>, parseDiff: this.diffParser, llm: (id) => this.llm(id), bus: this.runBus }) })`. Nothing else is required — no bound is passed in production, and `EvalRefusal` already maps through `app.ts`'s `err instanceof AppError` branch to `{ error: { code, message, details } }`.
- **Contract gap worth a decision before `plan-verifier` runs.** `EvalRunAllResult.skipped[].reason` cannot express "this agent already has a batch in flight", which is a reachable state (Evals tab → Run set, then dashboard → Run all agents). My reading returns the in-flight batch in `created`; the alternative is a third enum member in `contracts/eval-batch.ts`, which is a `vendor/shared` change in both copies and therefore not mine to make. AC-48 is the criterion at risk.
- **Candidate for `server/INSIGHTS.md`:** a `server/` test file that imports a **non-existent** member from `@devdigest/shared` is green under `vitest` and invisible to every gate in a task's Done-condition — `tsc -p tsconfig.json` excludes `test/**` and vitest strips type-only imports without resolving them. Measured this run: `import type { EvalBatchPatch } from '@devdigest/shared'` (the symbol lives in `modules/eval/types.ts`) plus two `Partial<EvalStore>`-vs-`EvalStore` mismatches ran 44/44 green and were caught only by `tsc --noEmit -p tsconfig.eslint.json`, which moved the documented baseline 16 → 20 and named both files. The existing entry documents the hole; the new part is that the *symptom* is a passing suite, so the eslint-tsconfig run belongs in every task's Done-condition that adds a test file, not only in ones that add source.
- **`plan-verifier` has not been run**, and neither has `architecture-reviewer` or `/pr-self-review`. That is the next step and it is not mine — it comes before anything else so a requirement I read wrongly is found before T10 wires a route to it.
- Nothing was committed, staged or pushed; no PR was opened.
