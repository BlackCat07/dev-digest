# Implementation report — SPEC-03 PR Brief / T1

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 2 files changed, 2 added, nothing committed. Work left uncommitted in the worktree.

## Coverage

- **INSIGHTS server: read in full — 41 entries, 6 relevant** (2026-08-02 — a run trace is read back by a cast, not a parse, so a field added later arrives *absent*; 2026-08-19 — a `.nullish()` contract field plus `!` covers only half the gap, narrow with `== null`; 2026-08-11 — `head_sha` is written by the pull-request *list* route while `body`/`pr_files` are written only by the *detail* route, measured at 15 of 21 rows; 2026-08-10 — no gate typechecks `server/test/`, 16 pre-existing errors across 6 files; 2026-08-19 — `grep` needs `-a` on `src/modules/`; 2026-08-02 — never `pnpm <script>`, run `./node_modules/.bin/<tool>`).
- **INSIGHTS client: read in full — 26 entries, 3 relevant** (2026-08-03 + its addendum — client imports of `@devdigest/shared` must stay `import type`, a runtime value import 500s every route; 2026-08-11 — a mutation omitting an optional flag is a silently successful no-op, which is why `force` is documented on the payload; 2026-08-19 — `eslint` on a path under `src/vendor/` exits 0 having linted nothing, which is why the client lint row below is not a pass).
- **INSIGHTS reviewer-core: 1 relevant entry read via the plan's quotation** (2026-08-07 — Anthropic-via-OpenRouter rejects a `json_schema` carrying numeric range keywords). `reviewer-core` is out of scope for T1 and no file there was opened for writing.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded (+ `layer-map.md` ports ring read) | both `vendor/shared/**` copies — the ports ring imports `zod` and other shared contracts and nothing concrete |
| `zod` | preloaded (+ `references/schema-use-enums.md`, `type-use-z-infer.md`, `type-export-schemas-and-types.md`, `object-optional-vs-nullable.md`, `compose-shared-schemas.md`, `schema-avoid-optional-abuse.md` read) | `contracts/pr-brief.ts` × 2 |
| `typescript-expert` | preloaded | `contracts/pr-brief.ts` × 2, `index.ts` × 2 |
| `security` | preloaded | `contracts/pr-brief.ts` × 2 — no input is handled here; the file records that `Risk.file_refs` and `ReviewFocusItem.path` are grounded before storage and that the model's own output is untrusted |
| `frontend-ui-architecture` | preloaded | `client/src/vendor/shared/**` |

Matches the plan's routing table for T1 (`zod`, `typescript-expert`, `security`): yes, plus `onion-architecture` and `frontend-ui-architecture`, whose rows match the changed files.

One skill conflict, resolved and recorded: `frontend-ui-architecture`'s placement table says a backend-shared contract lives in "the single shared-contract module — no second copy". This repo deliberately keeps two hand-synced copies (`DDG-DNT-001`, root `CLAUDE.md`). The repo invariant wins; both copies were written and verified byte-identical.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/vendor/shared/contracts/pr-brief.ts` | T1 | yes | new file, 358 lines: the 11 new symbols, `Risk`/`RiskSeverity` imported from `./brief.js` |
| `client/src/vendor/shared/contracts/pr-brief.ts` | T1 | yes | byte-identical copy of the above |
| `server/src/vendor/shared/index.ts` | T1 | yes | one `export * from './contracts/pr-brief.js';` after `onboarding`, plus one header paragraph |
| `client/src/vendor/shared/index.ts` | T1 | yes | byte-identical copy of the above |

`contracts/brief.ts` was not opened for writing in either copy; `git diff --stat` over both prints nothing. No lockfile, no migration, no `INSIGHTS.md`, no spec was touched.

Symbols declared: `RiskLevel`, `BriefStatus`, `BriefReason` (11 values), `BriefSourceKind` (8), `BriefSourceStatus` (3), `BriefSource`, `ReviewFocusItem`, `BriefDiffStats`, `BriefGenerationState`, `PrRiskBrief` (22 fields), `GenerateBriefPayload` — each as `export const` + `export type` of the same name.

## Acceptance

T1's own Acceptance clause:

| Requirement | Met |
|---|---|
| the two `contracts/pr-brief.ts` files are byte-identical | yes — `diff -q` prints nothing |
| the two `index.ts` files remain byte-identical | yes — `diff -q` prints nothing |
| `contracts/brief.ts` unchanged in both copies | yes — `git diff --stat` prints nothing |
| no numeric range keyword (`.min()`/`.max()`/`.gt()`/`.lt()`) in the new file | yes — `grep -anE '\.(min\|max\|gt\|lt)\('` returns 0 lines |
| the 11 symbols present by name | yes — the plan's loop returns 0 lines |
| the 14 fields present | yes — the plan's loop returns 0 lines, and a stricter re-run anchored on `^  <field>: ` (a real object key, not a doc-comment substring) also returns 0 lines |

The requirements T1 satisfies. T1 is the contract only — it carries what each requirement needs; the behaviour is later tasks'.

| Requirement | Met |
|---|---|
| R1 (cache read, key agreement reported) | yes — `cache_key`, `stale` |
| R2 (nine-value digest) | yes — `cache_key`, documented as a digest and explicitly not the head SHA alone |
| R3 (rebuild / reuse / force) | yes — `GenerateBriefPayload.force` |
| R10 (grounded risk file refs) | yes — `risks: z.array(Risk)`, reused verbatim |
| R11 (grounded review focus) | yes — `review_focus: z.array(ReviewFocusItem)` |
| R12 (derived level, restated title) | yes — `risk_level: RiskLevel.nullable()`, `BriefReason.restates_title` |
| R13 (three degradation reasons + precondition) | yes — `model_failed`, `model_timeout`, `model_invalid`, `no_changed_files`, `inputs_too_large` |
| R14 (deterministic facts on a model-less brief) | yes — `diff_stats` |
| R15 (partial on missing intent / non-ok blast) | yes — `no_intent` plus `BlastReason`'s five values carried through verbatim |
| R16 (source entries + provenance) | yes — `sources`, `provider`, `model`, `attempts`, `tokens_in`, `tokens_out`, `cost_usd`, `generated_at`, `head_sha`, `cache_key` |
| R22 (client render states) | yes — `generation_state`, `status`, `reason`, `stale`, `error` and the token/cost fields the card's state ladder branches on |

## Deviations from the plan

- **`RiskLevel` is built from `RiskSeverity.options`, not spelled out again.** The plan writes `RiskLevel` (`high|medium|low`) and the dispatch says `RiskSeverity` is imported and reused verbatim and must not be redeclared. `export const RiskLevel = z.enum(RiskSeverity.options)` satisfies both — a distinct symbol whose three values cannot drift from the severities the level is derived from. Verified this does not widen the type: a scratch typecheck with two `@ts-expect-error` assertions confirms `RiskLevel` is `'high' | 'medium' | 'low'` and `PrRiskBrief['risk_level']` is that union or `null`, not `string`.
- **`head_sha`, `cache_key` and `attempts` are `.nullable()`.** The plan lists which fields are nullable but says nothing about these three. `generation_state: 'never_generated'` is a contract-mandated state answered as `200` with an empty document, and it can supply none of them. Precedent: `PrIntent.head_sha`, `OnboardingTour.indexed_sha`, `OnboardingTour.attempts`. Flagged rather than silently chosen because nullability is normally a blocking difference — here the plan states no value to differ from.
- **`BriefDiffStats`' keys are `files_changed`, `files_listed`, `additions`, `deletions`.** The plan and the spec name the four values in prose ("files changed, files listed in the prompt, additions, deletions") and no keys. `files_changed - files_listed` is AC-17's omitted count, documented in the file.
- **Every nullable field is `.nullable()`, never `.optional()` or `.nullish()`.** Stated as a rule in the file's header for the EC-24 reason. This is the plan's intent, not a change to it — recorded because it is the one thing a later task could accidentally undo.

## Blocked

None. Nothing in the spec's `## Contracts` needed a change to `PrBrief`, `Risk`, `RiskSeverity` or any other existing symbol.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — 0 errors (baseline before the first edit: 0) |
| server | typecheck (incl. `test/`) | `CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | fail — 16 errors, all `pre-existing`: `prompt-callers` ×7, `repo-intel-facade-degraded` ×3, `skills.it` ×3, `adapters`, `agents-versions.it`, `conventions.it` — the exact file set and counts `server/INSIGHTS.md` (2026-08-10) records. None names `pr-brief`; nothing was touched |
| server | lint | `CI=true ./node_modules/.bin/eslint "src/vendor/shared/contracts/pr-brief.ts" "src/vendor/shared/index.ts"` | pass — server's `eslint.config.js` lints `src/vendor/**` (it only relaxes `no-explicit-any` there), so this is real coverage |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings)`, exactly the plan's baseline |
| server | unit | `CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 49 files, 618 tests, 0 failures |
| server | `DDG-WIRE-002` | `grep -arnE "from '(\.{1,2}/[^']*)'" --include='*.ts' src \| grep -v "\.js'" \| grep -v '^src/db/schema'` | pass — 0 lines (verbatim from `gate.md`, `-a` kept) |
| server | `DDG-WIRE-001` | the `gate.md` loop over `src/modules/*/` against `src/modules/index.ts` | pass — 0 `UNREGISTERED:` lines. My diff adds no module; run only because it is free |
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — 0 errors (baseline before the first edit: 0) |
| client | lint | — | **gate did not run** — `client/eslint.config.js` ignores `src/vendor/**`, so an `eslint` call on either changed client path exits 0 having linted nothing (`client/INSIGHTS.md`, 2026-08-19). Reporting it as a pass would be a false green. The two client files are byte-identical to the server files that *were* linted, which is the check that actually holds |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 47 files, 388 tests, 0 failures |
| server/client | contract sync | `diff -q` on `contracts/pr-brief.ts` and on `index.ts`; `git diff --stat` on both `contracts/brief.ts` | pass — both pairs identical, `brief.ts` untouched in both copies |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised by the dispatch |
| e2e | flows | `../scripts/e2e.sh` | gate did not run — not authorised, and no browser flow is in this plan |

## Not done

- `absent` — T2 … T15. This dispatch was wave 1 of 11 and named T1 only.
- `absent` — no test file. T1 has no row in the plan's `## Tests`, which is correct: a contract file has no behaviour to test. Nothing was written under `server/test/` or `client/src/**/*.test.tsx`.
- `not checked` — whether the client renders anything from these symbols. No consumer exists yet; the first is T8.
- `not checked` — the DB-backed acceptance pass and the browser flows. Both need Docker or a running stack.
- Untouched and pre-existing in the worktree, none of them mine: `HOME-TASK05.md`, `PROMPT.md`, `.claude/.plans/pr-brief/run.md`.

## For the parent

- **The plan's T1 prose says "twelve new symbols" and then enumerates eleven.** The spec's `## Contracts` table also lists eleven, the Done-condition loop lists eleven (its comment reads "12 lines expected"), and the dispatch says eleven. I built eleven. Worth a one-word correction in `.claude/.plans/pr-brief/plan.md` before `plan-verifier` counts them, or that verifier will report a missing symbol that does not exist.
- **A note for T3, whose columns must line up with this file.** `PrRiskBrief.head_sha`, `cache_key` and `attempts` are nullable here (see `## Deviations`); T3 already specifies `headSha text`, `cacheKey text` and `attempts integer` as nullable, so the two agree — but T3's `state` enum is `['running','done']` while `BriefGenerationState` is `['never_generated','running','done']`, with `never_generated` deliberately being the absence of a row. That asymmetry is intentional in both documents and is documented in the contract; a later task should not "harmonise" it.
- **Candidate for `server/INSIGHTS.md`:** `client/eslint.config.js` ignores `src/vendor/**` while `server/eslint.config.js` lints it (relaxing only `no-explicit-any`). So a `vendor/shared` change is lint-covered on exactly one side of the pair, and a Done-condition that lints the client copy records a green gate over an unlinted file. The two-copy invariant is what saves it: linting the server copy of a byte-identical pair is the coverage. `client/INSIGHTS.md` (2026-08-19) records the client half of this; the asymmetry between the two configs is the part not yet written down. Evidence: `client/eslint.config.js:27`, `server/eslint.config.js:76`.
- **`specs/pr-brief.md` findings F1/F2/F3 from the plan stand unresolved** — the header/body `Status` contradiction, N5 citing AC-9 where it means AC-11, and AC-42's traceability row citing EC-34 where it means EC-17. I edited no spec. They belong to `spec-creator` or `doc-writer`.
- **Next step is not mine.** Wave 2 (T2) can start; `plan-verifier` comes before `test-writer`, `architecture-reviewer` and `/pr-self-review`, and the dispatch notes `test-writer` is not being run on this pass, so `server/test/brief.it.test.ts` and the new `PrDetailView.test.tsx` will stay unwritten unless the parent dispatches it later.

---

## Parent's notes on this report

**The F1/F2/F3 claim is stale, not wrong-headed.** All three were already corrected in
`specs/pr-brief.md` at `492c446`/`9f6824e`/the plan commit `06d7488` — before this dispatch
started. The implementer read the plan's `## Open questions & recommendations`, which records
them as *found*, and had no way to know they had since been fixed. No action.

**The "twelve symbols" count was a real defect in the plan and is fixed.** Corrected to
eleven in the prose, and the Done-condition's comment — which read "12 lines expected" over a
loop that echoes only `MISSING:` lines, i.e. whose passing case is zero lines — was corrected
to say so. A gate whose comment contradicts its own logic is exactly what the cross-model
review's three CRITICALs were about, so this one is fixed rather than merely noted.

**The `eslint` asymmetry is a good `INSIGHTS` candidate** and is held for Phase 6.
