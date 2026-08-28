# Implementation report — Eval Pipeline (SPEC-04) / T3

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 3 files changed, 1 added, nothing committed.

## Coverage

- INSIGHTS client: supplied verbatim in the brief and in the plan's `## Constraints` ("Client behaviour this feature depends on", 13 entries), 5 relevant — 2026-08-03 (a value import of the vendored contract barrel resolves under `tsc` and `vitest` and then 500s every route reaching it; runtime constants go in `src/lib/`); 2026-08-10 (a feature's copy in another feature's namespace fails silently in both directions — `src/i18n/request.ts` `readdirSync`s `messages/en/`, so a namespace is one file); 2026-08-11 (a unit composing a shared unit legitimately reads two namespaces and a test mounting one does not fail); 2026-08-19 (`eslint` on a `src/vendor/` path exits 0 having linted nothing); 2026-08-19 (`getByRole(…, { name })` cannot match consecutive spaces). Files not opened, per the brief.
- INSIGHTS server, reviewer-core, e2e, mcp-server, evals: supplied as `0 relevant` to these paths. Not opened.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded; `references/placement.md` read as a file | `client/src/lib/eval.ts`, `client/src/lib/types.ts` |
| `typescript-expert` | preloaded | `client/src/lib/eval.ts`, `client/src/lib/types.ts` |
| `react-best-practices` | preloaded | `client/messages/en/*.json` (a11y rows: a word beside every state, accessible names for icon-only and `aria-disabled` controls) |

Matches the plan's routing table for T3 (`frontend-ui-architecture`, `typescript-expert`), plus `react-best-practices`, whose row matches `client/src/**` and which shaped the badge map's non-colour channel and the disabled-state name keys. `zod` matched no line: this task writes no schema and takes no value from the contract — that absence is the point of `src/lib/eval.ts`. `next-best-practices`, `react-testing-library`, `security`, `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` matched no changed file.

Applied from `references/placement.md`: law 5 (a named module, `eval.ts`, never a `utils` bucket); "no user-visible string is a constant" — every label in `eval.ts` is a **key**, never text; "runtime values are not types — they belong in a named module even when a schema in the shared contract could technically produce them".

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/lib/eval.ts` | T3 | yes | new. `EVAL_PERIODS` + `DEFAULT_EVAL_PERIOD`, `EvalMetricKey`/`EVAL_METRIC_KEYS`/`EVAL_METRIC_LABEL_KEY`, `EVAL_EXPECTATION_BADGE`, and the formatters `formatMetricPercent`, `formatMetricChange`, `formatCostChange`, `formatCaseCounts`. One import from the contract, `import type` |
| `client/src/lib/types.ts` | T3 | yes | `export type { … }` for all seventeen `contracts/eval-batch.ts` symbols, following the file's own stated pattern |
| `client/messages/en/eval.json` | T3 | yes | +95 keys: `caseEditor.tabs.files`, `evalsTab.mechanicalScoring`, `notRun`/`notRunWithReason` + a top-level `notRunReason.*` per member, `emptyCasesTitle`/`emptyCasesBody` naming the accept-or-dismiss-then-turn-into-a-case step, `expectation.*` badges, `compare.*`, `notMeasured`, `compare.promptUnchanged`, `compare.openDisabled` (the two-run precondition), `period.*`, `alert.regression`, plus the dashboard/agent-page columns and states the later tasks read. No existing key or value altered |
| `client/messages/en/prReview.json` | T3 | yes | +16 keys inside the existing `finding` block: `turnIntoEvalCase`, `turnIntoEvalCaseDisabled` (states the decision precondition), the adding/added states, `learnDisabled`/`replyToAuthorDisabled` for T7's present-but-unwired controls, and `evalRefusal.*` — one message per `EvalRefusalReason` member — plus `evalRefusalUnknown` |

Verified mechanically that no shipped copy was reshaped: flattening both catalogues at `HEAD` and in the worktree gives `eval: old=66 new=161 lost_or_changed=0` and `prReview: old=123 new=139 lost_or_changed=0`. The seven `-` lines in the diff are the former last-in-block keys, re-added identically with a trailing comma.

`client/src/vendor/shared/**`, `server/src/vendor/shared/**` and `reviewer-core/**` also show as modified in the worktree — those are T1's landed work and this wave's other implementer's. Nothing under either was touched by this task (`git diff --name-only -- client/src/vendor server/src/vendor` reports only T1's two barrels).

## Acceptance

T3's own acceptance line: `eval.json` and `prReview.json` parse — yes; no other catalogue changed — yes (`git diff --name-only -- messages/` = exactly 2 paths); `src/lib/eval.ts` contains no non-type import of the contract — yes (grep = 0 lines).

| Requirement | Task | Met |
|---|---|---|
| R16 | T3 | yes — `prReview.finding.turnIntoEvalCase`, its disabled accessible name stating the decision precondition, and one refusal message per `EvalRefusalReason` member. The card itself is T7 |
| R17 | T3 | yes — `dashboard.metrics.casesPassed` for the fourth tile, `evalsTab.mechanicalScoring` (file match + line-range overlap, no model call), `evalsTab.dashboardLink`, and `formatMetricChange` as the single unit-carrying delta formatter (AC-56). The tiles are T9 |
| R18 | T3 | yes — `expectation.*` badges, `expectation.assertEmpty`, `evalsTab.notRun`/`notRunWithReason` + `notRunReason.*` distinct from `failed`, `neverRun` (shipped), `counts`, per-row control names, `emptyCasesTitle`/`emptyCasesBody` naming the next action, `progress`. The list is T9 |
| R19 | T3 | yes — `caseEditor.tabs.files` (the missing third input tab), `negativeBanner` naming file and line range, `negativeExpectedOutputLabel`, the two `…DisabledInvalidJson` names, `lastRunSummary`/`lastRunNotRun`. The editor is T9 |
| R20 | T3 | yes — `dashboard.agentColumns.*`, `openAgent`, `rowNoBatch`, `table.agent`/`table.version` for the cross-agent recent-runs table, `agentUnavailable`. The screens are T11 |
| R21 | T3 | yes — `alert.title`/`alert.regression` as a **template** taking `{metric}` and a formatted `{change}`, `EVAL_METRIC_LABEL_KEY` to resolve the contract's snake_case metric into that template, `compare.openDisabled` carrying the two-run precondition, `agentPage.*`. The page is T11 |
| R22 | T3 | yes — `compare.*` four-card copy with `compare.cost`, top-level `notMeasured`, `compare.promptUnchanged` with the shared version, `compare.promoted` templated on the agent's **resulting** version, and `formatCostChange` so the cost card carries currency rather than points. The modal is T11 |
| R23 | T3 | yes — `dashboard.loading`/`error`/`retry`, `evalsTab.loadingCases`/`loadError`/`retry`, `agentPage.loading`/`error`/`retry`, so each region owns its own skeleton and inline error copy. The regions are T9/T11 |

## Deviations from the plan

- **`src/lib/eval.ts` exports five values beyond the four the plan enumerated** — `DEFAULT_EVAL_PERIOD`, `EVAL_METRIC_LABEL_KEY`, `formatMetricPercent`, `formatCostChange`, `formatCaseCounts`. All additive, all in the one file, and each closes a second-convention hole the plan itself names: recommendation 4 (four units in two tasks each render a delta), AC-56's cost card (currency, not points), and Q3's three denominators, where `formatCaseCounts` fixes `cases_passed / cases_covered` in one place. Nothing outside this file changes.
- **`types.ts` re-exports all seventeen contract symbols, not a hand-picked subset.** T5, T9 and T11 all list `client/src/lib/**` as forbidden, so a symbol omitted here is a blocked task two waves later; an unused type re-export costs nothing and cannot reach runtime.
- **`notMeasured` and `agentUnavailable` sit at the `eval` namespace's top level, not inside `compare`/`dashboard`.** The tiles (T9), the dashboard rows and the compare cards (T11) all render the same two phrases; one vocabulary rather than three copies is the same rule the delta formatter exists for.
- **The header comment in `src/lib/eval.ts` says "the vendored contract barrel" instead of naming the specifier in prose.** T3's own Done-condition greps the whole file for `@devdigest/shared` and filters out lines containing `import type`, so a *prose* mention of the specifier fails a gate about *imports*. Rewording the comment was the smaller change; the alternative was rewording the gate, which is not mine.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | catalogues parse | `node -e "for (const f of ['eval','prReview']) JSON.parse(…)"` | pass — rc=0 |
| client | messages scope | `git diff --name-only -- messages/` | pass — exactly 2 paths (`en/eval.json`, `en/prReview.json`) |
| client | type-only contract import | `grep -n "@devdigest/shared" src/lib/eval.ts \| grep -v "import type"` | pass — 0 lines |
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass |
| client | lint | `CI=true ./node_modules/.bin/eslint src/lib/eval.ts src/lib/types.ts` | pass — rc=0 (only the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` node warning) |
| client | unit (whole suite) | `CI=true ./node_modules/.bin/vitest run` | pass — 50 files, 420 tests, 0 failures |
| client | misplaced-key tell | `grep -arn 'useTranslations("eval")' src/` | pass — one hit, and it is my own doc comment: no screen reads the namespace yet |
| client | vendor lint | — | gate did not run — no `src/vendor/` path was touched, and `eslint` there exits 0 having linted nothing (`client/INSIGHTS.md`, 2026-08-19) |
| server / reviewer-core / e2e | — | — | gate did not run — no file in those packages was touched by this task |
| client | `next build` | — | gate did not run — **never** run: it corrupts the `.next` a running `next dev` owns |

## Not done

- `absent` — no test file. T3 has no row in the plan's `## Tests`; these keys and constants are exercised by T5, T7, T9 and T11.
- `not checked` — how any of this renders. Nothing consumes the new keys or constants yet, so `DDG-UI-001`'s "look at it in the running app" belongs to T7/T9/T11.
- `not checked` — e2e flows and integration tests. Docker is not authorised and none was requested.

## For the parent

- **A Done-condition worth tightening for later tasks.** T3's `grep -n "@devdigest/shared" <file> | grep -v "import type"` is a gate about imports written as a whole-file text search, so it fires on a comment explaining why the file has no value import — the exact failure mode the plan's own constraint records for `server/INSIGHTS.md` 2026-08-19 ("scope a grep gate to import statements, not whole-file text"). I reworded the comment; T5's identical gate on `src/lib/hooks/eval.ts` will hit the same wall, and `grep -nE "^import .*@devdigest/shared" | grep -v "import type"` would be the honest form. Candidate for `client/INSIGHTS.md`.
- **Two refusal reasons render outside the findings UI.** Per the dispatch's split, all nine `EvalRefusalReason` messages live in `prReview.finding.evalRefusal.*` — including `cross_agent_compare` (T11's compare) and `batch_already_running` (T9's run-all). T9 and T11 should read those two from the `prReview` namespace, not add a second copy in `eval`; a component reading two namespaces is already the house pattern, and their tests must then mount both.
- **`MetricCard` cannot carry AC-56 through its `delta` prop.** `client/src/vendor/ui/charts/MetricCard.tsx` renders `Math.abs(delta).toFixed(2)` with an arrow and no unit — literally the `↓ 0.02` convention EC-30 flags. It is a vendored primitive and `DDG-DNT-002` forbids giving it a prop, so T9 and T11 must render the change themselves from `formatMetricChange` and leave `delta` unset. This is recorded in a comment at the formatter's declaration; it is worth an explicit acceptance line on T9/T11, as the plan's recommendation 4 suggests.
- **`plan-verifier` has not been run.** That is the next step and it is not mine — it comes before `test-writer`, `architecture-reviewer` and `/pr-self-review`.
- No spec edit was made or needed: `specs/eval-pipeline.md` is an input here, and nothing in T3 contradicts a criterion.
