# Implementation report — Eval Pipeline (SPEC-04) / T9

**Status: partial.**

Every T9 requirement is met and every substantive gate is green (typecheck, the Done-condition test selection, eslint, and the whole 52-file client suite). The single red row below is the `git diff --name-only -- src/vendor/` check, which **cannot** return zero lines in multi-agent mode: T1's uncommitted `client/src/vendor/shared/index.ts` barrel line is in the same worktree. Nothing under `client/src/vendor/` was edited by T9 — evidence in the gate row.

As of `b35fe9b` (`L06-homework`); 3 files changed, 11 added, nothing committed.

## Coverage

- **INSIGHTS client: supplied in the brief** — the plan's `## Constraints` quotes them verbatim (13 client entries) plus the dispatch's two extra ones; **9 relevant**: 2026-08-10 (no `user-event`, no shared QueryClient helper, `Skeleton` is a bare `div.skeleton` with no role), 2026-08-19 (`AgentEditor` takes `tab`/`onTab` as props while `SkillEditor` reads `?tab=`; `getByRole(…,{name})` cannot match consecutive spaces), 2026-08-11 (a component composing a shared unit reads two namespaces and a test mounting one still passes; assert the outgoing body at the `fetch` boundary), 2026-08-03 (type-only imports of `@devdigest/shared`; never `next build`), 2026-08-06 (`var(--bg)` is not a token). I did not open the file. Not relevant here and confirmed n/a: the `vitest.config.ts` alias entry (no alias added), the `<Suspense>` trap (no route file), the jsdom-Enter-on-`<button>` entry (no keyboard-activation requirement in T9), the drag-source entry (T9 adds no drag affordance).
- **INSIGHTS server, reviewer-core, e2e, mcp-server, evals:** the brief states 0 relevant to these paths; T9 touches none of those packages. No file opened.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded (+ `references/decomposition.md` read) | the whole `EvalsTab/` unit, `AgentEditor/constants.ts` |
| `react-best-practices` | preloaded (+ `examples.md` read) | `EvalsTab.tsx`, `CaseEditorModal.tsx` |
| `react-testing-library` | preloaded | `EvalsTab.test.tsx`, `AgentEditor.test.tsx` |
| `typescript-expert` | preloaded | every changed `*.ts` / `*.tsx` |
| `next-best-practices` | preloaded (+ `rsc-boundaries.md` read) | `EvalsTab.tsx`, `CaseEditorModal.tsx` (client boundary at the view; no async client component) |
| `zod` | preloaded (+ `references/parse-use-safeparse.md`, `references/parse-never-trust-json.md` read) | `CaseEditorModal/helpers.ts` — the expected-output read |
| `security` | preloaded (+ `checklists.md` read) | `CaseEditorModal.tsx` — user JSON, `JSON.parse` in a try/catch, no `dangerouslySetInnerHTML`, no `eval` |

Matches the plan's routing table: yes, plus `next-best-practices`, `zod` and `security`, which T9's row did not name but whose routing rows matched the changed files. `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` — no matching file in T9's Owned paths.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` | T9 | yes | one `TABS` entry — `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }`, after `context`; `VALID_TABS` follows for free |
| `.../AgentEditor/AgentEditor.tsx` | T9 | yes | one early return in `TabPanel`, one import, header comment |
| `.../AgentEditor/AgentEditor.test.tsx` | T9 | yes | one test — the strip reads Config, Skills, Context, Evals **by role**; no Stats, no CI |
| `.../AgentEditor/_components/EvalsTab/EvalsTab.tsx` | T9 | yes | new — four tiles, scoring note, dashboard link, case list, empty state, run-all ↔ live progress |
| `.../EvalsTab/constants.ts` | T9 | yes | new — tile labels/colours, row-status map, change-tone colours, refusal key, skeleton keys |
| `.../EvalsTab/helpers.ts` | T9 | yes | new — previous-batch lookup, metric changes, `rowStatus`, per-case result map, progress counting, refusal key |
| `.../EvalsTab/styles.ts` | T9 | yes | new — co-located styles; two `Badge` `style` overrides as named members with comments |
| `.../EvalsTab/index.ts` | T9 | yes | new — unit barrel |
| `.../EvalsTab/EvalsTab.test.tsx` | T9 | yes | new — 8 flow tests |
| `.../EvalsTab/_components/CaseEditorModal/CaseEditorModal.tsx` | T9 | yes | new — the case editor on the existing `Modal` |
| `.../CaseEditorModal/constants.ts` | T9 | yes | new — modal width, the `Input` strip, last-run colours |
| `.../CaseEditorModal/helpers.ts` | T9 | yes | new — JSON gate, duration format, outcome label key, last-run resolution |
| `.../CaseEditorModal/styles.ts` | T9 | yes | new — co-located styles |
| `.../CaseEditorModal/index.ts` | T9 | yes | new — unit barrel |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R17 (tab after Context; 4 tiles; change carries its unit; scoring statement; dashboard link) | T9 | yes — `+4pt` / `-4pt` / `0pt`, and `0.04` asserted absent; `17/20` from `cases_passed`/`cases_covered` |
| R18 (name, expectation badge, icon **and** word, counts, per-row controls; `assert empty`; `never run`; `not run` + reason; empty state; live progress) | T9 | yes |
| R19 (name, `Input` strip of Diff/Files/PR meta, JSON validity badge gating `Save` and `Run case`, negative-case banner + relabelled column, last-execution strip) | T9 | yes, with one qualification — see the first `## Deviations` entry on AC-68's duration and cost |
| R23 (skeletons shaped like what is coming; error next to the region that failed) | T9 | yes — 7 skeletons asserted by class; a 500 on the metrics read leaves the case list rendered |

## Deviations from the plan

- **AC-68's duration and cost are not on the contract's `last_execution`.** `EvalAgentCase.last_execution` carries only the outcome, the not-run reason and the two counts; `duration_ms` and `cost_usd` exist only on `EvalBatchCaseResult`. Rather than block or widen a `vendor/shared` symbol, the modal reads them from `useEvalBatch(row.last_batch.batch_id)` — enabled **only while the editor is open** — and `resolveLastRun` prefers that row, falling back to `last_execution` with `—` for both figures when the case's last execution belongs to an older batch. So AC-68 renders all four for a case covered by the most recent completed batch, which is the case the screen actually shows. No contract change.
- **`EvalsTab.tsx` holds six private components**, not one: `MetricsLabel`, `MetricTile`, `MetricsRegion`, `CaseRow`, `CasesRegion`, `CaseListBody`. Two regions need independent loading/error early returns (R23), which one component cannot express without nested ternaries; `decomposition.md`'s "extract all of the peers, or none" is what fixed the granularity. Same file set the plan named.
- **The case editor's expectation and anchors are read-only** and are submitted unchanged. `EvalCaseSave` carries them, so the save is complete; no criterion asks for editing them, and they are the assertion every stored batch's numbers were computed against.
- **The batch-refusal lookup is a one-entry local map**, not a reuse of `FindingCard/constants.ts`'s nine-entry `EVAL_REFUSAL_MESSAGE_KEY`. That map is another unit's private constant — reaching into it is the cross-folder private import the structure rules forbid, and promoting it would mean editing `client/src/lib/`, which T9 may not touch. Only `batch_already_running` is reachable from this surface. See `## For the parent`.
- **`IconBtn icon="Edit"`, not `"Pencil"`.** `icons.tsx` exports lucide's `Pencil` under the alias `Edit`; `IconName` is keyed on the exported names, so `"Pencil"` is a type error.
- **`evalsTab.newCase` and `caseEditor.newCase` stay unused.** A case is created from a decided finding (R16), so a "New case" control on this tab could not issue a valid request. They join `page.crumbNewCase` / `page.crumbEvalCase` as later-lesson keys.
- **`MetricCard`'s `delta` prop is deliberately unset** on all four tiles and the change is rendered beside the card from `formatMetricChange`. This is the dispatch's instruction rather than a departure from it, recorded here because the omission is invisible in the diff.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | unit (Done-condition selection) | `./node_modules/.bin/vitest run AgentEditor EvalsTab CaseEditorModal` | pass — 4 files, 27 tests, 0 failures (`CaseEditorModal` matches no file: its tests live in `EvalsTab.test.tsx`, as the plan's `## Tests` row specifies) |
| client | unit (whole suite) | `./node_modules/.bin/vitest run` | pass — **52 files, 446 tests, 0 failures**; baseline was 51 / 437, so +1 file and +9 tests, no regression |
| client | lint | `./node_modules/.bin/eslint "src/app/agents/[id]/_components/AgentEditor"` | pass — 0 errors, 1 warning: `react-hooks/set-state-in-effect` at `_components/ConfigTab/ConfigTab.tsx:30`, `pre-existing` and a forbidden path for T9 |
| client | vendor untouched | `git diff --name-only -- src/vendor/` | **fail** as literally written — 1 line, `client/src/vendor/shared/index.ts`. That line is **T1's**: the diff is the `contracts/eval-batch` header block plus `export * from './contracts/eval-batch.js';`, exactly T1's `Change`. T9's own file list contains no path under `src/vendor/`, and `git status --porcelain -- src/vendor/` shows only T1's two paths. Unsatisfiable in multi-agent mode while T1 is uncommitted |
| client | build | `next build` | gate did not run — **never**; it corrupts the `.next` a running `next dev` owns |
| server / reviewer-core | all | — | gate did not run — no file in either package was touched |
| server / reviewer-core | `DDG-WIRE-001`, `DDG-WIRE-002` | — | not applicable — `gate.md` scopes both to `server/` and `reviewer-core/`; T9's diff is client-only and adds no relative import outside it |
| e2e | flows | `../scripts/e2e.sh` | gate did not run — needs Docker, not authorised, and no browser flow was requested |

## Not done

- `not checked` — **`DDG-UI-001`, the look in the running app.** Measured: `localhost:3001/health` answers `200` but `localhost:3000/` answers `000` — the web dev server is not running. Starting one is not mine (and `next build` is never), and the plan reserves this for `## Parent-run checks` step 5. No gate can see a blank first paint, so the `Evals` tab has **not** been seen rendered. A `curl` would prove nothing here anyway: the tab's data is client-fetched after hydration, so grepping the HTML finds the message catalogue inside the flight payload, not the rendered control.
- `not checked` — the tab against a **live** API. Every read is stubbed at `fetch`; the three endpoint paths (`/eval/agents/:id/{dashboard,cases,batches}`, `/eval/batches/:id`) are asserted against the plan's endpoint table, not against T10's routes, which land in wave 6.
- `absent` — no other T9 scope. The three forbidden sibling tabs, `client/src/vendor/**`, `client/messages/**`, `client/src/lib/**` and `client/package.json` are untouched.

## For the parent

- **The T9 Done-condition's fourth line contradicts T1's third.** `git diff --name-only -- src/vendor/` cannot return 0 lines after T1 lands while nothing is committed, because T1's own Done-condition requires *exactly 4 paths* under the two `vendor/shared` trees. A formulation that works in both modes would be `git diff --name-only -- src/vendor/ui/` (T9's real risk is `DDG-DNT-002`, the design system — which is clean) or an intersection against the task's Owned paths. Worth fixing before the next plan reuses the phrasing.
- **Candidate for `client/INSIGHTS.md`:** jsdom implements **no `EventSource`**, so any test that mounts a component reaching `useEvalBatchEvents` / `useRunEvents` with a non-null id dies with a `ReferenceError` inside the effect and takes the whole tree down — `src/test/setup.ts` shims `ResizeObserver` and `scrollIntoView` but not this. The hooks return early on a null id, which is why no existing test has hit it. Evidence: `EvalsTab.test.tsx` stubs a `FakeEventSource` per file; `src/lib/hooks/eval.ts:356` and `src/lib/hooks/reviews.ts:181` are the two construction sites.
- **Candidate for `client/INSIGHTS.md`:** a test helper that substitutes `{count}` by hand cannot render an **ICU plural**. `evalsTab.casesCount` is `{count, plural, one {# case…} other {# cases…}}`, so the usual `msg()` reduce produced the template back and the assertion failed on a correct render. Reading the `other {…}` branch out of the catalogue keeps the copy unforked; retyping the English is the tempting wrong fix. Evidence: `EvalsTab.test.tsx`'s `plural()` helper.
- **`EVAL_REFUSAL_MESSAGE_KEY` now has a second consumer in spirit** — `FindingCard/constants.ts` holds the nine-entry map, and `EvalsTab/constants.ts` needs one of its entries. Law 2 says promote it, and its home is `client/src/lib/eval.ts` (T3's file, forbidden to T9 and to T7). Worth one small follow-up so the two never drift; T11's compare modal will make it a third consumer (`cross_agent_compare`).
- **Two `eval.json` keys the plan implies but no surface can use.** `evalsTab.newCase` and `caseEditor.newCase` describe a create-a-case control that cannot exist while a case is derived from a decided finding. `doc-writer` may want to note them alongside `page.crumbNewCase` / `page.crumbEvalCase` as deliberately-unused.
- **`plan-verifier` has not been run**, and neither have T8's server gates (the other implementer in this wave). `plan-verifier` comes before `architecture-reviewer` and `/pr-self-review`; that ordering is not mine to change.
