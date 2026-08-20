# Implementation report — SPEC-03 PR Brief / T5

**Status: complete.**

Reported as of `34cb66e`; the run's actual base is `06d7488` (same slip as the T3 report).
Worktree dirty from waves 1–3 and the concurrent client task; this task's own contribution is
1 file changed, 2 added, nothing committed.

## Coverage

- INSIGHTS server: 55 entries, 6 relevant (2026-08-14 — `import type` does not exempt a module from `no-cross-module-internals`, 22 → 24 measured on `modules/blast/`; 2026-08-11 — ranking a derived list by size inverts the feature whose thesis is that size is not importance, i.e. order before cap; 2026-08-11 — `LOCK_FILE_NAMES`/`ROLE_ORDER` and why the lock-file check sits above the table; 2026-08-19 — `grep` without `-a` silently scans nothing on two files under `src/modules/`; 2026-08-10 — no gate typechecks `server/test/`, so `tsc -p tsconfig.eslint.json` is the only thing that sees a test's type error; 2026-08-02 — `pnpm <script>` can die before the script runs, use `./node_modules/.bin/`). INSIGHTS client: not read — no client file is in T5's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | `server/src/modules/brief/file-roles.ts`, `server/src/platform/container.ts` |
| `typescript-expert` | preloaded | all three changed files |

Matches the plan's routing table for T5 (`onion-architecture`, `typescript-expert`): yes. No other row of the routing table matched — the diff adds no route, no zod schema, no db/schema file, no input handling and no client file. `.dependency-cruiser.cjs`, `layer-map.md`'s ring table and `enforcement.md` were read as files rather than loaded as skills.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/brief/file-roles.ts` | T5 | yes | new. The `FileRoleClassifier` port (a bare call signature, `SmartDiffRole` imported from `@devdigest/shared`), a module-local `ROLE_ORDER`, `orderChangedFilesByRole(files, classify)` (classifies once per file, `pr_files` order preserved within each role), `capFileList(ordered, cap)` → `{ kept, omitted }`. Imports one type from the ports ring and nothing else |
| `server/src/platform/container.ts` | T5 | yes | one arrow property `readonly fileRole = (path: string): SmartDiffRole => classifyPath(path);` plus its two imports (`SmartDiffRole` added to the existing `import type` block, `classifyPath` from the smart-diff module). +20 lines, nothing else moved |
| `server/test/brief-file-roles.test.ts` | T5 | yes | new, hermetic, no `.it.`. 10 tests: AC-60's own observable, within-role order, the partition (no file lost, row identity carried), the container's arrow binding, EC-35 asserted as a no-op, AC-17's 400 → 200 + remainder 200, and the order-before-cap inversion |

`MAX_PROMPT_PATHS` is **not** defined here: `capFileList` takes the cap as a parameter, because `server/src/modules/brief/constants.ts` belongs to T9 and is forbidden to me. The plan's `capFileList(ordered, MAX_PROMPT_PATHS)` reads as the call site T11 will write.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R8 — role ordering `core` → `wiring` → `boilerplate`, `pr_files` order preserved within each role, capped at 200 only afterwards with the omitted count reported | T5 | yes — the ordering and the cap are two functions and the test asserts the inverted pipeline drops the source file; the cap value itself arrives from T9's constant at T11's call site |
| AC-60's observable (`pnpm-lock.yaml`, `src/server.ts`, `src/api/rate-limit.ts` → two source files first, lock file last) | T5 | yes — `test/brief-file-roles.test.ts`, first test |
| AC-17 (400 files → 200 kept, remainder 200) | T5 | yes |
| EC-35 (every path unrecognised → all `core`, ordering a no-op, cap in `pr_files` order) | T5 | yes — asserted, not corrected |
| `server/src/modules/smart-diff/**` untouched | T5 | yes — `git status --short` shows no file under it; the classifier is named only by `container.ts` |

## Deviations from the plan

- **`orderChangedFilesByRole` and `capFileList` are generic** over `<T extends { readonly path: string }>` rather than taking a declared row shape. The plan does not fix the element type, and T11 must carry `additions`/`deletions` through the ordering (AC-2 names them per file); a generic passes the caller's own row through by identity and keeps this file reading only `path`. Internal to the module, no boundary affected.
- **`ROLE_ORDER` is a module-private constant in `file-roles.ts`** rather than in a `constants.ts`. `modules/brief/constants.ts` is T9's and forbidden to me; the value is also not one of the spec's figures. Its doc-comment states that it must cover every member of `SmartDiffRole`, and the partition test is what catches it if a role is ever added — mutation-verified below.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — 0 errors |
| server | typecheck incl. `test/` | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | fail — 16 errors, all `pre-existing`: `prompt-callers` ×7, `repo-intel-facade-degraded` ×3, `skills.it` ×3, `adapters`, `agents-versions.it`, `conventions.it`. Identical count and files to the 16 recorded in `server/INSIGHTS.md` 2026-08-10; **none** in my three files. Not touched |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/modules/brief/file-roles.ts" "src/platform/container.ts" "test/brief-file-roles.test.ts"` | pass — rc=0, no output |
| server | onion (`depcruise`) | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings). 223 modules, 746 dependencies cruised.` Baseline before the first edit on this tree: same line at 222 modules / 744 dependencies. Exactly the plan's expected line |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 50 files, 628 passed. Baseline before the first edit: 49 files, 618 passed, 0 failures. The 10 new tests are this task's; no pre-existing failure existed to inherit |
| server | `DDG-WIRE-002` (ESM `.js`) | the `gate.md` grep | pass — 0 lines |
| server | `DDG-WIRE-001` (static registration) | the `gate.md` loop | pass — 0 `UNREGISTERED:` lines. `src/modules/brief/` has no `routes.ts`, so the loop skips it, which the plan states is correct at this point |
| server | T5 sibling-import grep | `grep -arnE "from '\.\./[a-z][a-z0-9-]*/" --include='*.ts' src/modules/brief/` | pass — 0 lines (rc=1, no match). Prose in both new files names the classifier as `modules/smart-diff/classify.ts`, with no `from '` and no `../` |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised by the dispatch |
| client | — | — | gate did not run — no client file was touched; `client/` is the concurrent implementer's this wave |

Two mutation checks, because two assertions in this file exist only to catch a silent inversion:

- Removing `'wiring'` from `ROLE_ORDER` turned 3 of the 10 tests red (including the partition test). Restored; `diff -q` against the pre-mutation copy reports identical, and the file re-runs 10/10 green.
- The order-before-cap test asserts the inverted pipeline's output directly (`capFileList` then `orderChangedFilesByRole` on the same input does **not** contain `src/api/rate-limit.ts`), so it cannot pass under a swapped implementation. Both lists are length 2, which is why a length assertion is not used.

## Not done

- `absent` — `MAX_PROMPT_PATHS` and any consumer of these two functions. `constants.ts`, `types.ts`, `assemble.ts` belong to T9/T11; `src/modules/brief/` currently holds exactly one file.
- `absent` — `ContainerOverrides` gained no `fileRole` field. The plan says one arrow property and "nothing else in the file moves"; the classification is pure, so there is nothing to stub.
- `not checked` — the integration suite, the e2e flows, and anything requiring Docker or a running stack.
- `not checked` — the client half of wave 4 (T6) and the client gates.

## For the parent

- `server/src/platform/container.ts` is now dirty from T5 and T13 will be its second editor in wave 9, as the plan's `## Contracts & wiring` states. This edit is confined to two import lines and one property immediately after `featureModel`; nothing else in the file moved.
- Candidate for `server/INSIGHTS.md`: the `depcruise` module count is a cheaper signal than the warning count for "did this file get cruised at all" — 222 → 223 modules with the warning line unchanged is what distinguishes "the new file has no bad edge" from "the new file was never resolved". Evidence: the two `depcruise` runs above over `server/src/modules/brief/file-roles.ts`.
- `plan-verifier` has not been run and is not mine. `test-writer` still owns `server/test/brief.it.test.ts` (Docker) and `client/…/PrDetailView/PrDetailView.test.tsx`.
- No spec file was read for editing and none was edited; `specs/pr-brief.md` findings F1–F3 recorded in the plan are unchanged by this task.

---

## Parent's notes on this report

**This is the task the plan singled out as the one an implementer gets wrong while every gate
stays green, and it came back with the boundary intact.** No file under
`server/src/modules/smart-diff/` moved, the sibling-import grep is empty, and `depcruise` reads
the plan's expected line exactly. The port is a bare call signature in the consumer, the
composition root holds the only reference to `classifyPath`, and the module imports one type
from the ports ring and nothing else.

**Two mutation checks, unprompted, and both were the right ones.** The dispatch asked for
neither. Removing a member from `ROLE_ORDER` turned three tests red, which is what makes the
partition test load-bearing rather than decorative; and the order-before-cap test asserts the
inverted pipeline's *output* rather than a length, so it cannot pass under a swapped
implementation. That is the difference between a test that documents behaviour and one that
would catch the regression the plan was written to prevent.

**The `depcruise` module-count observation is a genuinely new finding and is held for Phase 6.**
Every task in this run checks the warning line and calls it a pass. But an unresolved file
produces the *same* warning line as a clean one — 22 warnings either way — so the count alone
cannot distinguish "no bad edge" from "never cruised". The module count (222 → 223) can. Nothing
in `server/INSIGHTS.md`, `CLAUDE.md` or the `onion-architecture` skill records that today.

**Both deviations are inside the module and forced by the wave split** — `ROLE_ORDER` and the
absent `MAX_PROMPT_PATHS` are both consequences of `constants.ts` belonging to T9. Taking the cap
as a parameter is the better shape anyway: it keeps this file free of the spec's figures and puts
the constant at T11's call site, which is where the budget reasoning lives.
