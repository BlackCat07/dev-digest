# Implementation report — SPEC-03 PR Brief / T6

**Status: complete.**

Reported as of `34cb66e`; the run's actual base is `06d7488` (the same slip as T3 and T5).
Worktree already dirty from waves 1–3; 9 files changed by this task, 0 added, nothing committed.

## Coverage

- INSIGHTS client: 32 entries, 8 relevant (2026-08-11 — `react-hooks/set-state-in-effect` is an Error, lift openness to the parent and keep a `ref` nonce guard; 2026-08-11 — `scrollMarginTop` here cannot be a constant, `STICKY_SCROLL_MARGIN` is the measured value; 2026-08-12 — `Element.prototype.scrollIntoView` is shimmed in `src/test/setup.ts`, never per file; 2026-08-10 — `@testing-library/user-event` is not a dependency, use `fireEvent`; 2026-08-11 — a component composing a shared unit reads two i18n namespaces and tests must provide both; 2026-08-10 — a feature's copy belongs in its own namespace; 2026-08-19 — `eslint` on a `src/vendor/` path exits 0 while linting nothing; 2026-08-06 — `var(--bg)` is not a token).
- INSIGHTS server: not read and not claimed — no server file is in T6's Owned paths, and another implementer owns `server/` in this wave.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `SmartDiffViewer/helpers.ts`, `SmartDiffViewer/index.ts`, `SmartDiffViewer/styles.ts`, `DiffTab/DiffTab.tsx` |
| `react-best-practices` | preloaded | `SmartDiffViewer.tsx`, `SmartFileCard.tsx`, `DiffTab.tsx` |
| `react-testing-library` | preloaded | `DiffTab.test.tsx`, `SmartDiffViewer.test.tsx` |
| `typescript-expert` | preloaded | all changed `*.ts` / `*.tsx` |
| `next-best-practices` | preloaded | `DiffTab.tsx`, `SmartDiffViewer.tsx` — no `useSearchParams`, no `<Suspense>` added; the target arrives as props |
| `security` | preloaded | `DiffTab.tsx` — the notice interpolates an author-controlled path through next-intl (escaped by React), no `dangerouslySetInnerHTML`, no URL built from it |

Matches the plan's routing table: yes, plus `next-best-practices` and `security`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `.../SmartDiffViewer/SmartDiffViewer.tsx` | T6 | yes | two optional props `targetFile` / `targetLine`; `openOverrideFor` derives the targeted file's openness ahead of `initialOpen`; passes `targetLine` only to the matching card |
| `.../SmartDiffViewer/_components/SmartFileCard/SmartFileCard.tsx` | T6 | yes | optional `targetLine`; one effect that resolves `lineId(...)` with `getElementById` and calls `scrollIntoView`, guarded by a `ref`-held line nonce; the targeted row's `rowStyle` merges `s.targetRow` |
| `.../SmartDiffViewer/styles.ts` | T6 | yes | new `targetRow` = `{ scrollMarginTop: STICKY_SCROLL_MARGIN }` |
| `.../SmartDiffViewer/helpers.ts` | T6 | yes | exports `samePath`, the view model's own path comparison |
| `.../SmartDiffViewer/index.ts` | T6 | yes | barrel exports `samePath` |
| `.../DiffTab/DiffTab.tsx` | T6 | yes | two optional props, passed to `SmartDiffViewer`; derived `targetMissing` and the notice naming the path |
| `client/messages/en/prReview.json` | T6 | yes | one key, `smartDiff.targetMissing` |
| `.../SmartDiffViewer/SmartDiffViewer.test.tsx` | T6 | yes | 5 tests (AC-41, AC-42) plus a `spyOnScroll` helper |
| `.../DiffTab/DiffTab.test.tsx` | T6 | yes | 3 tests (AC-43); `mount()` now takes prop overrides |

Nothing under `server/`, `client/src/vendor/**`, `PrDetailView/**`, `OverviewTab/**` or `client/messages/en/prBrief.json` was opened for writing.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R22 / AC-41 — targeted file expands even where its default state is collapsed | T6 | yes — `SmartDiffViewer.test.tsx` "expands the targeted file even where the rule collapses it" (a lock file), with the untargeted wiring file still shut |
| R22 / AC-42 — targeted line scrolled into view clear of the measured sticky header | T6 | yes — "scrolls the targeted line into view, clear of the sticky header": the scroll receiver **is** the element `getElementById("sd-line-src/config.ts-RIGHT-12")` returns, its `scrollMarginTop` contains `--dd-sticky-h`, and its neighbour's is empty |
| R22 / AC-43 — a targeted file absent from the rendered diff is named | T6 | yes — `DiffTab.test.tsx` "names the file it cannot show, and keeps the rest of the tab", plus the same notice on the degraded branch and its absence when the file did arrive |

## Deviations from the plan

- **T6, openness.** The plan says `targetFile` "seeds `openOverrides` with `{ [targetFile]: true }`". Seeding that state from a prop needs a `setState` in an effect — the exact Error the same paragraph forbids — so openness is **derived** instead: `openOverrides[path] ?? (samePath(path, targetFile) ? true : undefined)`. Same observable behaviour for AC-41, one fewer render, and the sparse-override invariant the map documents stays intact; the reader's explicit collapse still wins because the map is consulted first. One behavioural nuance worth stating: when the target later moves to another file, the previously targeted file returns to its rule rather than staying open, which a state seed would not have done.
- **T6, path matching.** `DiffTab` does not compare paths raw. `helpers.ts` now exports `samePath`, the normalisation `buildViewModel` already uses, and the barrel re-exports it — the second consumer promotion `latestFindingsPerAgent` set the precedent for. Matching a second way would let one file be simultaneously "expanded" by the viewer and "missing" by the tab.
- **T6, where the scroll lives.** The effect sits in `SmartFileCard` (fed a `targetLine` the viewer scopes to the matching file) rather than in the viewer, so the anchor lookup and the row's `scrollMarginTop` are in one component — the shape the implementation removed on 2026-08-12 used.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — rc=0, 0 errors |
| client | lint | `CI=true ./node_modules/.bin/eslint "src/app/repos/[repoId]/pulls/[number]/_components/DiffTab" "src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer"` | pass — rc=0; re-run with `--format json` to prove coverage: 30 files linted, 0 problems (paths listed literally and quoted, per the zsh note) |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 47 files, 396 tests, 0 failures, no `pre-existing` red (the 9 new tests are the delta from 387) |
| client | `next build` | — | gate did not run — never run in this repo; it corrupts a live `next dev`'s `client/.next` |
| server | all | — | gate did not run — no server file touched; another implementer owns `server/` this wave |
| — | integration / e2e | — | gate did not run — Docker not authorised |

## Not done

- `absent` — nothing passes `targetFile` / `targetLine` in the tree. That is T6's design: T10 wires them from the URL in wave 6.
- `absent` — the degraded branch (grouping failed → plain `DiffViewer`) honours a target only as far as the notice; that viewer has no per-file disclosure to open. Stated in `DiffTab`'s header comment.
- `not checked` — how this looks in the running app. `DDG-UI-001` applies (the tab's render changed) and no gate can see a first paint.
- `not checked` — `client/…/PrDetailView/PrDetailView.test.tsx`, the cross-tab flow.

## For the parent

- `DDG-UI-001` (WARNING): the `Files changed` tab gained a notice above the diff. Worth one look in the running app once T10 supplies a target — a `?file=` naming a path outside the rendered page is the interesting case.
- Candidate for `client/INSIGHTS.md`: a spy's recorded receiver is the whole point of a scroll assertion, and `vi.spyOn(Element.prototype, "scrollIntoView")` alone does not give it — `mock.instances` is for constructors. Capturing `this` in a `mockImplementation` is what lets a test say *which* row was scrolled to, which is the difference between AC-42 and "something scrolled". Evidence: `SmartDiffViewer.test.tsx` (`spyOnScroll`).
- Candidate for `client/INSIGHTS.md`: in `DiffTab`, `findByText` on a prop-derived notice resolves during the **skeleton**, before the grouping query settles, so a test that asserts the notice and the diff together must wait for a file first — otherwise it passes on a page that has no diff on it at all. Cost one red run. Evidence: `DiffTab.test.tsx` ("names the file it cannot show, and keeps the rest of the tab").
- `plan-verifier` has not been run, and is not mine.

---

## Parent's notes on this report

**The openness deviation is better than the plan and for the right reason.** The plan said to
*seed* `openOverrides` from `targetFile`, and its own next sentence forbids the mechanism that
would require — `react-hooks/set-state-in-effect` is an Error in this package and would fail
`next build`. Deriving openness instead (`openOverrides[path] ?? samePath(path, targetFile)`)
gives the same observable for AC-41, one fewer render, and keeps the sparse-override invariant.
The behavioural nuance it volunteered is the part a reviewer would otherwise have to find: when
the target moves to another file, the previously targeted file returns to its rule instead of
staying open. That is the better behaviour and it is now written down.

**`samePath` is the right call and the reason generalises.** Comparing paths one way in the
viewer and another way in the tab would let a single file be simultaneously "expanded" by one
component and "missing" by the other — two components disagreeing about identity, which is the
class of bug that reads as a rendering glitch and is not one.

**Both `INSIGHTS` candidates are real and are held for Phase 6.** The scroll-receiver one is the
sharper of the two: `vi.spyOn(Element.prototype, 'scrollIntoView')` proves *something* scrolled,
and AC-42 requires knowing *which row* — capturing `this` in a `mockImplementation` is the
difference, and nothing in the repository records it.
