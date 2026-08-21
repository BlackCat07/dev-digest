# Stage 3 — wave 3 — T4: widen the two existing read seams

**Status: complete.**

As of `a64a1b0` (`L05-spec-driven-development`); 3 files changed, 0 added, nothing committed. Waves 1–2's uncommitted work (`vendor/shared/contracts/onboarding.ts` in both copies, `db/schema/context.ts`, `0018_wide_morbius.sql`) and T5's concurrent client work were not touched.

## Coverage

- INSIGHTS server: 51 entries, 6 relevant (2026-08-14 — `import type` does **not** exempt a module from `no-cross-module-internals`, measured 22 → 24 warnings, which is why `getFileFacts` goes on the facade; 2026-08-10 — `modules-no-raw-sdk` does not list `node:fs`, and the consumer-declares-the-port / adapter-satisfies-it-structurally arrangement that produced `confined-doc.ts`; 2026-08-19 — a walk that skips every symlink passes the escape test for the wrong reason, so `resolve` is what actually decides; 2026-08-19 — `isUnderRoot` matches a root at any depth, and its test pins both halves; 2026-08-02 / 2026-08-04 — never `pnpm <script>`, zsh does not word-split, `${PIPESTATUS[0]}` is empty; 2026-08-10 — no `test/` file is typechecked by any gate).
- INSIGHTS client: not read — no client file is in T4's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded (`enforcement.md` read as a file) | `server/src/modules/repo-intel/{types,service}.ts`, `server/src/adapters/git/confined-doc.ts` |
| `security` | preloaded | `server/src/adapters/git/confined-doc.ts` |
| `typescript-expert` | preloaded | all three changed `*.ts` |

Matches the plan's T4 row exactly; no other routing row matched (no route, no zod schema, no `db/schema`, no client file).

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/repo-intel/types.ts` | T4 | yes | new `FileFactsRow` (`filePath`/`endpoints`/`crons`, mirroring the read model) beside `FileRankRow`; `getFileFacts(repoId, paths)` declared in the `// --- Reads ---` block with a doc-comment naming `modules/onboarding` as the consumer and the 2026-08-14 `import type` finding as the reason it lives on the facade |
| `server/src/modules/repo-intel/service.ts` | T4 | yes | `getFileFacts` implemented as a thin delegate to `this.repo.getFileFacts`, following `getFileRank` line for line — `[]` when `repoIntelEnabled` is false, `[]` on empty `paths`; `FileFactsRow` added to the existing type-only import list |
| `server/src/adapters/git/confined-doc.ts` | T4 | yes | optional `match?: (name, rel) => boolean` on `RepoDocWalkOptions`, threaded through `CollectArgs` to `isCandidate`, which uses it when supplied and otherwise applies the current rule verbatim; the file doc-comment's "everything the walk is bounded by arrives as a PARAMETER" paragraph extended to cover the predicate; `list`'s doc-comment notes that a supplied predicate replaces both default rules. `resolve` untouched — not moved, not reordered, not extracted |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-20 (enabling — declared commands can be found at all) | T4 | yes — a `list` whose `match` accepts `package.json` now returns them; the criterion itself is T6's |
| AC-21 (enabling) | T4 | yes — same seam |
| N11 endpoint facts on the facade | T4 | yes — `container.repoIntel.getFileFacts` exists, `[]` on empty `paths`, `[]` with the flag off |
| `list` with no `match` is behaviour-identical | T4 | yes — `test/project-context-walk.test.ts` green and unmodified (`git diff --stat -- test/` is empty) |
| Every candidate still resolved through `resolve` | T4 | yes — verified behaviourally, below |
| `depcruise` reports no new errors or warnings | T4 | yes — output byte-identical to the pre-edit baseline |

Behavioural check, run outside the repo against a scratch clone with `./node_modules/.bin/tsx` (no repo file created): with `match: (name) => name === 'package.json'` the walk returned `package.json`, `pkg/package.json` and `inner/package.json` (an **in-clone** symlink — kept), while `node_modules/x/package.json` was pruned by `excludedDirs` and `esc/package.json` (a symlink **escaping** the clone) was omitted by `resolve`. The confinement pair holds under a caller-supplied predicate.

## Deviations from the plan

- **T4.1 — the facade's return type is a new `FileFactsRow` in `types.ts`, not `IndexerFileFactsRow` imported from `repository.ts`.** The field names and shape are exactly the plan's (`filePath`, `endpoints`, `crons`) and the delegate returns the repository's rows with no mapping, so the two are structurally identical. Importing the repository's type into `types.ts` would have created a cycle — `repository.ts:20` already imports `./types.js` — and `no-circular` is one of the `warn` rules the Done-condition forbids adding to. This is the same shape `types.ts`'s own header prescribes ("facade-level rows … mirror the read model").

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0 |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — rc=0, `22 dependency violations (0 errors, 22 warnings). 212 modules, 702 dependencies cruised.` — `diff` against the pre-edit baseline is empty, so none of the 22 is T4's |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — rc=0, 44 files / 563 tests passed; identical to the baseline captured before the first edit (44 / 563) |
| server | test/ untouched | `git diff --stat -- test/` | pass — 0 lines |
| server | lint | `./node_modules/.bin/eslint src/modules/repo-intel/types.ts src/modules/repo-intel/service.ts src/adapters/git/confined-doc.ts` | pass — rc=0, no output |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not requested |
| client | — | — | gate did not run — no client file was touched (T5 owns that half concurrently) |

`DDG-WIRE-001` was not run: T4 adds no module and no `routes.ts`, so it has nothing to report on.

## Not done

- `absent` — no test file was written or moved. Every T4-adjacent row in the plan's `## Tests` is owned by `test-writer` (`server/test/onboarding-commands.test.ts` covers the `match` seam and the confinement pair).
- `not checked` — the client half, the integration suite, `e2e`, and `db:migrate`. None is in this dispatch.
- `not checked` — whether `container.repoIntel` is reachable end to end from a real request; that needs the running stack.

## For the parent

- `plan-verifier` has not been run — it is the next step and it is not T4's.
- Nothing here contradicts an acceptance criterion of `specs/onboarding-generator.md`, so no spec edit is implied.
- Candidate for `server/INSIGHTS.md`: `repo-intel/repository.ts` imports `./types.js`, so a facade row type that reuses an `Indexer*Row` by import creates a `no-circular` warning the moment it is added — the facade declares its own mirror row instead, which is what `types.ts`'s header already asks for. Evidence: `src/modules/repo-intel/types.ts` (`FileFactsRow`), `src/modules/repo-intel/repository.ts:20`.

Relevant paths: `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/service.ts`, `server/src/adapters/git/confined-doc.ts`.

---

**Parent's independent re-run of T4's Done-conditions:** `git diff --stat -- server/test/` 0 lines; `depcruise` 0 errors / 22 warnings, unchanged from the baseline.
