# Implementation report — PR Brief (SPEC-03) / T10

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`), worktree dirty from waves 1–5; 2 files changed, 7 added, nothing committed.

## Coverage

- INSIGHTS client: 32 entries, 14 relevant. The ones that changed what was written: 2026-08-04 (a `<Suspense>` boundary for `useSearchParams` on a dynamic route ships a blank first paint — none added); 2026-08-03 (client imports of `@devdigest/shared` stay `import type`; runtime constants live in the unit's `constants.ts`); 2026-08-06 (`var(--bg)` is not a token — every custom property checked against `src/vendor/ui/styles.css`); 2026-08-10 (no `@testing-library/user-event`, no shared QueryClient helper, `Skeleton` has no role); 2026-08-10 (a feature's copy belongs in its own namespace — only `prBrief` is provided to the card's tests); 2026-08-19 (jsdom fires no `click` for Enter on a focused `<button>`); 2026-08-19 (`getByRole(…, { name })` normalises whitespace); 2026-08-19 (a `vi.mock` factory may read a mutable module-level variable — that is how the URL is made mutable in `PrDetailView.test.tsx`); 2026-08-19 (`AppShell` mounts cleanly in jsdom); 2026-08-11 (`scrollMarginTop` is measured, not a constant); 2026-08-05 (`<Markdown>` is inline-only — not used).
- INSIGHTS server: not read and no server file touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `BriefCard/**`, `OverviewTab/OverviewTab.tsx` |
| `react-best-practices` | preloaded | `BriefCard.tsx`, `OverviewTab.tsx`, `PrDetailView.tsx` |
| `next-best-practices` | preloaded (+ `Read` of `suspense-boundaries.md`, `functions.md`) | `PrDetailView.tsx` |
| `react-testing-library` | preloaded | `BriefCard.test.tsx`, `PrDetailView.test.tsx` |
| `typescript-expert` | preloaded | every changed `*.ts` / `*.tsx` |
| `security` | preloaded | `PrDetailView.tsx` (`?file`/`?line` are user input — `line` validated, `file` passed as text), `BriefCard.tsx` (model output renders as plain text; no `<Markdown>`, no `href`, no `dangerouslySetInnerHTML`) |

Matches the plan's routing table: yes, plus `security`.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `.../BriefCard/BriefCard.tsx` | T10 | yes | new — the card: header (label, level badge, regenerate), the state ladder, risks, review focus, receipt |
| `.../BriefCard/constants.ts` | T10 | yes | new — level→icon map, level backgrounds, level order, the known-reason list |
| `.../BriefCard/helpers.ts` | T10 | yes | new — `severityIcon`, `risksWorstFirst`, `filesOmitted`, `isKnownReason`, `hasStoredBrief` |
| `.../BriefCard/styles.ts` | T10 | yes | new — colocated styles, tokens only |
| `.../BriefCard/index.ts` | T10 | yes | new — barrel |
| `.../BriefCard/BriefCard.test.tsx` | T10 | yes | new — 9 cases, one per state, plus the a11y assertions |
| `.../OverviewTab/OverviewTab.tsx` | T10 | yes | owns `usePrBrief`/`useGenerateBrief`, mounts the card above `overviewGrid`, takes and forwards `onOpenFile` |
| `.../PrDetailView/PrDetailView.tsx` | T10 | yes | reads `?file`/`?line`, adds `openFile` (`router.push`), `setTab` clears `file`+`line`, passes `targetFile`/`targetLine` to `DiffTab` and `onOpenFile` to `OverviewTab` |
| `.../PrDetailView/PrDetailView.test.tsx` | T10 (row reassigned) | yes | new — 4 cases: the cross-tab landing, the tab-switch clearing, the missing-target notice, the card order with no verdict banner |

Nothing under `client/src/vendor/**`, `VerdictBanner/**`, `IntentCard/**`, `BlastRadiusCard/**`, `client/messages/**`, `page.tsx` or `server/**` was opened for writing.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R22 / AC-36 (card above intent and blast, verdict banner absent) | T10 | yes — asserted in `PrDetailView.test.tsx`, reading-order over the three labels plus absence of `verdict.prScore` / `verdict.requestChanges` |
| AC-37 (level by word + icon) | T10 | yes — `level.*` word inside a `Badge` carrying `SEVERITY_ICON`; the test asserts the word and an `svg` inside it |
| AC-38 (what and why as two labelled statements) | T10 | yes — and a null `what` renders the why alone, asserted on the `restates_title` case |
| AC-39 (severity word, title, explanation, file refs per risk) | T10 | yes — `severity.*`, deliberately a different vocabulary from `level.*`; refs are plain mono text, and `queryByRole("button", …)` on a ref asserts it is not a control |
| AC-40 (activation navigates to the diff tab with the file targeted) | T10 | yes — `router.push` of `paramsWith({ tab: "diff", file, line })`; asserted on the pushed URL, not on a callback |
| AC-45 (running state, rest of the screen usable) | T10 | yes |
| AC-46 (one empty state offering generation) | T10 | yes — the per-list sentences are asserted absent in that state |
| AC-47 (placeholder shaped like the card) | T10 | yes — six skeleton bars, asserted via `container.getElementsByClassName("skeleton")` |
| AC-48 (notice naming the reason, content below) | T10 | yes |
| AC-49 (generic sentence for an unrecognised reason) | T10 | yes — `KNOWN_REASONS` guard; the test feeds `quantum_flux` and asserts neither the literal nor a key path renders |
| AC-50 (stale notice with the stored brief) | T10 | yes |
| AC-51 (inline error, shell navigable) | T10 | yes — `role="alert"` inside the card |
| AC-52 (token counts and cost) | T10 | yes — and `cost_usd === null` renders `costUnpriced`, never `$0` |
| AC-53 (every control operable without a pointer) | T10 | yes for the automated half — `focus()` + `toHaveFocus()`; activation is `Verify: demonstration` per the spec |
| AC-41 / AC-42 / AC-43 (T6's, exercised by this wiring) | — | yes as wired — the flow test lands on a `wiring`-role file the expansion rule collapses, finds its body rendered, and finds `sd-line-src/server.ts-RIGHT-12` carrying `--dd-sticky-h`; the missing-target notice is asserted from `prReview.smartDiff.targetMissing` |

## Deviations from the plan

- **The general `next-best-practices` rule and this repo's rule collide, and the repo wins.** `suspense-boundaries.md` says `useSearchParams` "always requires a Suspense boundary"; its own wording scopes that to *static* routes, and `client/CLAUDE.md` plus `client/INSIGHTS.md` (2026-08-04) forbid the boundary here because `[repoId]` makes the route dynamic and a boundary makes the server emit the fallback instead of the screen. No boundary was added. Recorded because a reviewer routing `PrDetailView.tsx` to that skill will meet the general sentence first.
- **The running state keeps the previously stored brief on screen**, under the running notice — where `IntentCard` replaces its body while a derivation is in flight. The contract says the document while `running` *is* the previously stored brief, and AC-58 starts a generation on nearly every first open, so replacing would blank a readable brief routinely. The stale notice is suppressed while running so the same fact is not stated twice.
- **A degraded brief renders no risks and no review-focus section at all** (rather than the catalogue's `risksNone` / `reviewFocusNone` sentences). Nobody asked a model, so "no specific risk was identified" would be a claim about the change; the blast card makes the same refusal for the same reason. Those two sentences still render for an `ok`/`partial` brief with empty lists.
- **`BriefCard` takes 7 props**, at the top of `react-best-practices`' 5–7 range: `generateError` is separate from `error` so a refused regeneration does not take the brief on screen down with it.
- **A failed *generation* renders the server's own message and no catalogue sentence.** `messages/en/prBrief.json` is not in T10's Owned paths and has no key for a refused generate request; inventing copy in the component or reusing the read-failure wording would both be wrong. Silence was the worse option — that is the "spinner runs and stops, nothing happened" failure the feature exists to avoid.
- **`prBrief.severityLabel` is left unused.** Each risk row's severity is a badge whose visible word *is* the label; a second "Severity" label beside it adds a fourth type size to the row for no information.
- **Risk rows are ordered worst-severity-first** using `RISK_LEVEL_ORDER`. A display order only — nothing is filtered, and the level itself is still the server's derived value, never recomputed here.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — 0 errors (clean before the first edit too) |
| client | lint | `CI=true ./node_modules/.bin/eslint "…/BriefCard" "…/OverviewTab" "…/PrDetailView/PrDetailView.tsx" "…/PrDetailView/PrDetailView.test.tsx"` | pass — 0 problems (paths listed literally and quoted) |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 50 files / 414 tests. Baseline before the first edit was 48 / 401, so +2 files and +13 tests, no pre-existing failure |
| client | token check | ad-hoc: every `var(--…)` in `BriefCard/**` against `src/vendor/ui/styles.css` | pass — the only hit is the doc-comment line saying `var(--bg)` is *not* a token |
| server | typecheck / depcruise / unit | — | gate did not run — no server file touched; `server/` belongs to the other implementer in this wave and a concurrent whole-package gate would read their half-written files |
| server | `DDG-WIRE-002` grep, `DDG-WIRE-001` loop | — | gate did not run — both are server-side invariants and this diff is client-only |
| — | integration / e2e | — | gate did not run — Docker not authorised |
| — | `next build` | — | gate did not run — never run in this repo; it corrupts the `client/.next` a running `next dev` owns |

## Not done

- `not checked` — **`DDG-UI-001`: a look at the Overview tab in the running app.** The diff changes what that route renders and no gate can see a blank first paint or a layout jump. It needs eyes, not a command.
- `not checked` — AC-53's activation half (Enter on a focused control). jsdom synthesises no `click` for it and this package has no `user-event`; the spec marks AC-53 `Verify: demonstration`.
- `absent` — the server half of this wave (T9) and everything the card reads at runtime: the two routes land in T13, so the card has been exercised only against fixtures.
- `absent` — `server/test/brief.it.test.ts`. Only the `PrDetailView.test.tsx` row was reassigned.

## For the parent

- Candidate for `client/INSIGHTS.md`: **a whole-route flow test can stub just `fetch` and `next/navigation` and keep every hook real, provided the fetch stub is a URL router with an empty-list default.** `PrDetailView.test.tsx` mounts the real shell, header, Overview and Files-changed tabs this way; mocking `@/lib/hooks` instead does *not* work here, because `src/lib/repo-context.tsx` and `src/components/app-shell/hooks/useShellContext.ts` read the same barrel (`./hooks` and `@/lib/hooks` resolve to one file), so the mock would have to re-provide the shell's own hooks. Two traps it cost: the notice on a missing diff target lands with the pull request's file list while the file cards wait on the role-grouping request, so `getByText` on a path needs to be `findByText`; and the repo name and `#482` each appear twice in a real shell (sidebar switcher and breadcrumb), so `getByText` on either throws "found multiple elements" — which is itself the evidence that the shell is real.
- Candidate for `client/INSIGHTS.md`: **a `@@` hunk header does not decide which line numbers exist — the body lines do.** A fixture patch with one context line and one addition renders head-side rows 10 and 11 only, so a `targetLine` of 12 finds no anchor and `document.getElementById(lineId(...))` returns null with no other symptom. Count the body lines when writing a target-line fixture.
- `messages/en/prBrief.json` has no key for a **refused generation request** — the 409-shaped case where one is already running. Right now the card renders the server's message unframed. If that state matters, it wants a key.
- `plan-verifier` has not been run, and neither has `architecture-reviewer` or `/pr-self-review`.

---

## Parent's notes on this report

**The verdict banner is absent and it is asserted absent.** That was the single most likely
thing to go wrong in this task: the design mock draws the banner at the top of this exact
section, so an implementer working from the picture would add it and no criterion would have
failed. AC-36 now has a test that reads the three card labels in order and asserts
`verdict.prScore` and `verdict.requestChanges` are not in the tree.

**Seven deviations, and the two that change what a user sees are both better than the plan.**
Keeping the previously stored brief on screen during a `running` generation is right for a reason
the plan could not have known before AC-58 landed: generation now starts on nearly every first
open, so replacing the body would blank a readable brief routinely. And refusing to print
"no specific risk was identified" on a **degraded** brief is the same refusal the blast card
already makes — nobody asked a model, so the sentence would be a claim about the change rather
than a statement about the brief.

**One gap it could not close and correctly did not paper over:** there is no message key for a
refused generation (the 409 case), because the catalogue is not in T10's Owned paths. It renders
the server's own message rather than inventing copy or, worse, showing nothing. Recorded as a
finding for the ledger rather than fixed in the wrong file.

**Both `INSIGHTS` candidates are strong and held for Phase 6.** The second one — that a `@@`
header does not decide which line numbers exist, the body lines do — is the kind of fact that
costs an hour exactly once and then never again.
