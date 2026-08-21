# Stage 3 — wave 4 — T7: client data layer for the tour

**Status: complete.**

As of `a64a1b0` (`L05-spec-driven-development`); 1 file changed, 2 added, nothing committed. Wave 4, client half only — no file under `server/` was opened for writing.

## Coverage

- INSIGHTS client: 29 entries, 5 relevant (2026-08-03 + its 2026-08-03 addendum — client imports of `@devdigest/shared` must stay `import type`, runtime constants go in `src/lib/`; 2026-08-11 — a mutation that omits a field is a silently successful no-op, and `api.ts`'s conditional `content-type` must stay in the code path; 2026-08-02 — a formatter more than one route subtree needs lives in `src/lib/`, not a unit's `helpers.ts`; 2026-08-10 — no `user-event` and no shared QueryClient helper in this package, which binds the `test-writer` stage rather than T7).
- INSIGHTS server / reviewer-core / e2e: not read — no file in those packages is in T7's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded (+ `references/placement.md`, `references/state-layers.md` read) | `client/src/lib/onboarding.ts`, `client/src/lib/hooks/onboarding.ts`, `client/src/lib/hooks/index.ts` |
| `react-best-practices` | preloaded (+ `examples.md` "Data Fetching in Custom Hooks", "useEffect Misuse" read) | `client/src/lib/hooks/onboarding.ts` |
| `typescript-expert` | preloaded | both new `*.ts` |
| `zod` | preloaded (+ `references/parse-use-safeparse.md`, `references/parse-validate-early.md` read) | both new `*.ts` — see Deviations |
| `security` | preloaded (+ `checklists.md` outline read) | `client/src/lib/hooks/onboarding.ts` — no rule applies: no endpoint is created here, no secret or upload is handled, and the one URL built from repository data goes through the existing `githubBlobUrl`, which owns path encoding |

Matches the plan's routing table for T7 (`frontend-ui-architecture`, `react-best-practices`, `typescript-expert`, `zod`), plus `security`, whose row matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/lib/onboarding.ts` | T7 | yes | new. `reasonMessageKey` (map + generic default), `noticeLevel`, `tourProvenance`, `tourFileUrl`, `OnboardingNoticeLevel`, `TourProvenance` |
| `client/src/lib/hooks/onboarding.ts` | T7 | yes | new. `useOnboardingTour` (function-form `refetchInterval` on `generation_state === "running"`), `useGenerateOnboarding` (body-less POST, invalidates `["onboarding", repoId]`), `OnboardingGenerateAccepted` |
| `client/src/lib/hooks/index.ts` | T7 | yes | one line: `export * from "./onboarding";` |

`client/src/lib/api.ts`, `client/src/lib/github-urls.ts`, `client/src/lib/format.ts`, `client/messages/**` and both `vendor/` trees are unchanged by T7; `git status --short -- client/` shows the other modified paths belong to T1, T3 and T5.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| The tour query polls while the payload says `running` and stops when it does not | T7 | yes — `refetchInterval: (query) => query.state.data?.generation_state === "running" ? TOUR_POLL_MS : false`; `never_generated` and `ready` are both terminal, and the screen owns no timer |
| The generate mutation issues a body-less POST to `/repos/{id}/onboarding/generate` and invalidates the tour key | T7 | yes — `api.post<…>(path)` with no second argument, so `apiFetch` sends no `content-type`; `onSuccess` invalidates `["onboarding", repoId]` |
| An unrecognised reason string resolves to the generic message key | T7 | yes — lookup with `?? "reason.generic"`, never a `switch` falling through to the raw value; `null` also answers with the generic key |
| The age and file counts come from the tour's own recorded fields | T7 | yes — `tourProvenance` reads `files_indexed` / `files_skipped` / `generated_at` only, and never an index-state query |
| Every `@devdigest/shared` import in both new files is `import type` | T7 | yes — gate row below, 0 lines |
| AC-34, AC-40, AC-43, AC-44, AC-47 (all `enabling`) | T7 | yes — the data layer each needs exists; the rendering that satisfies them is T9/T10 |

## Deviations from the plan

- **`zod`'s `parse-use-safeparse` and `parse-validate-early` are not applied to the API response**, and this is a genuine skill-versus-repo conflict. Both rules say to validate external data at the boundary; doing so here means a **runtime** import of `OnboardingTour` from `@devdigest/shared`, which is exactly the failure `client/INSIGHTS.md` (2026-08-03) records and which T7's own Done-condition greps for. The repo rule and the plan win: the response is typed through `api.get<OnboardingTour>` like every other hook in this package, and no schema is parsed client-side. No zod schema is written in either file.
- **The 202 body's type is declared locally as `OnboardingGenerateAccepted`** in the hooks file. The plan specifies the mutation but names no type for its response, and `vendor/shared` is forbidden to T7; `RepoIntelState` in `hooks/repo-intel.ts` is the existing precedent for a locally-declared response shape. It is an acknowledgement the screen never renders.
- **`noticeLevel`'s precedence is `degraded` → `partial` → `stale`.** The plan asked for the level a `{ status, stale }` pair implies but fixed no order for a tour that is both. The reasoning is written at the declaration so T10 does not re-decide it.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | unit | `./node_modules/.bin/vitest run` | pass — rc=0, 43 files / 353 tests passed. Identical to the baseline run taken before the first edit; no pre-existing failure in this package |
| client | `import type` boundary | `grep -n 'from "@devdigest/shared"' src/lib/hooks/onboarding.ts src/lib/onboarding.ts \| grep -v "import type"` | pass — 0 lines |
| client | lint | `./node_modules/.bin/eslint src/lib/hooks/onboarding.ts src/lib/hooks/index.ts src/lib/onboarding.ts` | pass — rc=0, no findings (the `MODULE_TYPELESS_PACKAGE_JSON` line is Node's pre-existing notice about `eslint.config.js`, not a finding) |
| client | `next build` | — | not run, and must not be: it corrupts a running `next dev` |
| server | all | — | gate did not run — no server file was touched (T6 owns the server half of this wave) |
| server/client | integration, e2e | — | gate did not run — need Docker, not requested |

## Not done

- `absent` — `client/src/lib/hooks/onboarding.test.tsx`. The plan's `## Tests` table owns it to `test-writer`, so it is deliberately unwritten. Its shape is pinned there: stub `fetch`, not `api`/`apiFetch`, following `src/lib/hooks/intent.test.tsx`, and assert the poll starting and stopping on `generation_state`.
- `absent` — the screen and the section card (T9, T10) that consume these three exports.
- `not checked` — the running app. `DDG-UI-001` wants a look at the rendered screen, and there is no screen until T10.

## For the parent

- `specs/onboarding-generator.md` was read as an input only; nothing in it is contradicted by this code and no spec file was edited.
- The reason map returns keys **relative to the `onboarding` namespace** — `reason.flag_off`, `reason.generic` — so a consumer holding `useTranslations("onboarding")` resolves them to `onboarding.reason.flag_off` / `onboarding.reason.generic`, which is what T3 wrote and what the dispatch requires. A consumer calling `useTranslations()` with no namespace would resolve them wrongly; `BlastRadiusCard`'s `reasonText` is the house precedent for the relative form. Worth stating in T9/T10's dispatch.
- `reasonMessageKey`'s map is written with `satisfies Record<OnboardingReason, string>`, so the compiler will reject `client/src/lib/onboarding.ts` if `OnboardingReason` ever grows a tenth value with no wording — the exhaustiveness a `Record` annotation alone would not give. No action needed; just do not "simplify" it to a plain annotation.
- `plan-verifier` has not been run, and neither has `test-writer`.

---

**Parent's independent re-run of T7's Done-conditions:** the `import type` boundary grep returns 0 lines; client suite 43 files / 353 tests green.
