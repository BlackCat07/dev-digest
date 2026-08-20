# Implementation report — SPEC-03 PR Brief / T9

**Status: complete.**

Reported as of `34cb66e`; the run's actual base is `06d7488`. Worktree carrying waves 1–5;
**3 files added, 0 modified, nothing committed.**

## Coverage

- INSIGHTS server: 55 entries, 9 relevant (2026-08-14 — `import type` does not exempt a cross-module edge, 22 → 24 warnings; 2026-08-19 — `grep` without `-a` scans nothing on two files under `src/modules/`; 2026-08-19 — a grep gate that passes on zero lines is failed by a doc-comment; 2026-08-02 / 2026-08-19 — a jsonb read back by cast arrives with keys **absent**, which shipped `$NaN`; 2026-08-06 — `StructuredRequest.timeoutMs` is ignored and `maxRetries` defaults to 2; 2026-08-06 — a `queued`/`running` state with no staleness window bricks the entity; 2026-08-11 — `GET /pulls/:id` is the only writer of `pull_requests.body` and `pr_files`; 2026-08-15 — `pr_files` is sparse on every real workspace; 2026-08-10 — `dependency-cruiser`'s `modules-no-raw-sdk` does not list Node's own filesystem module).
- INSIGHTS client: not read — T9 owns no `client/` path and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `onion-architecture` | preloaded | all three — ports declared by the consumer, `repository.ts` the only db-touching file |
| `drizzle-orm-patterns` | preloaded | `server/src/modules/brief/repository.ts` |
| `zod` | preloaded | `repository.ts` (`safeParse` on the jsonb read, `.pick()` off the contract) |
| `security` | preloaded | `types.ts` (`getPull` as the authorization check, the one-method GitHub surface), `repository.ts` |
| `typescript-expert` | preloaded | all three |
| `postgresql-table-design` | preloaded | `repository.ts` — read only; no schema change is T9's (T3 shipped `0019_misty_terrax.sql`) |

Matches the plan's routing table for T9: yes, plus `postgresql-table-design`, applied as a reading lens over T3's table rather than as an edit.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `server/src/modules/brief/types.ts` | T9 | yes | new — every port: `BriefStore` (with `claimRunning`), `BriefIntentReader`, `BriefBlastReader`, `BriefPriorPrsReader`, `BriefDocSetReader` (`listEffectiveDocs`), `BriefAgentLister`, `BriefDocReader`, `BriefGitHubIssueReader`, `FeatureModelResolver`, `BriefJobQueue`, `BriefLogger`, `BriefDeps`, `PrBriefs`, plus `BriefPull` / `BriefPrFile` / `StoredBrief` / `StoredBriefWrite`. Imports only `@devdigest/shared` and `./file-roles.js` (which it re-exports) |
| `server/src/modules/brief/constants.ts` | T9 | yes | new — the 22 figures the plan enumerates, plus four document-walk bounds (see Deviations) |
| `server/src/modules/brief/repository.ts` | T9 | yes | new — `BriefRepository implements BriefStore`; single-statement `claimRunning`, `safeParse` on `pr_brief.json` via `PrRiskBrief.pick(...)`, three enum columns validated on the way out |

No second `StoredBriefBody` was declared: `types.ts` names the body fields as `PrRiskBrief['what']`, `PrRiskBrief['why']`, … and `repository.ts` imports the real `StoredBriefBody` as a type from `db/schema` for the write value.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 — a read answers the stored brief with no model call and no write, and reports whether the keys agree | T9 | yes — no `BriefStore` read method writes; `get()` returns `cacheKey` and `getPull` supplies the current state the comparison needs. The comparison itself is T13's |
| R2 — the key's nine values | T9 | yes — all nine are reachable through the declared ports (head SHA / title / description / files from `BriefPull` + `getPrFiles`; intent status + `derived_at`; blast status + `indexed_sha`; the document set from `BriefDocSetReader` + `BriefDocReader.list`; `BRIEF_FORMAT_VERSION`) |
| R4 — a second generation is refused; 5 minutes marks one abandoned | T9 | yes — `claimRunning(prId, startedAt, staleBefore)` decides and writes in one statement, `BRIEF_STALE_AFTER_MS = 5 * 60_000` |
| R16 — one source entry per input, plus provider, model, round-trips, both token counts, cost, generation time, head SHA and cache key | T9 | yes — every field is on `StoredBriefWrite` and persisted by `save` |
| R17 — the pull request is resolved within the workspace before any other read, and before any clone path | T9 | yes — `getPull` is the only workspace-scoped method, every other read is by `pr_id`, and `getRepo` takes the `repoId` that lookup returned. The call ordering is T13's to keep |

`types.ts` names no sibling module and imports nothing from `src/db/` or `src/adapters/`; `repository.ts` is the only file under `modules/brief/` importing `drizzle-orm` or `src/db/`; no file under `modules/brief/` imports Node's filesystem module. All three are gated below.

## Deviations from the plan

- **`BriefStore` gained `getRepo(repoId): Promise<BriefRepoRef | undefined>`.** The plan's method list has no way to reach a repository's owner and name, and both `BriefDocReader.read/list` and `BriefGitHubIssueReader.getIssue` take a `{ owner, name }`. Modelled verbatim on `IntentStore.getRepo`, unscoped by workspace for the reason that file gives — the scope was already checked by `getPull`, whose row supplied the `repoId`.
- **`BriefPrFile` carries no `patch`.** AC-11 forbids a diff hunk body anywhere in the input, and the repository selects three columns, so nothing above it has a patch to leak. Worth knowing for T11: `test/brief-assemble.test.ts` can still prove the absence by handing in a row carrying an extra `patch` property — the port simply never returns one.
- **`constants.ts` carries four bounds the plan did not enumerate** — `EXCLUDED_DIR_NAMES`, `MAX_DIRECTORY_ENTRIES`, `MAX_LISTED_DOCS`, `MAX_DOCUMENT_BYTES`. `BriefDocReader.list` requires `RepoDocWalkOptions`, whose bounds are caller-owned because `src/adapters/**` may import nothing from `src/modules/**`; T11 needs them and its Forbidden list bars it from editing `constants.ts`. Values and rationale copied from `modules/project-context/constants.ts`, which walks the same tree. `roots` is deliberately **not** fixed — it is the directories the effective set's own paths live in.
- **The claim's predicate carries an `started_at IS NULL` term** in addition to the plan's `state <> 'running' OR started_at < :staleBefore`. A row marked `running` with no start time has no measurable age, so without that term it could never satisfy the window and would refuse every future generation forever — the exact brick the window exists to prevent.
- **`PrBriefs`, the module's public face, is declared in `types.ts`** rather than left to T13, following `OnboardingTours` next door, because T13's container binding is described as exposing "the service through its interface". Its method names mirror `OnboardingTours` exactly and a refusal travels as a thrown `ValidationError`, as onboarding's does — so T13 can implement it without reshaping anything. If T13 needs a different signature, `types.ts` is not in its Owned paths and that is a `Status: blocked`, not a quiet edit.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| server | typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | pass — 0 errors |
| server | onion | `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src` | pass — `x 22 dependency violations (0 errors, 22 warnings)`, baseline held (226 modules, was 223) |
| server | lint | `./node_modules/.bin/eslint "src/modules/brief/types.ts" "src/modules/brief/constants.ts" "src/modules/brief/repository.ts"` | pass — 0 problems |
| server | unit | `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'` | pass — 50 files, 631 passed (baseline 631, measured before the first edit) |
| server | test typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` | `pre-existing` — 16 errors across 6 test files, byte-for-byte the baseline; none in `modules/brief/` |
| server | sibling-module imports | `grep -arnE "from '\.\./[a-z][a-z0-9-]*/" --include='*.ts' src/modules/brief/` | pass — 0 lines |
| server | Node filesystem import | `grep -arnE "^import .*from 'node:" --include='*.ts' src/modules/brief/` | pass — 0 lines |
| server | db import in `types.ts` / `constants.ts` (the new check) | `grep -arnE "from 'drizzle-orm\|from '\.\./\.\./db/" --include='*.ts' src/modules/brief/types.ts src/modules/brief/constants.ts` | pass — 0 lines |
| server | `DDG-WIRE-002` ESM extensions | the `gate.md` grep | pass — 0 lines |
| server | `DDG-WIRE-001` registration | the `gate.md` loop | pass — 0 lines. `modules/brief/` still has no `routes.ts`, correct at this wave |
| server | integration | `vitest run .it.test` | gate did not run — needs Docker, not authorised |
| client | — | — | gate did not run — no `client/` file was touched |
| e2e | — | — | gate did not run — Docker not authorised, no browser flow in this plan |

## Not done

- `absent` — no test file. T9 has no row in the plan's `## Tests` table; the behaviour these files declare is tested through T11, T12 and T13.
- `absent` — `src/platform/container.ts` is untouched. The `brief` getter and `ContainerOverrides.brief` are T13's, in wave 9.
- `not checked` — whether migration `0019_misty_terrax.sql` has been **applied**. T15 owns that, and no hermetic test can tell "schema shipped" from "schema applied".
- `not checked` — the client half of this wave, and every e2e flow.

## For the parent

- **A cheap way to de-risk a wiring task, and it worked here.** T9 declares twelve ports that nothing imports until T13, so nothing in the package proves a real `Container` satisfies `BriefDeps` — `tsc` sees an unreferenced interface and passes. Checked without editing a file outside the Owned paths: a throwaway `tsconfig` in the scratchpad that `extends` `server/tsconfig.json`, adds `"typeRoots": ["<server>/node_modules/@types"]` (without it, `error TS2688: Cannot find type definition file for 'node'`) and includes `src/**/*.ts` plus one probe file returning `{ store, intent, blast, priorPrs, projectContext, agents: c.agentsRepo, repoDocs, fileRole, featureModel, llm, github, jobs }` as a `BriefDeps`. It compiled clean, so T13's binding is known to type-check before the task starts. Both scratch files were deleted; nothing in the repository was touched. Candidate for `server/INSIGHTS.md` (What Works).
- **For T11, two notes from inside `repository.ts`.** `getPrFiles` issues **no `ORDER BY`** — deliberate, because `file-roles.ts` (T5) documents the within-role order as `pr_files`'s own physical order and that file could not be edited. So anything digesting that list must impose its own order **and** deduplicate by path first, or the cache key wobbles with heap order and regenerates for free. And the four document-walk bounds it needs are in `constants.ts` under "The document walk"; `roots` is not among them, on purpose.
- **`specs/pr-brief.md` was read, not edited**, and no acceptance criterion is contradicted by this diff.
- `plan-verifier` has not been run. T11 depends on T5, T7 and T9, all three of which are now in the tree.

---

## Parent's notes on this report

**The `started_at IS NULL` term is the best catch of the run so far.** The plan's predicate —
`state <> 'running' OR started_at < :staleBefore` — was written from a cross-model review
finding and looked complete. It is not: a row marked `running` with no start time has no
measurable age, satisfies neither disjunct, and would therefore refuse **every** future
generation forever. That is precisely the brick the staleness window exists to prevent, and the
window as specified would have created it. Found by reading the predicate against the column's
nullability rather than by running anything.

**Verifying `BriefDeps` against a real `Container` before T13 starts is a genuinely new
technique and is held for Phase 6.** The problem it solves is structural: a consumer-declared
port that nothing imports yet is invisible to `tsc`, so a whole wiring task can be planned
against an interface no container can satisfy and nobody finds out until the wiring dispatch.
Proving it with a throwaway `tsconfig` in the scratchpad — no repository file touched, both
scratch files deleted — is the cheapest possible answer, and the `typeRoots` detail is exactly
the kind of thing the next person would lose twenty minutes to.

**Five deviations is the most in this run, and every one is forced by the wave split rather
than by taste.** `getRepo` and the four walk bounds exist because the ports need data the plan's
method list could not reach and because `src/adapters/**` may not import from `src/modules/**`.
`PrBriefs` landing here rather than in T13 is the one to watch: it pre-empts a file T13 owns, and
the report says the right thing about it — if T13 needs a different signature, `types.ts` is not
in its Owned paths and that is `Status: blocked`, not a quiet edit. **Carried into T13's
dispatch.**

**The `getPrFiles` note is carried into T11's dispatch verbatim.** No `ORDER BY` plus a cache key
derived from that list is the shape of a bug this repository has already recorded twice — a list
ordered by heap position wobbles the moment a row is updated, and here it would regenerate a
brief for free.
