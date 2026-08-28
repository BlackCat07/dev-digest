# Implementation report — Eval Pipeline (SPEC-04) / T11

**Status: complete.**

1 file changed, 17 added, nothing committed.

> **Orchestrator note.** This report's header named `b65d2da` / `L06-evals-and-plan-verifier`, the
> same slip T10 made in the same wave. Verified: the branch is `L06-homework` at `b35fe9b` with
> the three expected commits. Two independent dispatches reporting the wrong base in one wave is
> worth an insight of its own — see `run.md`.

## Coverage

- INSIGHTS client: entries supplied verbatim in the brief and in the plan's `## Constraints` — 9 relevant (2026-08-03 `import type` only from `@devdigest/shared`; 2026-08-03 never `next build`; 2026-08-04 no `<Suspense>` around a view reading `useSearchParams`; 2026-08-06 `var(--bg)` is not a token; 2026-08-10 no `user-event`, no shared QueryClient helper, `Skeleton` has no role; 2026-08-10 a namespace is one file; 2026-08-11 a unit reading two namespaces must be mounted with both; 2026-08-19 `eslint` on `src/vendor/**` lints nothing; 2026-08-19 `getByRole(name)` cannot match consecutive spaces). Did not re-open the file.
- INSIGHTS server, reviewer-core, e2e, mcp-server, evals: `0 entries` relevant, per the dispatch; no file in those packages was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `client/src/app/eval/**` (route entries thin; colocated `_components/`; `CompareModal` private to its one consumer; named `constants.ts`/`helpers.ts`/`styles.ts`, no `utils`) |
| `next-best-practices` | preloaded | both route entries (awaited `params`, no `<Suspense>`, `"use client"` at the view) |
| `react-best-practices` | preloaded | all `*.tsx` (derive-don't-store for the compare pair, the skip notices and the promoted version; no `renderThing()`; stable keys; `aria-label` on the row control; every status carries a word) |
| `react-testing-library` | preloaded | the two `*.test.tsx` (role-first queries, `queryBy` for absence, `findBy`/`waitFor`, `fireEvent`, mocked at the `fetch` boundary only, 4–5 flow tests) |
| `typescript-expert` | preloaded | all changed `*.ts`/`*.tsx` (no `any`, no `as` on a payload, `noUncheckedIndexedAccess`-safe indexing, explicit return types on the helpers) |
| `security` | preloaded | reviewed: no new input handling, no secret, no endpoint; the only attacker-influenced values rendered are agent/model names and prompt snapshots, and React escapes them — nothing to report |

Matches the plan's routing table: yes, plus `security`, whose row matches any file rendering server data.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/vendor/ui/nav.ts` | T11 | yes | one `SKILLS LAB` entry (`eval` / `FlaskConical` / `/eval` / `g e`), one `SHORTCUTS` row, and one doc-comment sentence that had listed Eval Dashboard as a route that does not exist yet. No `NavItem` styling touched |
| `client/src/app/eval/page.tsx` | T11 | yes | new — thin route entry, no `<Suspense>` |
| `client/src/app/eval/[agentId]/page.tsx` | T11 | yes | new — thin route entry, `await params` |
| `client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx` | T11 | yes | new — agent rows, period filter, `Run all agents` + skip notices, cross-agent recent-runs table, skeletons, inline error |
| `.../EvalDashboardView/{constants,helpers,styles}.ts`, `index.ts` | T11 | yes | new — grid tracks + column order, sparkline threshold, skip-name resolution |
| `.../EvalDashboardView/EvalDashboardView.test.tsx` | T11 | yes | new — 5 tests |
| `client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx` | T11 | yes | new — alert strip from the payload, three metric cards with point changes, three-series `LineChart` + named legend, selectable recent-runs table, `Compare` gate |
| `.../AgentEvalView/{constants,helpers,styles}.ts`, `index.ts` | T11 | yes | new — metric colours/labels, change tone, `comparePair`, `chartPoints`, `promotableVersions` |
| `.../AgentEvalView/_components/CompareModal/{CompareModal.tsx,styles.ts,index.ts}` | T11 | yes | new — four cards, `not measured`, prompt-unchanged region, promote control |
| `.../AgentEvalView/AgentEvalView.test.tsx` | T11 | yes | new — 4 tests |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R20 — nav entry, active under `/eval`, agent rows, sparkline omitted below two batches, recent-runs table | T11 | yes — `nav.ts` entry + `activeKeyFor` (line 44, unchanged); asserted in `EvalDashboardView.test.tsx` |
| R21 — three metric cards, three named series, selectable runs, alert from the payload, `Compare` iff exactly two | T11 | yes — asserted at zero, one, two and three selections |
| R22 — four compare cards, `not measured` for a null change, prompt-unchanged with no diff body, promotion shows the resulting version | T11 | yes — the promote flow asserts v8 from promoting v6, and that "now version 6" is absent |
| R23 — skeletons shaped like what is coming, inline error with the shell rendered | T11 | yes — asserted against the real `AppShell` sidebar and breadcrumb |

## Deviations from the plan

- **The period filter is local state, not a URL search param.** `frontend-ui-architecture`'s placement table puts a filter in the URL, but `/eval` has **no dynamic segment**, so it is statically prerenderable and `useSearchParams()` there forces a CSR bailout that only a `<Suspense>` boundary silences — and T11 forbids that boundary for the exact failure it caused before. The sibling `/eval/[agentId]` uses local state too, so the two screens agree.
- **`previousTrendPoint`, `metricChange` and `changeTone` are duplicated** from T9's `EvalsTab/helpers.ts` into `AgentEvalView/helpers.ts`. Law 2 would promote them on this second consumer; the nearest common ancestor is `src/lib/eval.ts`, which T11 does not own. The delta **formatters** — the part that must not fork — are imported from `src/lib/eval.ts` by both units. Recorded in the file's own header.
- **The metric-cards section is labelled `evalsTab.metricsTitle`, not `dashboard.metricTrend`.** `dashboard.metricTrend` and `agentPage.trendHeading` are the same literal string ("Metric trend"), so using it produced two regions with one accessible name and `getByRole("region", …)` threw. No key was added.
- **The trend chart drops points where any of the three metrics is null** rather than rendering them. `LineChart` maps a missing value to `0`, which would draw "measured nothing" as "scored zero" — the one conflation this feature exists to prevent. Those batches still appear in the recent-runs table with `—`.
- **Sparkline presence is asserted via `data-testid`.** It is a decorative `<svg>` sharing its tag with every icon on the row, it has no nameable role, and captioning it would need a catalogue key I may not add.
- **The run-selection checkbox's accessible name is supplied visually hidden** through the vendored `Checkbox`'s existing `label` node prop (`agentPage.selectRun`). No primitive gained a prop; repeating the sentence visibly on every row would have drowned the numbers.
- **`messages/en/shell.json` needed no edit** — `nav.eval` is already present, and in any case `Sidebar` renders `nav.ts`'s own English label rather than the catalogue key.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | lint | `./node_modules/.bin/eslint src/app/eval` | pass — `nav.ts` deliberately **excluded**: eslint ignores `src/vendor/**` and exits 0 having linted nothing |
| client | unit (target) | `./node_modules/.bin/vitest run EvalDashboardView AgentEvalView` | pass — 2 files, 9 tests |
| client | unit (whole suite) | `./node_modules/.bin/vitest run` | pass — 54 files, 455 tests, 0 failures (baseline 52 / 446; +2 files, +9 tests, no pre-existing failure) |
| client | `DDG-DNT-002` | `git diff --stat -- src/vendor/ui/` | pass — exactly one file: `client/src/vendor/ui/nav.ts`, 5 insertions / 2 deletions |
| client | `DDG-DNT-002` | `git status --porcelain -- src/vendor/ui/` | pass — one ` M` line, `nav.ts` |
| client | `DDG-UI-001` | `curl … localhost:3000/eval` and `/eval/some-agent-id` | pass — `200` on both (both were `404` before this task). Per the dispatch, no HTML was grepped: the data is client-fetched after hydration, so a label search would find the message catalogue in the flight payload, not the rendered control. **I did not see the rendered screen.** |
| client | `next build` | — | gate did not run — forbidden, and never needed |
| server / reviewer-core / e2e | — | — | gate did not run — no file in those packages was touched |

## Not done

- `not checked` — the e2e flows. They need a running stack driven by `../scripts/e2e.sh`, which was not requested and whose Postgres default collides with the live one.
- `not checked` — the screens as rendered pixels. `DDG-UI-001` was discharged with the two `200`s only.
- `absent` — the server half of this wave (T10). It is another implementer's, and nothing under `server/` was read for writing or edited.

## For the parent

- `server/pnpm-workspace.yaml` **exists** and is **not** the `DDG-WIRE-005` scaffold: it is committed (`29e2b64`), carries no `packages:` key, and exists to stop `pnpm <script>` dying on `ERR_PNPM_IGNORED_BUILDS`. It was left alone. Worth stating in the plan, since `DDG-WIRE-005` as written reads like "delete any `server/pnpm-workspace.yaml` you find".
- Candidate for `client/INSIGHTS.md`: **two catalogue keys with identical English make two `<section aria-label>`s indistinguishable to `getByRole("region", { name })`**, which throws "found multiple elements" — `eval.json`'s `dashboard.metricTrend` and `agentPage.trendHeading` are both "Metric trend". Nothing in typecheck, lint or i18n catches it; only a role query does.
- Candidate for `client/INSIGHTS.md`: **the real `AppShell` does mount in jsdom with only `vi.mock("next/navigation")`, a `QueryClient` and the `shell` namespace** — confirmed on two new files — but the sidebar renders `vendor/ui/nav.ts`'s own English labels, **not** `shell.json`'s `nav.*`. So "Eval Dashboard" appears three times on `/eval` (sidebar, breadcrumb, `h1`) and `nav.eval` in `shell.json` is dead copy for the sidebar (the command palette does use it). Evidence: `client/src/vendor/ui/shell/{Sidebar,NavItem}.tsx`.
- Candidate for `client/INSIGHTS.md`: **a `Modal` mounts before its own query resolves**, so `await screen.findByRole("dialog")` succeeds against the modal's skeletons and the next synchronous `getByText` fails. The content, not the dialog, is what must be awaited.
- T11's stated Done-condition `git diff --stat -- src/vendor/` **cannot pass in multi-agent mode** — T1's uncommitted `client/src/vendor/shared/index.ts` barrel line sits in the same worktree, and T9 reported the same contradiction. I ran the corrected `-- src/vendor/ui/` form the dispatch supplied. The plan should be amended.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Both are next and neither is mine.
