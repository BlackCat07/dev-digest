# Implementation report — Eval Pipeline (SPEC-04) / T2

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 1 file changed, 2 added, nothing committed.

## Coverage

- INSIGHTS reviewer-core: entries supplied verbatim in the brief (the package's single journal entry of 2026-08-07 plus the barrel / no-build-step and `tsconfig.json` include-hole facts), 3 relevant — (2026-08-07 — Anthropic via OpenRouter rejects a `json_schema` carrying numeric range keywords: my return types declare no schema and no bounds, and are never a response format; the barrel is the API surface, so `scoreEvalBatch` went into `src/index.ts`; `tsconfig.json`'s `include` is `src/**/*.ts` only, so I typechecked the test file separately with `tsconfig.eslint.json`). The supplied set named a hazard for every path I touched, so I did not open the file.
- INSIGHTS server: 0 relevant (supplied in the brief). INSIGHTS client / e2e / mcp-server / evals: 0 relevant (supplied in the brief).

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `reviewer-core/src/eval/score.ts`, `reviewer-core/src/index.ts` — core purity (`DDG-ARCH-002`): the one outward edge is the port ring, and nothing is injected |
| `typescript-expert` | preloaded | all three files — discriminated union with an exhaustive `switch` and a `never` default, explicit return types on the public API, no `any`, no `as`, `noUncheckedIndexedAccess`-safe iteration (`for…of`, no array indexing) |
| `zod` | preloaded (`references/type-use-z-infer.md` read as a file) | `score.ts` — the signature consumes the contract's `z.infer`-derived types instead of re-declaring the shapes; the module declares no schema, because a runtime `zod` use would break the one-import rule |
| `react-testing-library`, `react-best-practices`, `frontend-ui-architecture`, `next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` | preloaded | no row matched: no client, route, plugin or schema file is in T2's Owned paths |
| `security` | preloaded | considered and no row genuinely matched: `score.ts` handles no request, no auth, no secret, no upload and no endpoint — it compares already-parsed domain values and parses nothing |

Matches the plan's routing table for T2 (`typescript-expert`, `zod`, `onion-architecture`): yes.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `reviewer-core/src/eval/score.ts` | T2 | yes | new pure module: `scoreEvalBatch` plus `EvalScoredFinding`, `EvalCaseOutput`, `EvalScoreCase`, `EvalCaseScore`, `EvalBatchScore`. One import line, type-only, `@devdigest/shared`. Private `normalise` / `covers` / `ratio` helpers |
| `reviewer-core/src/index.ts` | T2 | yes | barrel: `export { scoreEvalBatch, type … } from './eval/score.js';` (11 lines, inserted before the `output/to-review` block) |
| `reviewer-core/test/eval-score.test.ts` | T2 | yes | new suite, 13 tests, hand-written arrays only — no fixture, database, provider or clock |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R24 — pure function, nothing injected, identical inputs deep-equal | T2 | yes — the signature takes only the case array; `purity` block asserts `toEqual` across two calls and that the caller's array is unmutated |
| R25 — file equality + range overlap, every range normalised, new-side lines | T2 | yes — `covers()`; the inverted-range test uses the live table's real rows; the agreement block pins the new-side reading against `groundFindings` |
| R26 — TP/FN per anchor, FP per finding, both FP classes | T2 | yes — one anchor covered twice yields one TP; a finding on a `must_not_flag` anchor and an off-anchor finding in a `must_find` case each yield one FP |
| R27 — recall, precision, citation accuracy over the batch; zero denominator ⇒ null | T2 | yes — the realistic batch reads `18/22`, `0.9`, `0.95`; the all-`must_not_flag` batch reads three nulls |
| R28 — `must_find` pass rule, `must_not_flag` pass rule, no-output case neither passed nor failed | T2 | yes — the negative case passes while its diff also produced an unrelated CRITICAL; a `not_run` case sits in `cases_covered` and in no tally |

Task-level acceptance from the plan, each checked: the scorer takes no provider, no clock and no config (signature is `(cases: readonly EvalScoreCase[])`); two identical calls are deep-equal; `src/index.ts` exports it; `grep -a "^import" src/eval/score.ts` lists **exactly one** line and it is `import type { … } from '@devdigest/shared'`.

## Deviations from the plan

- **The return type carries more than "per-case outcomes plus an `EvalMetrics`".** Each `EvalCaseScore` also carries `expected_count`, `actual_count` and its own three tallies, and the batch carries `cases_covered` / `cases_passed` / `cases_failed`. All of it is the same arithmetic over the same input, and T8's acceptance ("a four-case batch … reads `cases_passed: 2, cases_covered: 4`") plus `EvalBatchCaseResult`'s expected/actual columns would otherwise be re-derived in `runner.ts` — a second copy of the counting rules is the thing this task exists to prevent.
- **Findings are taken as `Pick<Finding, 'file' | 'start_line' | 'end_line'>`, not `Finding`.** A real `Finding[]` is assignable, so the runner passes its findings straight through, and the signature states that severity, category, confidence and the model's prose influence no number. It also keeps a test case to three fields.
- **The grounding gate's kept/dropped counts sit inside the `output` variant** of the discriminated union rather than as sibling fields on the case. AC-92 aggregates citation accuracy over *executed* cases only; putting the counts where a `no_output` case cannot carry them makes that structural instead of remembered.
- **Multi-anchor `must_find` pass rule read literally.** A case passes when at least one actual finding covers at least one expected anchor, per R28/AC-94 as written. R1 derives exactly one anchor, so the reading only differs for a hand-edited case, and every uncovered anchor there still records a false negative — a partial hit cannot hide in the metrics. Stated in a comment at the branch.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| reviewer-core | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| reviewer-core | typecheck (test files) | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | pass for this task — 4 `pre-existing` errors, all in `test/run.test.ts` (1) and `test/structured.test.ts` (3), red before the first edit and not touched; **0** in `test/eval-score.test.ts` |
| reviewer-core | scorer tests | `./node_modules/.bin/vitest run --passWithNoTests eval-score` | pass — 1 file, 13 tests |
| reviewer-core | full unit suite (regression) | `./node_modules/.bin/vitest run` | pass — 6 files, 58 tests (baseline before my edit: 5 files, 45 tests) |
| reviewer-core | lint | `./node_modules/.bin/eslint src/eval/score.ts src/index.ts` | pass |
| server | onion (`DDG-ARCH-002`) | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `0 errors, 22 warnings. 236 modules, 806 dependencies cruised.` Module count **risen** from the wave-1 baseline of 235, so the new file was analysed |
| reviewer-core | `DDG-WIRE-002` ESM extensions | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'"` | pass — 0 lines |
| reviewer-core | AC-98 import purity (pre-check of T12's gate) | `grep -anE "from '" src/eval/score.ts`, then the same lines against `openai\|openrouter\|anthropic\|llm\|provider\|fetch\|http\|node:` | pass — one from-clause, `@devdigest/shared`; 0 forbidden hits |
| server | typecheck (not required by T2, run because a `reviewer-core` edit compiles here through the alias) | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| reviewer-core | integration | — | gate did not run — this package has no `*.it.test.ts` and Docker was not authorised |
| client | — | — | gate did not run — no client file was touched (another implementer owns `client/` this wave) |

**Mutation-verified**, because a green arithmetic suite proves little on its own. Three defects inserted one at a time, each confirmed to turn a test red, then reverted and the suite re-run green:

1. `normalise` returning `{ lo: a, hi: b }` → the inverted-range test **and** the grounding-agreement test fail (2 failed / 11 passed).
2. a `no_output` case contributing `false_negatives: anchors.length` → both no-output tests fail.
3. `ratio` returning `0` instead of `null` on a zero denominator → three tests fail, including the all-`not_run` batch.

## Not done

- `absent` — nothing else in T2. All three Owned paths were written; no forbidden file was opened for writing. `git status --short -- reviewer-core` shows exactly `M reviewer-core/src/index.ts`, `?? reviewer-core/src/eval/`, `?? reviewer-core/test/eval-score.test.ts`. `grounding.ts`, `prompt.ts`, `review/**`, `llm/**`, `output/**`, `package.json` and `package-lock.json` are untouched.
- `not checked` — the e2e flows and any Postgres-backed gate: not requested and Docker was not authorised.
- `not checked` — the `server/` and `client/` unit suites. I ran `server tsc` only, because my barrel edit is compiled through `server`'s alias; the client half of this wave belongs to another implementer.

## For the parent

- **A baseline T12 will need:** `reviewer-core/tsconfig.eslint.json` reports **4** `error TS` across 2 files on a clean tree — `test/run.test.ts(208,35)` `TS7006` and `test/structured.test.ts` lines 51–53 `TS18048`. The plan documents `server`'s baseline of 16 errors across 6 files but not this one, and T12's `core` gate list has no test-file typecheck. If one is added there, it must be filtered the way the `server` gate is (fail only on `^test/eval-score`), or it is red on arrival.
- Candidate for `reviewer-core/INSIGHTS.md`: the package's own gate cannot see a test file at all — `tsconfig.json`'s `include` is `src/**/*.ts` and `vitest` transpiles without typechecking, so `npm test` and `npm run typecheck` can both be green over a test file carrying a real `error TS`. Evidence: `test/structured.test.ts:51-53` has carried three `TS18048`s while both gates passed; the only thing that surfaces them is `tsc --noEmit -p tsconfig.eslint.json`, which no script runs.
- Candidate for `reviewer-core/INSIGHTS.md`: `depcruise`'s **module count** is the only signal that a new `reviewer-core` file was cruised at all — `235 → 236` here. The warning line reads identically whether a file was analysed or silently unresolved, so a report quoting only "0 errors, 22 warnings" is not evidence the new file entered the graph.
- `specs/eval-pipeline.md` is unchanged and was read as an input only, to check AC-82…AC-96 verbatim against R24–R28. AC-94's observable is single-anchor (`expected 1 finding, got 1`), so the spec does not settle the pass rule for a hand-edited multi-anchor `must_find` case; the code takes the literal reading and says so in a comment. Worth one clarifying line in the spec when `doc-writer` next passes over it — not edited by me.
- `plan-verifier` has not been run, and `test-writer` was not dispatched on this run, so `reviewer-core/test/eval-score.test.ts` ships with the code as the plan's `## Tests` table assigns. The work is uncommitted in the worktree.

The load-bearing line, since T12 greps it and its Done-condition asserts it:

```ts
import type { EvalAnchor, EvalCaseOutcome, EvalExpectation, EvalMetrics, EvalNotRunReason, Finding } from '@devdigest/shared';
```
