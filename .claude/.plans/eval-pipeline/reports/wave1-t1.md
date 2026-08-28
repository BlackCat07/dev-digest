# Implementation report — Eval Pipeline (SPEC-04) / T1

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 2 files changed, 2 added, nothing committed.

## Coverage

- INSIGHTS server / client / reviewer-core: **supplied verbatim in the brief** (the plan's `## Constraints` section); the journals were not opened. 4 relevant to T1 — both `vendor/shared` copies are hand-synced and move together (root `CLAUDE.md`); the client copy is already behind the server's in five files and lacks `AgentVersion`/`AgentVersionConfig` (not touched); Anthropic-via-OpenRouter rejects a `json_schema` carrying numeric range keywords (`reviewer-core/INSIGHTS.md`, 2026-08-07); a runtime-value import from the vendored barrel `500`s every route that reaches it under `next build` (`client/INSIGHTS.md`, 2026-08-03). Plus one that bit a gate: `eslint` on a path under `client/src/vendor/` exits 0 while linting nothing (`client/INSIGHTS.md`, 2026-08-19) — see `## Gates`.
- INSIGHTS e2e / mcp-server / evals: 0 relevant, per the dispatch.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `zod` | preloaded (+ `references/type-export-schemas-and-types.md`, `object-optional-vs-nullable.md`, `object-extend-for-composition.md`, `object-discriminated-unions.md`, `schema-use-unknown-not-any.md`, `schema-avoid-optional-abuse.md`, `schema-use-enums.md`) | both `contracts/eval-batch.ts` |
| `typescript-expert` | preloaded | both `contracts/eval-batch.ts`, both `index.ts` |
| `onion-architecture` | preloaded | both `vendor/shared/**` — this is the ports ring; the file imports `zod` and one sibling contract and nothing concrete |
| `security` | preloaded | both `contracts/eval-batch.ts` — no secret, no attacker-controlled value; `expected_output` stays `z.unknown()`, never `z.any()`, so no consumer can dereference it unnarrowed |

Matches the plan's routing table for T1 (`zod`, `typescript-expert`), plus `onion-architecture` and `security`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/vendor/shared/contracts/eval-batch.ts` | T1 | yes | **new.** 17 exported zod schemas + 17 inferred types; imports only `zod` and `EvalCase` from `./knowledge.js` |
| `client/src/vendor/shared/contracts/eval-batch.ts` | T1 | yes | **new.** `cp` of the server file — byte-identical, verified by `diff` |
| `server/src/vendor/shared/index.ts` | T1 | yes | one `export * from './contracts/eval-batch.js';` after the `eval-ci` line, plus its entry in the barrel's doc comment |
| `client/src/vendor/shared/index.ts` | T1 | yes | the same two edits; the two barrels remain `diff`-identical |

Symbols, in file order: `EvalExpectation`, `EvalAnchor`, `EvalCaseOutcome`, `EvalNotRunReason`, `EvalRefusalReason`, `EvalAgentCase`, `EvalCaseSave`, `EvalBatchStatus`, `EvalBatch`, `EvalBatchCaseResult`, `EvalMetrics`, `EvalComparison`, `EvalPeriod`, `EvalBatchTrendPoint`, `EvalDashboardRow`, `EvalWorkspaceDashboard`, `EvalRunAllResult` — the seventeen T1 enumerates.

Both shape rules hold mechanically: `grep '\.min(\|\.max('` over the new file returns one line, and it is the header sentence explaining why there are none; `grep '\.optional()\|\.nullish()'` returns nothing — every absent metric and count is `.nullable()`.

## Acceptance

T1's own acceptance lines:

| Requirement | Task | Met |
|---|---|---|
| both files exist and are byte-identical | T1 | yes — `diff` rc=0 |
| both barrels export the new file | T1 | yes — line 68 in each, carrying `.js` (`DDG-WIRE-002`) |
| `EvalOwnerKind` still carries `skill` **and** `agent` (N1) | T1 | yes — `z.enum(['skill', 'agent'])` unchanged in both copies |
| no symbol in `contracts/eval-ci.ts` or `contracts/knowledge.ts` differs from `HEAD` | T1 | yes — `git diff --stat` over all four paths is empty |

Requirements T1 satisfies. T1 ships **types only**; each row means "the shape this requirement needs exists and is expressible", not that the behaviour is implemented — that belongs to T2–T12.

| Requirement | Task | Met |
|---|---|---|
| R1 (case derived from a decided finding) | T1 | yes — `EvalExpectation`, `EvalAnchor`, `EvalAgentCase.source_finding_id` |
| R2 (six named refusals) | T1 | yes — `EvalRefusalReason`, all nine members |
| R3 (an agent's set with its most recent execution) | T1 | yes — `EvalAgentCase.last_execution` |
| R6 (acknowledge with a `running` batch + version and snapshots) | T1 | yes — `EvalBatchStatus`, `EvalBatch.agent_version` / `system_prompt_snapshot` / `model_snapshot` |
| R11 (metrics over covered cases; null, not zero) | T1 | yes — `EvalMetrics`, `EvalBatch`'s nullable metrics and counts |
| R13 (compare two batches) | T1 | yes — `EvalComparison`, nullable `change`, `same_config` |
| R15 (workspace dashboard, trend, alert, run-all, period) | T1 | yes — `EvalDashboardRow`, `EvalBatchTrendPoint`, `EvalWorkspaceDashboard`, `EvalRunAllResult`, `EvalPeriod` |
| R19 (case editor's save payload and last-execution strip) | T1 | yes — `EvalCaseSave`, `EvalBatchCaseResult` |
| R24 / R27 (the scorer's signature and its null-denominator metric) | T1 | yes — `EvalMetrics` with three nullable metrics plus the three tallies; no clock, provider or config in any type |

## Deviations from the plan

All six are inside the new file T1 owns; none touches an existing symbol.

- **Declaration order.** `EvalPeriod` is declared before `EvalWorkspaceDashboard`, not last as in T1's enumeration — a const used before its declaration is a TDZ error at runtime. Same seventeen symbols.
- **`EvalDashboardRow.alert` is structured, not a string.** T1 says only "nullable `alert`". The shipped neighbour `EvalDashboard.alert` is `z.string().nullable()`; I made it `{ metric, change } | null`. A server-composed English sentence cannot be translated by next-intl and would put a second delta convention on the screen, which is the exact failure AC-56 and the plan's own recommendation 4 warn about (the formatter in `client/src/lib/eval.ts` is meant to be the single point). The server still decides *which* metric regressed and by how much, so AC-74's "from the payload, not a client-side comparison" holds. **T10 and T11 both depend on this — see `## For the parent`.**
- **`EvalDashboardRow.last_batch` also carries `batch_id`**, beyond T1's summary of "version/started-at/counts/metrics". Without it the per-agent page cannot address the batch it is displaying.
- **`EvalCaseSave.name` carries no `.min(1)`**, unlike the neighbouring `EvalCaseInput.name`. It keeps the file free of every range keyword rather than only the numeric ones, so the header's claim is checkable by grep; the non-empty check belongs on the route's own zod schema (`DDG-SEC-003`), which T10 declares.
- **Every count in `EvalBatchCaseResult` and in `EvalAgentCase.last_execution` is nullable**, including `expected_count`. T4 declares `eval_runs.expected_count`/`actual_count`/`kept_count`/`dropped_count` as nullable integers, and a non-null contract over a nullable column is the boundary cast that already shipped `$NaN` once.
- **The barrel edit is two lines, not one** — the `export *` line plus its entry in the barrel's own doc-comment index, which every other contract file has.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| — | T1 done-condition 1: copies identical | `diff server/…/eval-batch.ts client/…/eval-batch.ts` | pass — 0 lines, rc=0 |
| — | T1 done-condition 2: changed paths | `git diff --name-only -- server/src/vendor/shared client/src/vendor/shared` | pass — 2 tracked paths (both `index.ts`); the two new files are untracked so `git diff` cannot list them, and `git status --short` over the same two trees shows exactly those 2 plus the 2 `?? …/eval-batch.ts`. Four paths in total, and neither `eval-ci.ts` nor `knowledge.ts` among them |
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/vendor/shared/contracts/eval-batch.ts" "src/vendor/shared/index.ts"` | pass — rc=0, no output, files actually linted |
| client | lint | `CI=true ./node_modules/.bin/eslint "src/vendor/shared/contracts/eval-batch.ts" "src/vendor/shared/index.ts"` | **gate did not run** — rc=0 but both files reported *"File ignored because of a matching ignore pattern"*; `client/src/vendor/**` is eslint-ignored (`client/INSIGHTS.md`, 2026-08-19). Not a pass over these files |
| server | onion (`depcruise`) | `CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings. 235 modules, 804 dependencies cruised.` Warnings held at the plan's baseline of 22; module count rose 234 → 235, which is the evidence the new file was analysed rather than silently unresolved |
| server | `DDG-WIRE-002` grep | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| client | `DDG-WIRE-002` grep (`src/vendor/shared`) | same grep, no `db/schema` exclusion | pass — 0 lines |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 56 files, 741 tests, 0 failures |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 50 files, 420 tests, 0 failures |
| reviewer-core | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — run because `reviewer-core/tsconfig.json` aliases `@devdigest/shared` at the server barrel I edited. No `reviewer-core` file was touched |
| server / client | integration, e2e | — | gate did not run — Docker not authorised by the dispatch |
| client | `next build` | — | gate did not run, by prohibition — it corrupts a running `next dev`'s `.next` |

`node_modules` present in `server/`, `client/` and `reviewer-core/`, checked before the runs.

## Not done

- `absent` — no test file. T1 has no row in the plan's `## Tests`; these are type declarations and every later task's tests exercise them. Nothing was written under any `test/` path.
- `absent` — the `reviewer-core` unit suite and `client`/`server` lint over the whole tree. I ran the two full unit suites but scoped lint to the four changed files, as the plan's per-task gates do.
- `not checked` — every T1 requirement's *behaviour*. T1 ships shapes; R1–R27 are discharged by T2–T12.
- `not checked` — the plan's `## Parent-run checks` (migration applied, module registered, a real case from a real decision, the screens). All of them need code that does not exist yet.

## For the parent

- **T10 and T11 must be told about `EvalDashboardRow.alert`.** It is `{ metric: 'recall' | 'precision' | 'citation_accuracy'; change: number } | null`, not the composed string the shipped `EvalDashboard.alert` uses. The server names the metric and the signed change; the client owns the sentence and the unit. If the T11 dispatch quotes AC-74 without this, the client implementer will look for a string.
- **`server/pnpm-workspace.yaml` exists and I did not delete it.** `DDG-WIRE-005` says to delete a scaffold one, but this file is **tracked in git**, unmodified, and its own header explains that it is deliberate: *"pnpm >= 10 settings file. NOT a workspace declaration — there is deliberately no `packages:` key"*, carrying `allowBuilds`/`onlyBuiltDependencies` so `pnpm` does not die on `ERR_PNPM_IGNORED_BUILDS`. Deleting it would remove a committed file outside my Owned paths. `DDG-WIRE-005`'s wording will send a later implementer at it — worth narrowing to "an *untracked* `pnpm-workspace.yaml` your shell just dropped".
- **Candidate for `server/INSIGHTS.md`** (I did not open or write any journal): `git diff --name-only` cannot satisfy a "exactly N paths changed" done-condition for a task that *adds* files — new files are untracked and invisible to `git diff`, and `git add` is forbidden to an implementer. `git status --short -- <paths>` is the formulation that sees both. Evidence: T1's done-condition 2 in `.claude/.plans/eval-pipeline/plan.md`, run against `server/src/vendor/shared/contracts/eval-batch.ts`.
- **Candidate for `client/INSIGHTS.md`**: the 2026-08-19 eslint-ignores-`src/vendor` entry now has a second instance — a done-condition that lints a `vendor/shared` path records rc=0 over an unlinted file. The server's eslint config does *not* ignore `src/vendor/`, so the same command is a real gate on one side of the pair and a no-op on the other. Evidence: this run's two `eslint` invocations.
- `specs/eval-pipeline.md` `## Contracts` enumerates eleven new symbols; T1 ships seventeen, and the six extra (`EvalCaseSave`, `EvalPeriod`, `EvalBatchTrendPoint`, `EvalDashboardRow`, `EvalWorkspaceDashboard`, `EvalRunAllResult`) are the ones the plan's own recommendation 1 argues for. Not edited — the spec is `doc-writer`'s from `Status: implemented` onward.
- `plan-verifier` has not been run, and waves 2–7 are untouched. Wave 2 (T2 in `reviewer-core`, T3 in `client`) is unblocked: all three packages typecheck against what is now in both barrels.
