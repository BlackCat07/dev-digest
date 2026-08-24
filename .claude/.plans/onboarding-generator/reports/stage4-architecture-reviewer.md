# Stage 4 — `architecture-reviewer`

Review of `401e8d6` (parent `a64a1b0`), branch `L05-spec-driven-development`.

**0 CRITICAL, 1 WARNING, 0 SUGGESTION.** Status: complete.

As of `401e8d6`, worktree dirty — but only with pre-existing untracked files unrelated to this diff: `HOME-TASK05.md`, `PROMPT.md`, `server/test/onboarding-facts.test.ts`, `server/test/onboarding-commands.test.ts`. No tracked file differs from `401e8d6`.

Scope: 43 files in the PR (base `a64a1b0`) — both packages, no uncommitted changes to any of them. The two untracked test files above are **not** part of this commit and are reported as the uncommitted set, not folded into the findings below (they cover `facts.ts`/`commands.ts`, and their content was not reviewed against the diff — that belongs to the test-writer / `/pr-self-review` step for the *next* commit, if one lands).

## Coverage

- `INSIGHTS server: 40+ entries across all sections, all read; relevant — 2026-08-10 (modules-no-raw-sdk misses node:fs), 2026-08-14 (import type does not exempt no-cross-module-internals), 2026-08-19 (drizzle-kit journal always rewrites), 2026-08-19 (migration must actually be applied, not just shipped).`
- `INSIGHTS client: 30+ entries across all sections, all read; relevant — 2026-08-02 (shared unit used by two subtrees → pulls/_components pattern, generalised here to src/components/ promotion), 2026-08-03/2026-08-10 (client imports of @devdigest/shared must stay import type), 2026-08-19 (AppShell mounts cleanly in jsdom).`
- Files reviewed in full: all 9 `server/src/modules/onboarding/*.ts`; `server/src/modules/repo-intel/{service,types}.ts` (diff hunks); `server/src/adapters/git/confined-doc.ts` (diff hunks); `server/src/platform/container.ts` (diff hunks); `server/src/db/schema/context.ts`; `server/src/db/migrations/0018_wide_morbius.sql` + journal; `server/src/modules/index.ts`; `server/src/vendor/shared/contracts/onboarding.ts` (+ client copy, diffed byte-for-byte); `server/src/prompts/onboarding.system.md`; `client/src/vendor/ui/nav.ts`; `client/src/components/app-shell/helpers.ts`; `client/src/components/mermaid-diagram/MermaidDiagram.tsx`; `client/src/lib/onboarding.ts`, `client/src/lib/hooks/onboarding.ts`; the `DocumentMarkdown` promotion + its one caller (`DocPreview.tsx`); `client/src/app/repos/[repoId]/onboarding/page.tsx` and its imports.
- Files skimmed for import hygiene/imports only, not line-by-line content review: `client/src/app/repos/[repoId]/onboarding/_components/{OnboardingView,TourSection}/*` (checked import lists, `@devdigest/shared` type-only-ness, absence of `fetch`/`vendor/ui/primitives/Markdown` — content-level React purity is `react-best-practices`' job, delegated); `client/messages/en/onboarding.json` (checked it's the only message file touched).
- `unrouted`: none — every changed file matched a Part 1 row.

## CRITICAL

None.

## WARNING

### 1. `modules/onboarding` has three homes for one kind of declaration (ports), where its own cited precedent has one.

- `server/src/modules/onboarding/types.ts:106-119` — `OnboardingIndexReader`, `OnboardingDocReader` (types.ts:195-198), `FeatureModelResolver` (types.ts:216-218)
- `server/src/modules/onboarding/repository.ts:97-104` — `export interface OnboardingStore { … }`
- `server/src/modules/onboarding/service.ts:113-121` — `export interface OnboardingDeps { store: OnboardingStore; index: OnboardingIndexReader; … }`

Rule: `onion-architecture` SKILL.md's placement framework treats "the interface of a dependency" as one kind of thing, and the module's own doc-comments claim a specific precedent for where that thing lives. `repository.ts:94-96` says the arrangement is "the arrangement `ProjectContextDeps` uses"; `service.ts:71-77` invokes the same `intent`/`IntentDeps` precedent. Both were opened: `project-context/types.ts` declares `ProjectContextStore` (`:155`) **and** `ProjectContextDeps` (`:277`) in the same file; `intent/sources.ts` declares `IntentStore` (`:114`), `FeatureModelResolver` (`:156`) **and** `IntentDeps` (`:184`) in that one file too. Onboarding's `types.ts` holds the index/doc-reader ports and `FeatureModelResolver`, but the store port (`OnboardingStore`) lives in `repository.ts` and the deps aggregate (`OnboardingDeps`) lives in `service.ts` — three files where the cited precedent uses one.

Mechanism, not a guess: this is a straightforward artifact of the plan's own task split — T6 owned `types.ts` and was forbidden from touching `repository.ts`/`service.ts`; T8 owned those two and was forbidden from touching `types.ts` (plan.md T6/T8 "Owned paths"/"Forbidden" rows). It is not an import-direction violation (`depcruise` is unaffected — see below) and does not cross a module boundary. It is a within-module organisational inconsistency: a reader of `intent` or `project-context` learns "the module's ports are in one file"; a reader of `onboarding` has to check three, and two of those three explicitly claim to be following a precedent they do not structurally match.

No `failure_scenario` — nothing breaks, no gate fires, no wrong behaviour results. Confidence: 0.75 (the precedent-file claim is verified by direct comparison; the severity judgment — that this is worth a WARNING rather than nothing — is the softer part).

## SUGGESTION

None.

## Reviewed and found correct (the other five flagged areas)

**1. The two do-not-touch zones.** `diff server/src/vendor/shared/contracts/onboarding.ts client/src/vendor/shared/contracts/onboarding.ts` and the two barrel `index.ts` files are byte-identical. `git diff` on `contracts/knowledge.ts` / `contracts/platform.ts` (both packages) is empty — `Onboarding`, `OnboardingSection`, `OnboardingLink`, `FeatureModelId`, `FEATURE_MODELS` untouched. `OnboardingLink` is imported and reused (`onboarding.ts:42`), not redeclared. `client/src/vendor/ui/nav.ts` has exactly one appended `NAV` item (`onboarding-tour`, icon `Workflow` — verified present in `icons.tsx:79,162`) and one appended `SHORTCUTS` row; no other line in the file changed. Correct by design, fully within permission.

**2. No sibling-module import, `import type` included.** Grepped every file in `server/src/modules/onboarding/`: zero imports of `repo-intel`, `blast`, `conventions`, `repos`, or `modules/settings` (including type-only). `toOnboardingStatus`/`toOnboardingReason` in `facts.ts` are a hand copy of `blast/service.ts`'s `statusOf`/`toReason` table, with a doc-comment naming the duplication and why. `featureModel` arrives as an injected `FeatureModelResolver` call signature (`types.ts:216`), satisfied structurally by `container.ts`'s existing arrow property (`container.ts:238-244`, pre-existing) — no import of `modules/settings/feature-models.ts` anywhere in the module. Matches the `IntentDeps`/2026-08-10 precedent exactly, as claimed.

**3. `modules-no-raw-sdk` blind spot / adapter widening.** `grep -rn "node:fs" src/modules/onboarding/` and the `child_process|exec(|spawn(` grep both return nothing. The only filesystem access is through the injected `OnboardingDocReader`, satisfied by `ConfinedRepoDocReader` (`adapters/git/confined-doc.ts`), whose import list is `node:path`, `node:fs/promises`, `@devdigest/shared` only — no `src/modules/**` import, so `adapters-are-leaves` holds. The new `match` predicate widens *which candidates are proposed*, never *what is reachable*: every candidate still passes through the unmodified `resolve()` (confinement re-check after `realpath`), confirmed by reading the diff hunk directly (`confined-doc.ts:88-101` doc-comment states this and the code enforces it — the predicate is applied inside `isCandidate` before, not instead of, the caller's `resolve` step in `list()`).

**4. The grep-avoidance wording and `.match()` vs `.exec()`.** Confirmed both are within the stated bounds. The doc-comments in `commands.ts`, `facts.ts`, `prompt.ts` and `types.ts` never spell `node:fs` or `child_process` — pure prose, zero behavioural effect. `commands.ts` uses `line.match(MAKE_TARGET)` / `line.match(COMPOSE_SERVICE)` where `.exec()` would be behaviourally identical (no `/g` flag on either regex, so `.match()` and `.exec()` return the same shape) — a syntactic choice with no control-flow consequence, not the "API choice made to satisfy a text search" the task warned about. No finding.

**5. AC-8 grounding, throughout.** Re-traced `service.ts`'s `assemble()`: every path the model claims (links, path-note rows, task paths) is unioned into `claimed`, resolved in one `getFileRank` call, and only paths present in the resulting `indexed` set reach `groundedLinks`/`groundedTasks`; `readingRows`/`criticalRows` independently gate on the same `indexed` set. Directory-shaped tasks are confirmed by prefix against `knownPaths` (server-derived paths only), per the plan's stated Assumption 7. No path in the assembled `OnboardingTourSection[]` reaches storage without this check. The reading-path and critical-path *order* comes from `facts.rankedPaths` / `facts.criticalChains` (index-derived, in `readingRows`/`criticalRows`) — the model supplies only the `reason` prose, keyed by path, via a `Map` lookup — so AC-5's ordering cannot be at the model's discretion by construction, not by convention. This is a stricter-than-required design, not a deviation that introduces risk.

## `depcruise`

Ran from `server/`: `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src`.

- At `401e8d6`: **0 errors, 22 warnings**, 221 modules, 740 dependencies.
- At `a64a1b0` (parent, checked via `git archive` into a scratch dir + symlinked `node_modules`, never touching the real worktree): **0 errors, 22 warnings**, 211 modules, 698 dependencies — the identical 22 lines (`row-types-stay-in-persistence` ×1, `routes-no-data-access` ×6, `no-cross-module-internals` ×2, `no-circular` ×5, `application-no-db-schema` ×8).

The onboarding feature contributes **zero** new errors and **zero** new warnings — verified by line-for-line comparison, not inferred. `enforcement.md`'s own stated baseline (18 warnings, 2026-08-04) is stale per its own caveat; the 22-warning figure is what both commits actually measure, so the diff's net contribution is 0 either way.

## Known drift not reported

All 22 `warn` lines above are pre-existing (present identically at `a64a1b0`) and not attributable to this diff: `routes-no-data-access` (`workspace`, `pulls`, `polling` routes), `application-no-db-schema` (`settings/feature-models.ts`, `reviews/run-executor.ts`, `reviews/diff-loader.ts`, `repos/helpers.ts`, `conventions/service.ts`), `no-cross-module-internals` (`repos/service.ts → repo-intel/constants.ts`, `conventions/service.ts → settings/feature-models.ts`), `no-circular` (the four DI-root cycles plus `agents/helpers ↔ agents/repository`), `row-types-stay-in-persistence` (`reviews/service.ts`). Considered and excluded, not missed.

The two named `pathNot` exceptions (`repo-intel/service.ts` importing adapters directly; `adapters/depgraph`/`adapters/astgrep` importing `repo-intel/constants.ts`) don't appear in the `depcruise` output at all (they're config-excluded) and are unrelated to any file this diff touches — considered, not applicable.

## Not checked

- Content-level React correctness of `OnboardingView.tsx` / `TourSection.tsx` (hook dependency arrays, memoisation, early-return structure, `useEffect` misuse) — `react-best-practices`' scope per this skill's own boundary; only import hygiene and placement were checked.
- Next.js special-file/RSC validity beyond the thin-route-entry shape of `page.tsx` — `next-best-practices`' scope.
- Test file content (`server/test/onboarding-*.test.ts` and the two untracked ones) — `no skill` per routing.md Part 1, and untracked besides.
- Secret scanning, generic bug hunting, dead-code/duplication — delegated below.
- `tsc --noEmit`, `eslint`, `vitest` — none of these are this agent's gates (only `depcruise` is), and none were run.

## Delegated, not done

- Merge verdict, the `DDG-*` full walk, package gates (`tsc`, `eslint`, `vitest`), diff-hash computation → `/pr-self-review`.
- Component purity, `useEffect` correctness, memoisation in `OnboardingView`/`TourSection` → `react-best-practices`.
- Next.js special-file/RSC checks on `page.tsx` → `next-best-practices`.
- Secret scanning (`DDG-SEC-001`), deeper security audit of the command-source parsing (`commands.ts`) beyond the placement/boundary read done here → `/security-review`.
- Generic bug hunting → `/code-review`.
- Reuse/duplication/dead-code (e.g. the hand-copied `statusOf`/`toReason` table) → `/simplify`.

## Process note, kept deliberately

Partway through this session the reviewer mistakenly ran `git checkout a64a1b0 -- .` from `server/` while trying to diff against the parent commit, which reverted 9 tracked files in the working tree to the parent version. It was caught immediately, `git checkout 401e8d6 -- .` restored them, and `git diff --stat` (empty) plus `git rev-parse HEAD` confirmed the worktree byte-identical to `401e8d6` with no loss. An earlier `git stash -u` / later `git stash pop` pair around that mistake was a no-op (stash list empty, nothing dropped or lost). A proper read-only `git archive` export into the scratchpad directory was then used to get the parent commit's `depcruise` baseline, which is the number reported above. No tracked file was left modified, and nothing was committed or pushed.

**Verified independently by the parent immediately after this report arrived:** `git rev-parse HEAD` = `401e8d6`; `git diff --stat` empty, so no tracked file differed; `git stash list` empty; and all three of `test-writer`'s in-progress untracked files still present. Nothing was lost.
