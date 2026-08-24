# Implementation report — eval-pipeline / T5

**Status: complete.**

As of `b35fe9b` (`L06-homework`); 1 file changed, 2 added, nothing committed.

## Coverage

- INSIGHTS client: entries supplied verbatim in the brief (5 binding: the type-only-import rule 2026-08-03; assert-the-request 2026-08-11; no `user-event` / no shared QueryClient helper / `Skeleton` has no role 2026-08-10; fake-timer commit lag 2026-08-19; `localhost` not `127.0.0.1` 2026-08-20). Not re-read — the brief carried them, and all five name hazards in the paths I touched. INSIGHTS server, reviewer-core, e2e, mcp-server, evals: 0 relevant per the brief; no file in those packages was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `client/src/lib/hooks/eval.ts` (placement table's "data read/write" row: a hook, never a component body; law 5 — a named module, no `utils` bucket) |
| `react-best-practices` | preloaded | `client/src/lib/hooks/eval.ts` (all fetching in custom hooks; derive-don't-store applied to the SSE hook — see Deviations) |
| `react-testing-library` | preloaded | `client/src/lib/hooks/eval.test.tsx` (mock at the boundary only; fewer, longer flow tests; `fireEvent` dialect not needed — no DOM interaction in this file) |
| `typescript-expert` | preloaded | both `*.ts`/`*.tsx` (no `any`, no `as` on a boundary except the two documented `Response`/`RunEvent` test-fixture casts, explicit exported input interfaces, `noUncheckedIndexedAccess`-safe indexing) |
| `security` | preloaded | `client/src/lib/hooks/eval.ts` — the row matches (code calling endpoints). Traced: every interpolated value is an id from the app's own routing/API, query values go through `URLSearchParams`; no secret, no auth header, no user-authored URL. Nothing to report |
| `zod` | preloaded | matched by the routing table on `*.ts`, but no schema is defined or parsed in T5's files — contract types are imported `import type` only, per EC-35 |

Matches the plan's routing table for T5 (`frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `typescript-expert`), plus `security` and `zod`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/lib/hooks/eval.ts` | T5 | yes | new module: 6 read hooks, 6 write hooks, 1 SSE subscription hook, all against the plan's endpoint table through `api`/`apiFetch`; `EvalBatchDetail` and the four mutation input interfaces exported |
| `client/src/lib/hooks/index.ts` | T5 | yes | one line — `export * from "./eval";` after `./onboarding` |
| `client/src/lib/hooks/eval.test.tsx` | T5 | yes | new: 6 tests, `fetch` stubbed at the network boundary, inline QueryClient wrapper, fake timers |

Nothing else in the worktree is mine. `git diff --stat -- client/src/lib/hooks/` shows exactly the one modified file; the other entries in `git status` are T1–T4's and the wave-3 server implementer's.

## Acceptance

T5's own Acceptance line:

| Requirement | Met |
|---|---|
| `apiFetch` is the only network call | yes — every request goes through `api.*` → `apiFetch`; the only other network primitive is `EventSource`, which the plan requires for the SSE route |
| create-case sends `{ finding_id }` and **no** expectation type (R16/AC-52) | yes — asserted on the exact key set, not just presence (`eval.test.tsx`, first test) |
| the barrel re-exports the new hooks | yes |
| every contract import is `import type` | yes — 4 import statements, all `import type`, both grep forms return 0 lines |

The requirements T5 is listed against, each for T5's share only (the views are T7/T9/T11):

| Requirement | Met |
|---|---|
| R16 | yes — `useCreateEvalCase` sends the finding id alone; `ApiError` reaches the caller carrying `status` and `code`, which is what lets T7 branch the inline refusal on the reason |
| R17 | yes — `useAgentEvalDashboard` supplies the tile values, last batch and `trend` |
| R18 | yes — `useAgentEvalCases` for the set, `useStartEvalBatch` (whole set or one case), `useDeleteEvalCase`, `useSaveEvalCase`, and `useEvalBatchEvents` for the live progress that replaces the run-all control |
| R19 | yes — `useEvalBatch` returns the batch plus its `EvalBatchCaseResult[]` (the execution strip), `useSaveEvalCase` the editor's save |
| R20 | yes — `useEvalDashboard` returns `rows` and `recent_batches` in one read |
| R21 | yes — `useAgentEvalDashboard` (three cards, trend, `alert` from the payload), `useAgentEvalBatches` (the selectable recent-runs table) |
| R22 | yes — `useEvalComparison` (disabled until both ids are present) and `usePromoteAgentVersion`, whose response is the updated agent so the screen shows the resulting version, not the promoted one |
| R23 | yes — every read is a plain React Query, so `isPending` and `error` are per-region and a failed read is scoped to the region that failed |

## Deviations from the plan

- **T5 — the SSE hook derives `running` instead of mirroring it into state.** The plan names `useRunEvents` (`src/lib/hooks/reviews.ts`) as the `EventSource` precedent, and I copied its wire handling verbatim: `onmessage` plus the four kind-named listeners, close on `error`. I did **not** copy its two synchronous `setState` resets in the effect body. `useEvalBatchEvents` keeps one keyed record `{ batchId, events, closed }` and derives both returned values from the id currently asked for, so every write happens in a subscription callback. Same public shape (`{ events, running }`), same behaviour on a batchId change and on stream close. Reason: `react-hooks/set-state-in-effect` fires on the reset form (measured — it did, before the change), and `eslint.config.js` documents `lib/hooks/reviews.ts` as one of seven entries on that rule's burn-down list. Adding an eighth was avoidable in a new file, and `react-best-practices` names it the #1 antipattern.
- **T5 — the contract import is four single-line `import type` statements, not one wrapped block.** A wrapped `import type { … }` puts the module specifier on a `} from "…";` line, which the plan's literal Done-condition grep (whole-file text, filtered by `import type`) counts as a violation while the honest import-scoped form passes. Four short lines satisfy both, and there is no `import/no-duplicates` rule in this package's eslint config. The file's header says why, without naming the specifier — a comment that named it would fail the literal grep, which is the exact trap the plan's own constraint records.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | unit (T5's file) | `./node_modules/.bin/vitest run hooks/eval` | pass — 6 passed |
| client | unit (whole suite) | `./node_modules/.bin/vitest run` | pass — 51 files, 426 passed, 0 failed |
| client | lint | `./node_modules/.bin/eslint src/lib/hooks/eval.ts src/lib/hooks/index.ts src/lib/hooks/eval.test.tsx` | pass — 0 errors, 0 warnings |
| client | type-only import, plan's literal form | `grep -n "@devdigest/shared" src/lib/hooks/eval.ts \| grep -v "import type"` | pass — 0 lines |
| client | type-only import, import-scoped form | `grep -nE "^import .*@devdigest/shared" src/lib/hooks/eval.ts \| grep -v "import type"` | pass — 0 lines |
| client | `next build` | — | gate did not run — never run; it corrupts the `.next` a running `next dev` owns |
| server / reviewer-core / e2e | — | — | gate did not run — no file in those packages was touched |
| e2e flows | `../scripts/e2e.sh` | — | gate did not run — needs Docker and a running stack, not requested |

All gate output was read this run. `CI=true` exported, every binary out of `./node_modules/.bin`, no `pnpm run` anywhere.

## Not done

- `absent` — the views that consume these hooks. T7 (`Turn into eval case` on the finding card), T9 (`Evals` tab and case editor) and T11 (`/eval` dashboard, per-agent page, compare modal, nav entry) are later waves and no file of theirs was touched, so no hook here has a caller yet.
- `absent` — no test asserts the `EventSource` path. jsdom's `EventSource` support was not exercised, and the batch event wire shape is written by T8/T10 in later waves; the hook interprets none of `data` precisely so that it does not encode a guess about the runner's payload.
- `not checked` — the running app. `DDG-UI-001` does not bind to T5 (no route renders differently yet), and nothing here can produce a blank first paint on its own.
- `not checked` — integration and e2e. Docker is not authorised and neither was requested.

## For the parent

- Candidate for `client/INSIGHTS.md`: the 2026-08-19 entry about scoping a grep gate to import statements has a second shape worth naming. It is not only prose that trips a whole-file text search — a **wrapped multi-line `import type { … }`** does too, because the module specifier lands on the `} from "@devdigest/shared";` line, which no `grep -v "import type"` can exempt. The fix that satisfies both the literal gate and the honest one is several single-line `import type` statements from the same module; this package has no `import/no-duplicates` rule, so that is lint-clean. Evidence: `client/src/lib/hooks/eval.ts:33-36` and both gate rows above.
- Confirmation of an existing entry, no new one needed: the fake-timer commit lag (2026-08-19) cost one red run here. `flush(4000)` then `flush(0)` asserted `'running'` where `'complete'` was expected; two consecutive `flush(4000)` calls pass. The call count was green throughout, exactly as the entry says.
- No spec contradiction found. `specs/eval-pipeline.md` was read only through the plan's `Source:` citations; T5 changed no behaviour a criterion names that the plan did not already fix.
- `plan-verifier` has not been run, and is not mine. It comes before `test-writer`, `architecture-reviewer` and `/pr-self-review`.
