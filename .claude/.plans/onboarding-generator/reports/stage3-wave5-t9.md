# Stage 3 — wave 5 — T9: the tour section card

**Status: complete.**

As of `7bc2916` (`L05-spec-driven-development`); 4 files added, 0 modified, nothing committed. The worktree was already dirty with T1/T3/T5/T7's uncommitted work and none of it was touched.

## Coverage

- INSIGHTS client: 29 entries, 7 relevant (2026-08-05 — `<Markdown>` from `@devdigest/ui` is inline-only and collapses a document body; 2026-08-06 and 2026-08-14 — an undefined CSS custom property silently drops, there is no `--bg` and no `--text-tertiary`; 2026-08-10 — `@testing-library/user-event` is not a dependency here; 2026-08-19 — jsdom dispatches no `click` for Enter on a focused native `<button>`; 2026-08-03 — client imports of `@devdigest/shared` must stay `import type`; 2026-08-11 — a component composing a shared unit legitimately reads two i18n namespaces).
- INSIGHTS server: not read — no file under `server/` was opened for writing or changed. T8 owns that half of wave 5.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | the whole `TourSection/` unit — colocated folder, barrel, `styles.ts`, no helper promoted out of it |
| `react-best-practices` | preloaded | `TourSection.tsx` — derived values (no `useState` for the hrefs or the notice), early-`&&` blocks instead of nested ternaries, helper component outside the body, `aria-label` on the icon-only copy button |
| `next-best-practices` | preloaded | `TourSection.tsx` — client boundary at the unit, no route file touched, no `<Suspense>` |
| `typescript-expert` | preloaded | all three `*.ts`/`*.tsx` — no `any`, `import type` at the shared-contract boundary, `satisfies CSSProperties` |
| `react-testing-library` | preloaded | consulted for the throwaway render check only; the unit's test file is `test-writer`'s and was not created |

Matches the plan's T9 row: yes (`frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`), plus `react-testing-library`, whose row matched the temporary check that was run and discarded.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/TourSection.tsx` | T9 | yes | new — the card: heading with a stable id, `DocumentMarkdown` body, `MermaidDiagram` with a `fallback`, commands + copy control, path rows + `Open`, tasks + complexity badge, links |
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/styles.ts` | T9 | yes | new — `const s` of `CSSProperties`, declared tokens only, wrapping rules for EC-15 |
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/helpers.ts` | T9 | yes | new — `sectionHeadingId(kind)`, the one string the card and T10's rail must agree on |
| `client/src/app/repos/[repoId]/onboarding/_components/TourSection/index.ts` | T9 | yes | new — barrel: `TourSection`, `TourSectionProps`, `sectionHeadingId` |

`client/messages/en/onboarding.json` was **not** edited. Every key the card reads already exists in T3's namespace: `sectionTitle.<kind>`, `diagram.unavailable`, `command.{label,declaredIn,copyLabel,copied,none,notRun}`, `path.{open,openLabel,unavailable}`, `task.{label,complexityLabel,complexity.*}`, `links.label`. Nothing was missing.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-35 (section reachable from the rail) | T9 | yes — the card renders an `<h2 id={sectionHeadingId(kind)}>` inside a `<section aria-labelledby>`; the rail itself is T10's |
| AC-36 (markdown body with headings, lists, fenced code) | T9 | yes — `DocumentMarkdown` from `@/components/document-markdown`; `<Markdown>` from `@devdigest/ui` appears nowhere (grep Done-condition, 0 lines) |
| AC-37 (a diagram rendered as a diagram) | T9 | yes — a non-empty `diagram` goes to `MermaidDiagram`; an empty string is treated as absent (EC-13) |
| AC-38 (unavailable diagram, rest of the section intact) | T9 | yes — `fallback` carries `t("diagram.unavailable")`, so the body, rows and links stay rendered and nothing throws |
| AC-39 (copy places the exact command text) | T9 | yes — `navigator.clipboard?.writeText(command)` with the string untouched, including a trailing comment; nothing is executed |
| AC-45 (keyboard-operable, accessible name) | T9 | yes for this card's controls — copy is a `<button>` with `aria-label`, `Open` is an `<a>` with `aria-label`; no `div` with `onClick`. Activation is `Verify: demonstration` per the spec |
| AC-47 (`Open` at the tour's SHA, new tab) | T9 | yes — `tourFileUrl(repoFullName, indexedSha, path)` from T7, `target="_blank" rel="noreferrer noopener"`; no control renders when the tour has no `indexed_sha` |

## Deviations from the plan

- **A fourth file, `helpers.ts`, holding `sectionHeadingId`.** The plan's Owned paths allow it ("if the card genuinely needs them"). It is re-exported from the barrel because T10's rail must target the same string; a rail that builds its own `#id` is a hand-synced invariant with nothing tying the halves, and the failure is a link that scrolls nowhere. The T9 eslint Done-condition names only three files, so eslint was run over this one as its own invocation as well.
- **Path rows render as an `<ol>` with a visible ordinal.** The plan says "rows as `OnboardingPathNote`s" without fixing the list element; US-4 asks for a numbered reading order and the contract requires one layout for both sections that use the shape. Same row content, same props.
- **The complexity badge's visible text is `Complexity: High`**, i.e. `task.complexityLabel` wrapping `task.complexity.<level>`, rather than the bare word plus a colour. The plan's rule is "a word plus its level, never colour alone"; putting both in the badge's own text carries the level to a screen reader too, without a hidden-text utility this package does not have. Colour is retained as the second signal.
- **No explicit `onKeyDown` anywhere in the card.** The INSIGHTS rule (2026-08-19) puts a behaviour on `onKeyDown` only when it has *no* native keyboard equivalent; every control here is a native `<button>` or `<a>`, whose Enter/Space activation is the browser's. Adding a keydown handler on top would fire the action twice in a real browser. Flagged because the dispatch called it out — the assertable half (real focusable element, accessible name) is present, and `test-writer` will need to dispatch activation separately, as the spec's AC-45 already states.
- **Two honest empty states beyond the plan's list**, both using keys T3 wrote for this card and neither adding one: `command.none` on a `run_locally` section carrying no commands, and `path.unavailable` under a path list when no row could be linked (a tour with no `indexed_sha`).

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | unit | `./node_modules/.bin/vitest run` | pass — rc=0, 43 test files, 353 tests passed, 0 failures |
| client | forbidden-import grep | `grep -rn "vendor/ui/primitives/Markdown\|useQuery\|fetch(" "src/app/repos/[repoId]/onboarding/_components/TourSection/"` | pass — 0 lines |
| client | lint | `./node_modules/.bin/eslint "…/TourSection.tsx" "…/index.ts" "…/styles.ts"` | pass — rc=0 (only Node's `MODULE_TYPELESS_PACKAGE_JSON` notice, pre-existing) |
| client | lint (extra) | `./node_modules/.bin/eslint "…/TourSection/helpers.ts"` | pass — rc=0 |
| client | render check (throwaway) | `./node_modules/.bin/vitest run --config .tmp-smoke.config.ts` | pass — rc=0, 3/3. Scratch config and scratch file were deleted in the same command; `git status` confirms neither remains |
| server | — | — | gate did not run — no server file was touched (T8 owns that half) |

The throwaway check exercised: a `## Heading` + `- item` + fenced body rendering a real heading and list items; `fireEvent.click` on the copy control writing `npm run dev # starts it` verbatim to a stubbed clipboard; an `Open` href containing `/blob/abc123/src/app.ts`; an invalid diagram leaving the body and links rendered with the notice in its place; a valid `flowchart TD` reaching the diagram renderer; and no `Open` control at all with `indexedSha: null`. It was **not** committed to the tree — `TourSection.test.tsx` is `test-writer`'s row in `## Tests`.

## Not done

- `absent` — `TourSection.test.tsx`. Owned by `test-writer` in the plan's `## Tests` table.
- `absent` — the on-this-page rail, the screen header, the notices and the route entry. T10, wave 6.
- `not checked` — how the card looks in the running app (`DDG-UI-001`). It has no route rendering it until T10, and `next build` is never run here.
- `not checked` — the e2e flows and any integration test.

## For the parent

- **T10 should import `sectionHeadingId` from the `TourSection` barrel** rather than reconstructing `#onboarding-section-<kind>`. Its `Depends-on` already includes T9 and its Forbidden list already tells it to import through that barrel, so this needs no plan change — but the rail's correctness depends on it and the plan's T10 text does not name the helper.
- `messages/en/onboarding.json` needed no additions for this card; `command.copy` ("Copy command") is currently unread — the more specific `command.copyLabel` was used, which names the command in the accessible name. T10 may well want `command.copy`; it is not dead until both tasks land.
- No candidate for `client/INSIGHTS.md` from this task: everything non-obvious hit was already recorded there.
- `plan-verifier` has not been run, and neither has `test-writer`.

---

**Parent's independent re-run of T9's Done-conditions:** the forbidden-import grep returns 0 lines; client suite 43 files / 353 tests green; `tsc --noEmit` clean.

**The parent relayed T9's `sectionHeadingId` note into T10's dispatch** before wave 6 started.
