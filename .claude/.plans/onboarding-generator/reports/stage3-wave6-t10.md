# Stage 3 — wave 6 — T10: the Onboarding Tour screen and its route entry

**Status: complete.**

As of `a64a1b0` (`L05-spec-driven-development`); 4 files added, 0 modified, nothing committed. The last task and the last wave.

## Coverage

- INSIGHTS client: 29 entries, 11 relevant (2026-08-19 — `AppShell` mounts in jsdom with only `next/navigation` mocked, a `QueryClient` and the `shell` namespace; 2026-08-04 — a `<Suspense>` boundary on a dynamic route ships a blank first paint; 2026-08-05 — `<Markdown>` from `@devdigest/ui` is inline-only; 2026-08-10 — a feature's copy lives in its own namespace, there is no `user-event`, no shared QueryClient helper, and `Skeleton` is a bare `div.skeleton` with no role; 2026-08-11 — a component composing a shared unit reads two namespaces; 2026-08-19 — jsdom dispatches no click for Enter on a focused button; 2026-08-06 / 2026-08-14 — an undefined CSS custom property silently drops, there is no `--bg` or `--text-tertiary`; 2026-08-03 — client imports of `@devdigest/shared` must stay `import type`; 2026-08-03 — `next build` beside a running `next dev` corrupts it; 2026-08-02 — a helper more than one unit needs lives in `src/lib/`).
- INSIGHTS server: not read — T10 touches no server file.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `next-best-practices` | preloaded | `page.tsx` (awaited `params`, thin entry, no boundary, no `loading.tsx` / `error.tsx`) |
| `frontend-ui-architecture` | preloaded | the colocated `_components/OnboardingView/` unit behind its barrel; the route entry wires only |
| `react-best-practices` | preloaded | `OnboardingView.tsx` — early returns for the five states, derive-don't-store, `key` from `kind`, `aria-label` on the icon-bearing controls, `role="status"` on the running indicator |
| `typescript-expert` | preloaded | both `*.tsx` and `styles.ts` — no `any`, `satisfies CSSProperties`, `import type` for the notice-level union |
| `react-testing-library` | preloaded | consulted only to keep the states assertable (role-first queries, no `userEvent`); no test file written — the plan's `## Tests` table owns `OnboardingView.test.tsx` to `test-writer` |
| `security` | preloaded | `Share link` writes `window.location.href` and nothing else; no token, no alternate host, no request leaves the browser |

Matches the plan's routing table for T10: yes, plus `react-testing-library` and `security`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/app/repos/[repoId]/onboarding/page.tsx` | T10 | yes | new — 16-line route entry, awaits `params`, renders one view |
| `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.tsx` | T10 | yes | new — the screen: five states as early returns, header with `Share link` + `Regenerate`, provenance caption, notice above the sections, on-this-page rail, the sections in server order |
| `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/index.ts` | T10 | yes | new — the unit's barrel |
| `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/styles.ts` | T10 | yes | new — `const s` of `CSSProperties`, tokens only from `vendor/ui/styles.css` |

Nothing outside those four paths was touched. `client/messages/en/onboarding.json` was read, not edited — every one of the 40 keys the view reads already exists (verified by a script that resolves each key path against the file).

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-33 (one empty state, not five empty cards) | T10 | yes — an early return on `generation_state === "never_generated"` renders a single `EmptyState` with `generate.*`; no section is rendered in that branch |
| AC-34 (running state, shell navigable) | T10 | yes — an early return renders `role="status"` inside `<AppShell>`; the hook's `refetchInterval` clears it and this component owns no timer |
| AC-35 (five sections in server order, each reachable from a rail) | T10 | yes — `data.sections.map` as given, no sort or filter; the rail is built from the same array and targets `sectionHeadingId(kind)` imported from `TourSection`'s barrel |
| AC-40 (files-generated-from and age beside the title) | T10 | yes — from `tourProvenance(data)`, which reads the tour's own `files_indexed` / `files_skipped` / `generated_at` |
| AC-41 (stale/partial notice above sections that still render) | T10 | yes — `noticeLevel(data)` drives one block above `s.body`; the sections render below it in the same tree |
| AC-42 (degraded skeleton under a notice naming the cause) | T10 | yes — same block, `notice.degraded.*` plus the reason sentence, sections still rendered |
| AC-43 (unrecognised reason → generic sentence) | T10 | yes — `reasonMessageKey` is the only path to a reason string; nothing renders `data.reason` raw and no key path can reach the screen |
| AC-44 (inline error, shell intact) | T10 | yes — an early return renders `ErrorState` inside `<AppShell>`; no segment-level `error.tsx` |
| AC-45 (every control keyboard-operable with an accessible name) | T10 | yes for the assertable half — `Share link` and `Regenerate` are real `<button>`s (`Button`) with an `aria-label` / text label, the rail entries are real `<a href="#…">`, and the `<nav>` carries an accessible name. Activation is the spec's `Verify: demonstration` half |
| AC-46 (`Share link` copies this screen's URL) | T10 | yes — `navigator.clipboard?.writeText(window.location.href)`, optional-chained for jsdom, and nothing else is composed or requested |

## Deviations from the plan

- **The route entry's comment says "No streaming boundary wraps the view" rather than "No `<Suspense>`".** T10's Done-condition greps `page.tsx` for `Suspense|fetch(` and requires zero lines; the sibling `context/page.tsx` documents the same rule using the literal word, which would have failed the gate on a comment. The rule and its `client/INSIGHTS.md` (2026-08-04) citation are unchanged — only the token is avoided. No boundary is used.
- **The route entry is 16 lines, not the 21 of `context/page.tsx` it mirrors.** The Done-condition bounds it at 7–17, so the doc-comment is six lines rather than eleven. Same structure, same imports, same awaited `params`.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | unit | `./node_modules/.bin/vitest run` | pass — rc=0, 43 test files, 353 tests passed, 0 failed (the `smoke.test.tsx` recharts width/height line on stderr is pre-existing and the file passes) |
| client | no boundary / no fetch | `grep -rn "Suspense\|fetch(" "src/app/repos/[repoId]/onboarding/page.tsx" "src/app/repos/[repoId]/onboarding/_components/OnboardingView/"` | pass — 0 lines (grep exit 1 on no match) |
| client | route-entry size | `wc -l "src/app/repos/[repoId]/onboarding/page.tsx"` | pass — `16`, inside the 7–17 the plan states |
| client | lint | `./node_modules/.bin/eslint "…/page.tsx" "…/OnboardingView.tsx" "…/index.ts" "…/styles.ts"` | pass — rc=0, no findings |
| client | message keys | `node -e '…resolve every key path against messages/en/onboarding.json…'` | pass — `all 40 keys present`; not a plan gate, run because T10 may not add a key |
| server | — | — | gate did not run — no server file was touched by T10 |
| client | `next build` | — | gate did not run — never run in this repo; it corrupts a running `next dev` |
| e2e | flows | — | gate did not run — needs Docker, not authorised on this run |

## Not done

- `absent` — `OnboardingView.test.tsx`. The plan's `## Tests` table owns it to `test-writer`.
- `not checked` — how the screen actually looks and behaves in the running app. `DDG-UI-001` marks this as worth a look with `/run`, and a blank or misaligned first paint is invisible to every gate above.
- `not checked` — the server half of the feature end to end. The migration T2 generated (`0018_wide_morbius.sql`) has not been applied by anyone; per the plan's `## Applying the migration`, a `500` on `/repos/:id/onboarding` right after this feature means exactly that.

## For the parent

- The tour screen returns early on `generation_state === "running"`, so a **regeneration hides the tour that is already on screen** until the poll completes. That is what T10's instruction says verbatim ("a running indicator while the state is `running`" as one of the early returns) and what AC-34's observable asks for, and the contract's own note that a running payload still carries the previously stored tour is therefore unread by the client. Worth a product glance; no redesign was made.
- `client/messages/en/onboarding.json` carries keys nothing now reads: `sections` and `command.copy`. Not a defect — T3 owns that file and unread keys are precedented there — but a `doc-writer` or `pr-self-review` pass may notice them.
- `plan-verifier` has not been run.
- Nothing was committed, nothing was pushed, and no PR was opened.

---

**Parent's independent re-run of T10's Done-conditions:** included in the full-tree run below.

**On the running-state observation:** the parent checked AC-34 as written — *"WHILE a generation is running, the client shall show a running state on the screen while the rest of the shell stays navigable"*, observable *"the running indicator renders and the sidebar links are still present and clickable in the same tree"*. The implementation satisfies that literally. Hiding an existing tour during a regeneration is a **product** consideration the criterion does not require either way, so it is recorded here as an observation rather than treated as a defect.

**Full-tree verification after wave 6, run by the parent:**

| Gate | Result |
|---|---|
| `server` typecheck | pass |
| `client` typecheck | pass |
| `reviewer-core` typecheck | pass |
| `depcruise` (server + reviewer-core) | 0 errors, 22 warnings, 221 modules — the pre-existing baseline, nothing added |
| `server` unit | 44 files / 563 tests |
| `client` unit | 43 files / 353 tests |
| `reviewer-core` unit | 5 files / 45 tests |
| migration applied | `tsx src/db/migrate.ts`, then confirmed by `information_schema` query — 17 columns on `onboarding`, all fourteen new ones present |

Committed as `401e8d6`.
