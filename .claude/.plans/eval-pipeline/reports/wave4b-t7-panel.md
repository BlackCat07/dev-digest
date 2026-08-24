# Implementation report — Eval Pipeline (SPEC-04) / T7 (remaining half)

**Status: complete.**

As of `b35fe9b`; 3 files changed, 0 added, nothing committed. All three are inside T7's amended Owned paths; `FindingCard/**` was not touched.

## Coverage

- INSIGHTS client: entries supplied in the brief and, verbatim, in the plan's `## Constraints` → *Client behaviour this feature depends on* (13 entries), taken as read — 8 relevant: no `@testing-library/user-event` in this package (`fireEvent` is the dialect); no shared QueryClient test helper, `AgentCard.test.tsx` / `PRRow.test.tsx` each build one inline; `getByRole(…, { name })` normalises consecutive spaces; `MonoLink` renders a `<button>` with no `href`, so assert by accessible name and never by button count; a component reading two namespaces fails silently in a one-namespace mount; client imports of `@devdigest/shared` stay `import type`; never `next build`; and the `FindingsPanel` reset effect runs on mount, which is why its `useRef(false)` guard exists. The supplied set named a hazard for every file I touched, so I did not re-open `client/INSIGHTS.md`.
- INSIGHTS server, reviewer-core, e2e, mcp-server, evals: no file in those packages was touched; no gate run there.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `react-best-practices` | preloaded | `FindingsPanel.tsx` — derive-don't-store (one new `useState`, everything else read off the mutation), no `useEffect` added, no `renderThing()`, stable `key={f.id}` untouched |
| `frontend-ui-architecture` | preloaded | `FindingsPanel.tsx` — the mutation stays at the unit that owns the list (placement table's "data read/write" row); the sentinel constant stays private to this file, nothing promoted |
| `react-testing-library` | preloaded | both `*.test.tsx` — `getByRole` first, `within` to scope per card, `queryBy` for absence, `findBy` for async, `fireEvent`, mocking at the `fetch` boundary rather than at our own hook |
| `typescript-expert` | preloaded | all three files — no `any`, no `as` on the prop boundary, `instanceof ApiError` instead of a cast, the state union inferred from literals rather than reaching past a barrel |
| `next-best-practices` | preloaded | `FindingsPanel.tsx` — the `"use client"` boundary is unchanged and stays where it was; no route file touched, no `Suspense` added |
| `security` | preloaded | `FindingsPanel.tsx` — the server's refusal `code` is passed as a lookup key only, never interpolated into markup; the sentence rendered is local catalogue copy |
| `zod` | preloaded | read only — nothing here parses; the contract types are consumed by the hook, not by this file |

Matches the plan's routing table for T7 (`react-best-practices`, `frontend-ui-architecture`, `react-testing-library`), plus `typescript-expert`, `next-best-practices`, `security` and `zod`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx` | T7 | yes | owns `useCreateEvalCase`; **one** new state (`evalFindingId`), with `evalCaseState` (`adding`/`added`/`idle`) and `evalRefusalCode` derived from the mutation on each render and handed only to the card that asked; per-card `onTurnIntoEvalCase` calling `mutate(f.id)`; `ApiError.code` extraction with an `UNNAMED_REFUSAL` sentinel for an error that names no code; no new effect |
| `.../FindingsPanel/FindingsPanel.test.tsx` | T7 | yes | `QueryClientProvider` (fresh client) added to the existing `renderWithIntl`; the existing `useFindingAction` mock now returns a `vi.hoisted` `actionMutate` so it is observable; new `describe` with 3 flow tests over the panel's routing — one POST per press with the in-flight/`added` label on the pressed card only, the named refusal inline with `Accept`/`Dismiss` still reaching the action hook, and a second press moving the refusal off the first card |
| `.../ReviewRunAccordion/ReviewRunAccordion.test.tsx` | T7 | yes | one `withProviders` helper adding `QueryClientProvider` around the existing `NextIntlClientProvider`, used by both render helpers. No assertion changed, none removed |

`ReviewRunAccordion.tsx` was **not** touched (`git diff --stat` on it is empty).

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R16 — a decided finding's card offers five actions | T7 | yes — card-level, shipped by the previous dispatch; still green (19 tests) |
| R16 — undecided control present, `aria-disabled`, precondition in its accessible name | T7 | yes — unchanged and still green |
| R16 — activating it issues **one** request carrying the finding id and no expectation type | T7 | yes — the panel test asserts exactly one `POST` to `/eval/cases` per press (and none per extra render or extra card); the exact body `{ finding_id }` with no expectation key is asserted at the `fetch` boundary by T5's `src/lib/hooks/eval.test.tsx` |
| R16 — a refusal renders inline while `Accept` and `Dismiss` stay operable | T7 | yes — `role="alert"` with the catalogue sentence on the pressed card only, and both decisions still reach `useFindingAction().mutate` with the refusal on screen |

## Deviations from the plan

- **`FindingsPanel.test.tsx` and `ReviewRunAccordion.test.tsx` took the `QueryClientProvider` option, not the `vi.mock` option.** The amendment offered either. A provider keeps the real `useCreateEvalCase` in the code path, follows the `AgentCard` / `PRRow` precedent, and — for the accordion — means this file will still notice if the panel gains another hook, which a mock would hide.
- **The panel test does more than the one addition the amendment required.** `DDG-TEST-003`: the panel is the changed seam, and the routing (which card gets `adding`/`added`/the refusal) is the one thing only this component can get wrong. Three flow tests, no existing assertion touched. The existing `useFindingAction` mock's `mutate` became a `vi.hoisted` spy so "`Accept` still works" could assert it *reaches the hook* rather than merely "is not disabled".
- **`UNNAMED_REFUSAL` lives in `FindingsPanel.tsx`, not in `FindingsPanel/constants.ts`.** That constants file is not in T7's Owned paths, and the value is used in exactly one place.
- **The eval state union is inferred, not imported.** `EvalCaseState` is exported from `FindingCard.tsx` but not from that unit's `index.ts` barrel, and the barrel is not mine; a ternary of three literals types the prop exactly.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | unit (T7 trio) | `./node_modules/.bin/vitest run FindingCard FindingsPanel ReviewRunAccordion` | pass — 4 files, 48 passed, 0 failed |
| client | unit (whole suite) | `./node_modules/.bin/vitest run` | pass — 51 files, 437 passed, 0 failed (baseline 434 + the 3 new panel tests) |
| client | lint (owned folders) | `./node_modules/.bin/eslint ".../FindingsPanel" ".../ReviewRunAccordion"` | pass — rc=0, 0 errors, 1 warning: `react-hooks/set-state-in-effect` at `ReviewRunAccordion.tsx:70`, `pre-existing` (that file has no diff) |
| client | lint (plan's T7 Done-condition) | `./node_modules/.bin/eslint ".../FindingCard" ".../FindingsPanel"` | pass — rc=0, no findings |
| client | `DDG-UI-001` visual check | `http://localhost:3000/repos/…/pulls/482` | gate did not run — no browser tooling in this session. The route answers `200`, 98 566 bytes, real shell, no `Application error` / `Unhandled Runtime Error` / `__next_error__`. I checked whether the markup proves anything and it does not: the two hits for `Turn into eval case` are the message catalogue inside the flight payload, and `data-finding-id`, `>Accept<` and `aria-disabled` are absent because the reviews list is fetched after hydration. **I did not look at the action row.** |
| client | `next build` | — | gate did not run — never run; it corrupts the `.next` a running `next dev` owns |
| server / reviewer-core / e2e | — | — | gate did not run — no file in those packages was touched |

## Not done

- `not checked` — how the five controls, the `adding`/`added` labels and the refusal strip actually look: wrapping at a narrow width, and both themes. No browser tooling here.
- `not checked` — hydration-time behaviour of the eval control in the running app (a real press against the real API). The route's own HTML does not carry the panel, so nothing I could reach from a shell observes it.
- `not checked` — keyboard focus order of the `aria-disabled` controls in Chrome. jsdom confirms they are `<button>`s with accessible names.
- `absent` — nothing else in T7 remains; the card half was finished by the previous dispatch and its files were not reopened.

## For the parent

- **T7 is finished.** The amendment was sufficient: the two test files needed exactly the addition it described, and the panel wiring the previous dispatch had measured and reverted now stands with the suite at 437/437.
- **`DDG-UI-001` is still open and is the one thing a gate cannot close.** Someone with eyes on `http://localhost:3000/repos/<repoId>/pulls/482` should expand a *decided* finding and confirm the five-control row and the refusal strip. Two candidate presses: a finding with no decision (the control must read "Turn into eval case — accept or dismiss this finding first" and do nothing), and a decided one twice in a row (the second press should show "Adding to the eval set…" then "Added to the eval set").
- Candidate for `client/INSIGHTS.md`: *a component under `pulls/[number]/_components/` cannot gain its first React Query hook without also touching the test files of every ancestor that mounts it.* `FindingsPanel.test.tsx` and `ReviewRunAccordion.test.tsx` mocked only `lib/hooks/reviews` and provided no `QueryClientProvider`, so `useCreateEvalCase` crashed 16 previously-green tests with `No QueryClient set` while `tsc --noEmit` stayed clean. The fix is one provider per render helper (the `AgentCard.test.tsx` shape); measured across two dispatches of the same task.
- Candidate for `client/INSIGHTS.md`: *a `curl` of a PR page proves nothing about the findings panel.* `/repos/<id>/pulls/<n>` returns 98 KB with the shell and the whole `prReview` catalogue inside the flight payload, so grepping for a label finds the catalogue string and not the rendered control — `data-finding-id`, `>Accept<` and `aria-disabled` are all absent from the HTML because the reviews list is client-fetched after hydration. A `DDG-UI-001` check on this route needs a browser, and a label grep is a false green.
- `specs/eval-pipeline.md` AC-50 through AC-53 are now all reachable in code. Spec not edited — it is not mine.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Both are next and neither is mine.
