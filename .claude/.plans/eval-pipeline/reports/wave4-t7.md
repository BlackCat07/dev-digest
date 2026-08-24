# Implementation report — Eval Pipeline (SPEC-04) / T7

**Status: partial.**

As of `b35fe9b`; 4 files changed, 0 added, nothing committed. `FindingsPanel.tsx` was written, measured, and reverted to `HEAD` — see `## Blocked`.

## Coverage

- INSIGHTS client: entries supplied verbatim in the brief (via the plan's `## Constraints`), taken as read — 8 relevant (no `user-event` in this package; `getByRole` name normalises consecutive spaces; `scrollIntoView` already shimmed in `src/test/setup.ts`; a component reading two namespaces fails silently in a one-namespace mount; no shared QueryClient test helper; `var(--bg)` is not a token; `Badge` spreads `...style` last and the escape hatch is per-component; never `next build`). The supplied set named a hazard for every file I touched, so I did not open `client/INSIGHTS.md`.
- INSIGHTS server, reviewer-core, e2e, mcp-server, evals: stated in the brief as 0 relevant to these paths; no file in those packages was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `FindingCard/{FindingCard.tsx,styles.ts,constants.ts}` — law 2 (the refusal-key map stays private to this unit, nothing promoted), the "constant that encodes an invariant lives next to the code that must agree with it" row |
| `react-best-practices` | preloaded | `FindingCard.tsx` — derive-don't-store (five derived values, no new state), no `useEffect` for event handling, `aria-label` on the inert controls, a word beside every state |
| `react-testing-library` | preloaded | `FindingCard.test.tsx` — `getByRole` first, `queryBy` for absence, `fireEvent` (this package's dialect), fewer/longer flow tests |
| `typescript-expert` | preloaded | all three changed `*.ts`/`*.tsx` — `satisfies` for exhaustiveness over the contract union, no `any`, no `as` at the prop boundary, `noUncheckedIndexedAccess`-safe lookup |
| `next-best-practices` | preloaded | `FindingCard.tsx` — the `"use client"` boundary is unchanged and stays at the existing depth; no route file touched |
| `security` | preloaded | `FindingCard.tsx` — the refusal `code` is server-supplied text used only as a **lookup key** into a fixed map, never interpolated into markup; the message rendered is local catalogue copy, so no server string reaches the DOM |
| `zod` | preloaded | read only — `EvalRefusalReason` is consumed as a type; nothing here parses |

Matches the plan's routing table for T7 (`react-best-practices`, `frontend-ui-architecture`, `react-testing-library`), plus `typescript-expert`, `next-best-practices`, `security` and `zod`, whose rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` | T7 | yes | action row goes from 2 to 5 controls: `Turn into eval case` (rendered only when the new optional `onTurnIntoEvalCase` is supplied; `aria-disabled` with the precondition in its accessible name until the finding is decided; `adding`/`added` labels), plus `Learn` and `Reply to author` present, `aria-disabled` and handler-less (N3). New inline refusal block (`role="alert"`) below the actions. Three new optional props: `onTurnIntoEvalCase`, `evalCaseState`, `evalRefusalCode`; one new exported type `EvalCaseState` |
| `.../FindingCard/constants.ts` | T7 | yes | `EVAL_REFUSAL_MESSAGE_KEY` (`EvalRefusalReason` → `prReview` key) and `EVAL_REFUSAL_FALLBACK_KEY`; one `import type { EvalRefusalReason }` |
| `.../FindingCard/styles.ts` | T7 | yes | two named members: `inertAction` (the `aria-disabled` look, since `Button` only dims for the native attribute) and `evalRefusal` (`--warn` / `--warn-bg`, both real tokens) |
| `.../FindingCard/FindingCard.test.tsx` | T7 | yes | new `describe` block, 7 tests: the five actions by accessible name, the undecided `aria-disabled` control refusing presses, no eval control when no parent supplies one, the `adding`/`added` states, the inline refusal with `Accept`/`Dismiss` still firing, the unknown-code fallback, and no `role="alert"` when there is nothing to say. Labels read off the imported catalogue, never retyped |
| `.../FindingsPanel/FindingsPanel.tsx` | T7 | yes | **no net change** — byte-identical to `HEAD`. `git diff` on it is empty |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R16 — five actions on a decided card | T7 | yes — `Accept`, `Dismiss`, `Turn into eval case`, `Learn`, `Reply to author`, asserted by accessible name |
| R16 — undecided control present, `aria-disabled`, precondition in its accessible name | T7 | yes — name is `finding.turnIntoEvalCaseDisabled`; a press calls nothing |
| R16 — activating it issues one request carrying the finding id and no expectation type | T7 | no — the card invokes its handler exactly once with no arguments (tested), but nothing supplies that handler: see `## Blocked` |
| R16 — a refusal renders inline while `Accept` and `Dismiss` stay operable | T7 | no — the rendering and the operability are implemented and tested, but the refusal has no live source until the panel is wired: see `## Blocked` |

## Deviations from the plan

- **The five actions are asserted by accessible name, not by counting buttons.** With no `repoFullName`/`headSha` in the fixture, `MonoLink` renders `file:line` as a sixth `<button>`, so `getAllByRole("button")` counts a primitive's internals rather than what the reviewer can do. Measured: the count assertion failed at 6-vs-5 before the change.
- **`Learn` and `Reply to author` render unconditionally; only the eval control is behind the new optional prop.** Neither needs a handler or a hook, so neither can break a caller, and this keeps the row at five wherever the eval prop is supplied. A card rendered without the prop shows four — asserted explicitly.
- **The refusal crosses the prop boundary as the server's `code`, not as a sentence.** The copy lives in the `prReview` catalogue the card already reads; a panel that formatted it would be a second place refusal wording can drift. Any code outside the nine contract members resolves to `finding.evalRefusalUnknown`.
- **`FindingCard` is rendered by one parent, not three.** The brief named `ReviewRunAccordion` and `RunTraceDrawer`'s `FindingsSection` as additional callers; measured, `FindingsSection` draws its own markup and imports no `FindingCard`, and `ReviewRunAccordion` renders `FindingsPanel`, not the card. The optional-prop design is unchanged — it is what keeps the blocked half from being a breaking change.

## Blocked

- **T7, the `FindingsPanel` half.** `FindingsPanel` must own the `useCreateEvalCase` mutation, and any React Query hook in that component throws `No QueryClient set, use QueryClientProvider to set one` in two test files that mount it and provide no client: `FindingsPanel.test.tsx` and `ReviewRunAccordion.test.tsx`. Both are outside my Owned paths.

  **Measured, not predicted.** I wrote the full wiring (the mutation, a single `evalFindingId` with everything else derived from the mutation's own state, the `ApiError.code` extraction, the handler and the two props on the card), ran it, and got `Test Files 2 failed | 1 passed`, `Tests 16 failed | 10 passed`, with 17 occurrences of `No QueryClient set` and the stack pointing at `useCreateEvalCase` → `FindingsPanel.tsx:59`. `tsc --noEmit` was clean throughout — the compiler cannot see this. I then reverted `FindingsPanel.tsx` to `HEAD` rather than leave 16 previously-green tests red.

  To unblock: add `FindingsPanel.test.tsx` and `ReviewRunAccordion.test.tsx` to T7's Owned paths (each needs one addition — either a `vi.mock("@/lib/hooks/eval", …)` beside the `lib/hooks/reviews` mock those files already carry, or a `QueryClientProvider` in their render helper), then re-dispatch the panel half. The card side needs no change: the props it exposes are `onTurnIntoEvalCase: () => void`, `evalCaseState?: "idle" | "adding" | "added"` and `evalRefusalCode?: string | null`.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | unit (T7 Done-condition) | `./node_modules/.bin/vitest run FindingCard FindingsPanel` | pass — 3 files, 37 passed, 0 failed |
| client | lint (T7 Done-condition) | `./node_modules/.bin/eslint "…/FindingCard" "…/FindingsPanel"` | pass |
| client | unit (neighbour, not mine) | `./node_modules/.bin/vitest run ReviewRunAccordion` | pass — 8 passed |
| client | unit (whole suite) | `./node_modules/.bin/vitest run` | pass — 51 files, 434 passed, 0 failed |
| client | `DDG-UI-001` visual check | `http://localhost:3000/repos/…/pulls/12?finding=…` | gate did not run — browser tools are not available in this session. The route answers `200`, 98 KB, with the real shell (`Pull Requests`, `payments-api`, `Findings` present) and no `Application error` / `Unhandled Runtime Error` / `__next_error__` marker — but **I did not look at the action row**, and no curl can see a blank paint |
| client | `next build` | — | gate did not run — never run; it corrupts the `.next` a running `next dev` owns |
| server / reviewer-core / e2e | — | — | gate did not run — no file in those packages was touched |

## Not done

- `absent` — the live eval control in the running app. `FindingsPanel` supplies no handler, so today the route renders four actions (`Accept`, `Dismiss`, and the two inert ones) and no `Turn into eval case`. That is the blocked half above, not an oversight.
- `not checked` — how the new controls look at the two themes and whether the five wrap sensibly at a narrow width. `s.actions` already sets `flexWrap: "wrap"`, but I could not see it.
- `not checked` — keyboard reachability of the `aria-disabled` controls in a real browser. jsdom confirms they are `<button>`s with accessible names; focus order in Chrome is unverified.

## For the parent

- **T7 is not finished and the plan's T7 Owned paths cannot finish it.** The two-line fix is in two test files the plan assigned to nobody. Worth deciding before `plan-verifier` runs, because R16's third and fourth observables will read as unmet.
- Candidate for `client/INSIGHTS.md`: *a component in `pulls/[number]/_components/` cannot gain its first React Query hook without also touching the test files of every ancestor that mounts it* — `FindingsPanel.test.tsx` and `ReviewRunAccordion.test.tsx` mock only `lib/hooks/reviews` and provide no `QueryClientProvider`, so a second hook module crashes 16 tests with `No QueryClient set` while `tsc --noEmit` stays clean. Evidence: measured this run at `FindingsPanel.tsx:59` with `useCreateEvalCase`.
- Candidate for `client/INSIGHTS.md`: *`MonoLink` renders a `<button>` when it has no `href`*, so `getAllByRole("button")` on a `FindingCard` mounted without `repoFullName`/`headSha` counts one more than the action row. Evidence: `src/vendor/ui/primitives/MonoLink.tsx:43`; it cost a 6-vs-5 red run here.
- `specs/eval-pipeline.md` AC-50/AC-51 are satisfied at the card level only; AC-52 and AC-53 are not reachable until the panel is wired. Not edited — the spec is not mine.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Both are the next steps and neither is mine.
