# Stage 3 — wave 1 — T1: the eight new contract types, in both hand-synced copies

**Status: complete.**

As of `7bc2916` (`L05-spec-driven-development`); 2 files changed, 2 added, nothing committed. The worktree also carries the two untracked files the plan already records (`HOME-TASK05.md`, `PROMPT.md`); neither was touched.

## Coverage

- INSIGHTS server: 51 entries, 4 relevant (2026-08-02 / 2026-08-04 — `pnpm <script>` dies before the script runs, and zsh's `PIPESTATUS` / word-splitting traps, so every binary below was run from `./node_modules/.bin/` with paths listed literally; 2026-08-19 — a `.nullish()` contract field is `string | null | undefined` because a jsonb column read back by a cast arrives with keys *absent*, which is why every optional field in the new file is `.nullable()` and never `.optional()`/`.nullish()`; 2026-08-13 — a wrong sentence in a frozen `vendor/shared` doc-comment cannot be fixed later and is the most expensive line in a contract, so the new file's comments state what the shapes actually promise; 2026-08-14 — a `vendor/shared` file is read by both packages, so nothing here imports a module type).
- INSIGHTS client: 29 entries, 2 relevant (2026-08-03 — client imports of `@devdigest/shared` must stay `import type` or `next dev`/`next build` 500s on every route, so the new file adds no runtime constant a client screen would need to import as a value; 2026-08-06 — `FEATURE_MODELS` lives in three places that must change together, which is why the `onboarding` registry entry was left alone).
- INSIGHTS reviewer-core: 1 entry, 1 relevant (2026-08-07 — Anthropic-via-OpenRouter rejects numeric range keywords in a JSON schema; no `.min()`/`.max()` appears anywhere in the new file, and the file says so).

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `zod` | preloaded (+ `references/{schema-use-enums,type-use-z-infer,type-export-schemas-and-types,object-optional-vs-nullable,compose-shared-schemas}.md` read) | both `contracts/onboarding.ts` |
| `typescript-expert` | preloaded | both `contracts/onboarding.ts`, both `index.ts` |

Matches the plan's routing table for T1: yes. No other row of the repo-wide routing table matches these files — they contain no route, no query, no component, no input handling and no I/O; `onion-architecture` classifies them as the ports ring, whose only permitted dependency is `zod` and other shared types, which is what the file does (`zod` + `./knowledge.js`).

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/vendor/shared/contracts/onboarding.ts` | T1 | yes | new file — the eight contract schemas with `z.infer` types beside each, in the spec's `## Contracts` order |
| `server/src/vendor/shared/index.ts` | T1 | yes | one `export * from './contracts/onboarding.js';` line and one header doc-comment entry, matching the `contracts/project-context` entry |
| `client/src/vendor/shared/contracts/onboarding.ts` | T1 | yes | byte-identical copy of the server file (`cp`, not retyped) |
| `client/src/vendor/shared/index.ts` | T1 | yes | byte-identical copy of the server barrel |

The eight symbols, and the two shape decisions the plan left to the file:

- `OnboardingSectionKind`, `OnboardingStatus`, `OnboardingReason`, `OnboardingCommand` (`command`, `file`, `order`), `OnboardingPathNote` (`path`, `reason`), `OnboardingTask` (`title`, `path`, `complexity`), `OnboardingTourSection` (`kind`, `title`, `body`, `diagram` nullable, `links`, `commands`, `paths`, `tasks`), `OnboardingTour` (`sections`, `status`, `reason`, `generation_state`, `generated_at`, `indexed_sha`, `stale`, `files_indexed`, `files_skipped`, `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd`).
- `OnboardingLink` is imported from `./knowledge.js` and reused, not redeclared or re-exported — the `contracts/blast.ts` precedent. `Onboarding`, `OnboardingSection`, `OnboardingLink`, `FeatureModelId`, `FEATURE_MODELS` and `SettingsKnown` are byte-unchanged (`git diff --stat` on `knowledge.ts` and `platform.ts` is empty in **both** copies).
- Field names are snake_case; no numeric `.min()`/`.max()` anywhere; every optional value is `.nullable()`, never `.optional()` or `.nullish()`.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-1 (enabling) — the five kinds in fixed order | T1 | yes — `OnboardingSectionKind` is a `z.enum` in `architecture, critical_paths, run_locally, reading_path, first_tasks` order, documented as the screen's order rather than the model's |
| AC-2 (enabling) — `never_generated` is expressible | T1 | yes — `generation_state: 'never_generated' \| 'running' \| 'ready'`, with `sections` able to be empty |
| AC-12 (enabling) — model, round-trips, tokens, cost | T1 | yes — `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd`, all nullable |
| AC-19 (enabling) — one vocabulary with blast | T1 | yes — `OnboardingStatus` = `BlastStatus`'s three; `OnboardingReason`'s first five = `BlastReason` minus `no_changed_files`, spelled identically, with the reason written in the file |
| AC-21 (enabling) — a command names its file | T1 | yes — `OnboardingCommand.file` is required, not nullable |
| AC-25 (enabling) — the indexed SHA is recorded | T1 | yes — `indexed_sha`, nullable |
| AC-26 (enabling) — staleness is reportable | T1 | yes — `stale: z.boolean()`, documented as computed on read with nothing regenerated |
| AC-30 (enabling) — caps discard whole items | T1 | yes — the arrays carry no bound, so a cap is enforced where the tour is assembled (T8); the file states this and why a range keyword is not used |
| AC-40 (enabling) — files-generated-from and age | T1 | yes — `files_indexed`, `files_skipped`, `generated_at`, documented as this tour's own figures and never the current index state's |

## Deviations from the plan

- **The generation state is an inline `z.enum` on `OnboardingTour`, not a ninth exported schema.** The plan lists eight types and its Acceptance asserts "all eight types exist", so exporting an `OnboardingGenerationState` would have added a symbol the plan does not name. Its consumers need no import: T7 branches on the literal `"running"` and T8 can write `OnboardingTour['generation_state']`. Same values, same order.
- **Field names inside `OnboardingTourSection` for the per-kind arrays are `commands` / `paths` / `tasks`.** The plan names the item *types* but not the array fields; these three are the only names T9's description (`run_locally`'s commands, `critical_paths` and `reading_path` rows as `OnboardingPathNote`s, `first_tasks`) reads cleanly against, and one `paths` array is shared by the two kinds that render the same row shape.
- **`OnboardingCommand.order` and `OnboardingPathNote.reason`** — the plan says "its ordinal" and "a one-line reason". `order` follows `run_skills.order` in this repo; `reason` is documented in the file as prose for that row, explicitly unrelated to the `OnboardingReason` enum.

Nothing existing was reshaped, so nothing here reached the `Status: blocked` condition the plan's Red flags describe.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| both | contract copies identical | `diff -u server/src/vendor/shared/contracts/onboarding.ts client/src/vendor/shared/contracts/onboarding.ts` | pass — 0 lines |
| both | barrels identical | `diff -u server/src/vendor/shared/index.ts client/src/vendor/shared/index.ts` | pass — 0 lines |
| server | frozen symbols untouched | `git diff --stat -- src/vendor/shared/contracts/knowledge.ts src/vendor/shared/contracts/platform.ts` | pass — 0 lines (also run on the client copy: 0 lines) |
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass |
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass |
| client | unit | `./node_modules/.bin/vitest run` | pass — 43 files, 353 tests, 0 failures |
| server | ESM extensions (`DDG-WIRE-002`) | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 44 files, 563 tests, 0 failures |
| server | lint | `./node_modules/.bin/eslint "src/vendor/shared/contracts/onboarding.ts" "src/vendor/shared/index.ts"` | pass — 0 problems |
| client | lint | `./node_modules/.bin/eslint "src/vendor/shared/contracts/onboarding.ts" "src/vendor/shared/index.ts"` | pass — 0 errors; 2 warnings, both `File ignored because of a matching ignore pattern` (the client's eslint config excludes `src/vendor/**`) |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — 0 errors, 22 warnings, none attributable to the changed files (22 is the tree's pre-existing baseline; `server/INSIGHTS.md`, 2026-08-10) |
| server | static module registration (`DDG-WIRE-001`) | — | gate did not run — this diff adds no module under `src/modules/` |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, and the plan forbids it on this run |
| reviewer-core / e2e / mcp-server | — | — | gate did not run — no file in those packages was touched |

## Not done

- `absent` — T2 … T10. They are waves 2–6 and were not in this dispatch.
- `not checked` — whether the eight shapes are the ones the server module and the screen actually need in practice. Nothing consumes them yet; the first real consumers are T6/T8 and T7/T9/T10.
- `not checked` — the migration. T2 owns the schema columns and `## Applying the migration` is a post-wave step no implementer performs.

## For the parent

- `plan-verifier` has not been run, and the plan's own fourth recommendation asks whether to dispatch it against **T1 alone** before waves 2–6 start. That is a decision for the parent: this is the one task whose mistake propagates to every consumer in both packages, and every later Done-condition measures against it.
- Nothing was committed or pushed and no PR was opened; the work is uncommitted in the worktree.
- No candidate for `server/INSIGHTS.md` or `client/INSIGHTS.md` from this task — nothing non-obvious came up that those files or the plan do not already record.

Files: `server/src/vendor/shared/contracts/onboarding.ts`, `client/src/vendor/shared/contracts/onboarding.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/index.ts`.

---

**Parent's independent re-run of T1's Done-conditions:** both `diff -u` checks 0 lines; frozen symbols 0 lines in both copies; ESM-extension grep 0 lines; server and client `tsc --noEmit` both clean.
