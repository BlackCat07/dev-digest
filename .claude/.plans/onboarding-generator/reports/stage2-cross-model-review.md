# Stage 2 — cross-model review of the plan

The plan was written by Opus. Before any implementer ran, it was reviewed by **two
independent Sonnet dispatches**, launched concurrently with disjoint briefs: one on
acceptance-criterion coverage, wave independence and Done-condition honesty; one
fact-checking every claim the plan makes about this codebase.

Thirteen edits came out of it. They are listed at the end of this file, and recorded in
`plan.md`'s own `## Cross-model review` section.

---

## Reviewer A — AC coverage, wave independence, Done-condition honesty

### Ranked findings

#### WARNING — `T1`, `T2`, `T3` claim behavioral ACs their own `Change` text cannot discharge, while `T4`/`T5`/`T7` correctly tag equivalent contributions "(enabling)"

**Evidence:** `T1` `Satisfies: AC-1, AC-2, AC-12, AC-19, AC-21, AC-25, AC-26, AC-30, AC-40` — no qualifier. `T1`'s entire `Change` is Zod type definitions ("Add one new contract file... Nothing existing is edited"). Contrast `T4`: `Satisfies: AC-20, AC-21 (enabling)` — same class of contribution, correctly labeled. `T1` even documents that it does *not* enforce AC-30 itself: *"Nothing here carries a numeric `.min()`/`.max()`... bounds enforced in code."* `T2` claims `AC-12, AC-25, AC-28, AC-40` from adding DB columns alone. `T3` claims `AC-33, AC-41, AC-42, AC-43` from adding JSON copy alone — the actual rendering ("one empty state renders," "notice above sections," "generic sentence for an unrecognised reason") is `T10`'s and `T7`'s work.

**Consequence:** Coverage is not actually broken — `T8`/`T6`/`T10`/`T7` complete each of these — but a reader who trusts a single task's `Satisfies` line (as the plan itself instructs implementers to do) would wrongly believe the type/schema/copy task alone discharges the criterion, and could skip verifying the completing task actually wires it in. This is exactly the "two tasks each assuming the other does it" risk the plan's own `(enabling)` convention exists to prevent, applied inconsistently.

#### WARNING — T8's Done-condition for AC-9 is a false check: it counts source text, not runtime calls

**Evidence:** `plan.md:523-524`:
```
grep -c "completeStructured" src/modules/onboarding/service.ts
# 1 = pass (AC-9)
```
AC-9 requires: *"WHEN a generation runs, the system shall issue exactly one structured model request."* Counting occurrences of the literal string `"completeStructured"` in the source file is not equivalent to counting runtime calls. A buggy implementation that calls `completeStructured` once in source but from inside a retry loop invoked twice per generation would **pass** this check while violating AC-9; conversely a correct implementation with a second textual reference (a type import, a comment, a helper wrapper) would **fail** it for no real reason.

**Mitigating factor:** `server/test/onboarding-service.test.ts` (test-writer stage) genuinely counts `MockLLMProvider.calls`, which is the real behavioral guard. So this specific line would not by itself let a broken implementation reach merge — but it is precisely the "grep-based check whose pattern would not match the thing it is looking for" this review was asked to find, and it creates false confidence if read as a self-contained proof of AC-9.

#### WARNING — The module-registration Done-condition checks for an import string, not registry membership

**Evidence:** `plan.md:515-516` (and repeated verbatim in `## Verification`, lines 690-694):
```
grep -q "'\./$m/routes.js'" src/modules/index.ts || echo "UNREGISTERED: $m"
```
I read the real `server/src/modules/index.ts`: registration is `import onboarding from './onboarding/routes.js';` followed by adding the bare identifier `onboarding` to a `Record<string, FastifyPluginAsync>` literal — the quoted path string `'./onboarding/routes.js'` appears **only in the import line**, never in the registry object. So this grep would return true (module "registered") for an implementation that imports the routes module but forgets to add it to the exported `modules` object — exactly the DDG-WIRE-001 failure ("mounts nowhere and 404s with no error") the check exists to catch.

**Mitigating factor:** `server/eslint.config.js:56` sets `@typescript-eslint/no-unused-vars: 'error'` with no import exemption, and T8's own Done-condition runs `eslint ... src/modules/index.ts` in the same block — an unused import from a forgotten registry entry would very likely be caught there instead. So the risk is a mislabeled/redundant check, not an unguarded one.

#### WARNING — T3 does not declare `Depends-on: T1`, though its content depends on T1's exact enum

**Evidence:** `T3`'s `Depends-on: —`, yet its `Change` §3 requires *"one message per `OnboardingReason` value plus a generic fallback sentence (AC-43)"* — that is nine specific string values (`flag_off, index_failed, index_partial, repo_too_large, index_missing, model_failed, model_timeout, model_invalid`) defined only in `T1`'s new contract file. Getting the count or spelling wrong produces either an untranslated reason (AC-43 failure) or a stray unused key.

**Mitigating factor:** Wave 1 (`T1` alone) completes strictly before Wave 2 (`T2`‖`T3`) starts, so execution order happens to be safe regardless of the missing declaration — but the dependency-audit rule the plan states for itself ("a task that reads a type T1 defines but does not declare `Depends-on: T1` is a wave-ordering bug") is violated on paper.

#### WARNING — T3's claim "T9 and T10 only read [onboarding.json]... T3 wrote every key this card needs" is not fully true

**Evidence:** `T9`'s `Change` requires rendering *"an inline notice where the diagram would be"* when `MermaidDiagram`'s new `fallback` prop is used (AC-38/EC-12) — that notice needs a translation key. `T3`'s enumerated list of additions (`plan.md:292`) names the five section titles, the rail label, the running state, the stale/partial/degraded notice copy, the reason messages + generic fallback, the caption, the copy-control name+confirmation, `Share link`+confirmation, the `Open` control's name, the three complexity words, and the inline-error copy — it never names a "diagram unavailable" string. `T9`'s own red-flag text ("do not add a key... T3 wrote every key this card needs; if one is genuinely missing, report it") shows the plan anticipated this class of gap but did not close it for this specific, identifiable key.

#### WARNING — No Done-condition or named test directly verifies T2's added column set

**Evidence:** `T2`'s Done-condition checks `tsc`, runs `drizzle-kit generate`, greps the new `.sql` for absence of `DROP`/`ALTER COLUMN`, and runs `eslint` — none of these count or type-check the fourteen added columns as a set. The `## Tests` table lists no schema/repository test for T2 at all. `## Applying the migration` explicitly acknowledges a related but different failure ("schema shipped ≠ schema applied"); it does not address "schema shipped with the wrong shape." A column that exists but is simply never referenced by `T8`'s repository code (e.g., `started_at` silently dropped from the write path) would not fail any gate — `tsc` only flags a *missing* column that code actually references, not a column nobody uses.

#### WARNING — EC-21 (repository deleted mid-generation) is neither cited nor discussed, and the plan's own design implies a real failure path

**Evidence:** `EC-21` is never cited by number anywhere in the plan (confirmed by exhaustive grep of `EC-[0-9]+`). Spec traceability maps it to `AC-29` (workspace-scoped resolve-before-read), which only guards the *request-time* authorization check, not a deletion racing an in-flight job. `T2`'s schema has `repo_id uuid PK → repos.id ON DELETE cascade`; if the parent repo row (and hence the cascaded onboarding row) disappears while a job is running, the completion-time upsert (`T8`, "the single-row upsert that replaces the tour") would violate that same FK, and the fallback path T8 borrows from `conventions/service.ts:200-208` — *"write the failure onto its own row"* — has no row left to write to. No task discusses this, and no test in `## Tests` names EC-21.

#### SUGGESTION — T6's `node:fs`-absence grep is mislabeled as an AC-22 check

**Evidence:** `plan.md:421-422`:
```
grep -rn "node:fs" src/modules/onboarding/
# 0 lines = pass  (AC-22 and the modules-no-raw-sdk blind spot)
```
AC-22 is "shall not execute a command" (process spawning); the absence of `node:fs` is the unrelated `modules-no-raw-sdk` architecture invariant (confinement/adapter-boundary). The real AC-22 check is the next line (`child_process|execFile|spawn\(|exec\(`), correctly labeled. Cosmetic mislabeling only, no coverage gap.

#### SUGGESTION — the `exec\(` alternative in the AC-22 grep would miss a bare `execSync(`/`execFileSync(` call in isolation

**Evidence:** `grep -rnE "child_process|execFile|spawn\(|exec\(" src/modules/onboarding/` — `execFileSync(` is still caught (contains `execFile`), but a hypothetical `exec(` alias imported under a different local name without ever writing the literal string `child_process` (e.g., re-exported through an already-imported utility) would slip past. Low-probability in this codebase's conventions; noted for completeness only.

### Points explicitly checked and found consistent (no defect)

- **Waves 2–5 never pair two same-package tasks**, so the plan's own rule ("share a wave only when Owned paths are disjoint **and** different packages") is trivially satisfied by construction — every wave from 2 through 5 is exactly one server task and one client task; Owned-path sets for each such pair are disjoint by inspection (verified task by task). No same-wave overlap exists.
- **The three "discharged without a test" claims match the spec's own `Verify:` column exactly**: AC-13 → `demonstration` (spec) = `demonstration` (plan); AC-22 → `analysis` = `analysis`; AC-19 → `inspection` = `inspection`. **AC-45's split** ("asserted for reachability, demonstrated for activation") is quoted almost verbatim from the spec's own AC-45 text. No mismatch found here — this is a place the plan got it right.
- Spot-checked ~15 of the plan's concrete file:line citations against the real repository (`server/src/modules/index.ts`, `repo-intel/types.ts`, `adapters/git/confined-doc.ts` lines 304-349, `db/schema/context.ts:120-126`, `db/schema/reviews.ts:139-179`, `blast/service.ts` `toReason`/`statusOf`, `adapters/mocks.ts` `MockLLMProvider`, `vendor/shared/contracts/knowledge.ts:28-47`, `vendor/shared/contracts/platform.ts`, client `nav.ts`, `app-shell/helpers.ts` `activeKeyFor`, `MermaidDiagram.tsx`, `DocumentMarkdown.tsx`'s doc-comment, `DocPreview.tsx:20`, `BlastRadiusCard.tsx:285`, `intent/service.ts:147-172`) — every one checked out exactly as described. The plan's factual grounding in the real tree is strong.

### AC → task matrix

| AC | Task(s) | Split type | Note |
|---|---|---|---|
| AC-1 | T1, T8 | type + behavior | T1 not marked enabling; T8 does the real work |
| AC-2 | T1, T8 | type + behavior | same pattern |
| AC-3 | T8 | single | |
| AC-4 | T8 | single | |
| AC-5 | T6 | single | delegates to existing `getTopFilesByRank` |
| AC-6 | T6 | single | |
| AC-7 | T6 | single | delegates to existing `getCriticalPaths` |
| AC-8 | T8 | single | |
| AC-9 | T8 | single | Done-condition proxy is weak (see finding) |
| AC-10 | T8 | single | |
| AC-11 | T8 | single | |
| AC-12 | T1, T2, T8 | type + schema + logic | legitimate layered split |
| AC-13 | T8 (+ demonstration) | single | matches spec's own Verify |
| AC-14 | T8 | single | |
| AC-15 | T8 | single | |
| AC-16 | T6, T8 | compute + apply | |
| AC-17 | T8 | single | |
| AC-18 | T6, T8 | compute + apply | |
| AC-19 | T1, T6, T8 | type + index-side + model-side | legitimate 3-way split; verified matches `blast/service.ts` precedent |
| AC-20 | T4, T6 | enabling + doing | T4 not marked enabling (unlike its own AC-21 tag) |
| AC-21 | T1, T4 (enabling), T6 | type + enabling + doing | T4 correctly tagged; T1 not |
| AC-22 | T6, T8 | independent negative checks | fine — each module separately must not spawn |
| AC-23 | T8 | single | |
| AC-24 | T8 | single | |
| AC-25 | T1, T2, T8 | type + schema + logic | |
| AC-26 | T1, T8 | type + logic | T1 not marked enabling |
| AC-27 | T8 | single | |
| AC-28 | T2, T8 | schema + logic | |
| AC-29 | T8 | single | |
| AC-30 | T1, T8 | type + logic | T1's own text disclaims enforcing this |
| AC-31 | T3 | single | T3's own edit fully satisfies it |
| AC-32 | T3 | single | T3's own edit fully satisfies it |
| AC-33 | T3, T10 | copy + render | T3 not marked enabling |
| AC-34 | T7, T10 | polling logic + render | both real contributions |
| AC-35 | T9, T10 | section render + ordering/rail | both real |
| AC-36 | T5 (enabling), T9 | correctly tagged | |
| AC-37 | T5 (enabling), T9 | correctly tagged | |
| AC-38 | T5 (enabling), T9 | correctly tagged | see "diagram unavailable" key gap |
| AC-39 | T9 | single | |
| AC-40 | T1, T2, T7, T10 | type + schema + format + render | layered, plausible |
| AC-41 | T3, T10 | copy + render | T3 not marked enabling |
| AC-42 | T3, T10 | copy + render | T3 not marked enabling |
| AC-43 | T3, T7, T10 | copy + real fallback logic + render | T7 does the actual lookup-with-default |
| AC-44 | T7, T10 | thin + render | T7's contribution is largely incidental (react-query default) |
| AC-45 | T9, T10 | each own controls | both real; matches spec's own split |
| AC-46 | T10 | single | |
| AC-47 | T7 (enabling), T9 | correctly tagged | |

All 47 ACs are claimed by at least one task — no fully open row.

### Edge cases not cited by number

| EC | Status |
|---|---|
| EC-1 | implicitly covered via AC-18/AC-40 tasks |
| EC-2 | implicitly covered via AC-2/16/17/33 tasks |
| EC-3 | no action needed — upstream indexer/facade behavior, inherited unchanged |
| EC-6 | spec `accepted` — correctly excluded |
| EC-11 | inherited from unchanged reviewer-core (N2) |
| EC-17 | implicitly covered via AC-4 (T8) |
| EC-19 | implicitly covered via AC-10/AC-15 (T8) — spec traceability treats these as the full answer |
| EC-20 | implicitly covered via AC-25/26/41/47 tasks |
| **EC-21** | **genuinely unaddressed** — see WARNING above |
| EC-22 | implicitly covered via AC-15's generic "throw" fixture |
| EC-24 | spec `accepted` — correctly excluded, matches N4 |
| EC-29 | implicitly covered via AC-16's degraded-index path |

### Not checked

- Did not execute any Done-condition command (no code exists yet); all grep/regex assessments are static reasoning about the pattern semantics, not empirical runs against a real (or deliberately broken) implementation.
- Did not verify the remaining ~15 file:line citations beyond the ones spot-checked (e.g., `repo-intel/service.ts:880` constants, `repo-intel/constants.ts`, `conventions/prompt.ts:25-47`, `platform/jobs.ts:41`, `platform/errors.ts`, `settings/feature-models.ts`, `lib/github-urls.ts:24`, `lib/repo-context.tsx:67`, `lib/hooks/conventions.ts:38`, `test/project-context-walk.test.ts`).
- Did not verify the dated `INSIGHTS.md` entries the plan cites (2026-08-02 through 2026-08-19) against the actual `INSIGHTS.md` file contents/dates in `server/`, `client/`, `reviewer-core/`.
- Did not examine `e2e/` or `mcp-server/` — correctly out of the plan's scope, per the plan's own `## Scope` section.
- Did not attempt to independently simulate the module-registration or `completeStructured` grep against a hand-written buggy file to empirically confirm the false-pass/false-fail behavior; the conclusion rests on reading the regex and the real target file's structure.
- Did not review `.claude/skills/pr-self-review/gate.md` or `routing.md`, which the plan cites as grounding for several invariants.

---

## Reviewer B — fact-check of every claim the plan makes about this codebase

Six parallel read-only verification passes covered every path/symbol group the plan cites. Bottom line: the plan is **unusually accurate** — dozens of `path:line` citations, including many precise to the line, checked out exactly. Three concrete false claims surfaced, one of them consequential.

### False claims

**1. The onboarding system prompt has two `routes_and_apis` clauses, not three — found independently by three separate checks**

Plan (T8, and again in "Where this dispatch and the tree disagree" §5):
> "remove the three clauses naming `routes_and_apis` (the diagram allowance, the formatting paragraph, and the mermaid rule's mention), leaving the `architecture` half of each intact."

Actual `server/src/prompts/onboarding.system.md`: `grep -c "routes_and_apis"` → **2** (line 8, the diagram-allowance sentence; line 23, the formatting-paragraph bullet). The "Mermaid rules" block (lines ~25–36) is generic quoting/line-break/fence guidance and never names `routes_and_apis` at all.

Consequence: an implementer told to find and remove "three clauses" will hunt for a nonexistent third occurrence inside the Mermaid-rules block — a block the plan elsewhere calls load-bearing ("its untrusted-data clause, its grounding rules and its mermaid rules are all load-bearing") and explicitly says must not change. Low probability of real damage since the two real edits are unambiguous, but the count is wrong and risks a stray edit to a rule that also governs the surviving `architecture` diagram.

**2. `resolveFeatureModel` is claimed to be already cross-module-consumed by `modules/intent` — it's actually `modules/conventions`, and `intent` uses the injected-closure pattern specifically to avoid that edge**

Plan (Constraints → Architecture):
> "...and `resolveFeatureModel` from `modules/settings/feature-models.ts` — which is already consumed cross-module by `modules/intent` and takes a `Db`, not a `Container`, precisely so it creates no cycle (`server/INSIGHTS.md`, 2026-08-10)."

`server/INSIGHTS.md`, 2026-08-10, actually says the opposite was fixed for intent: `resolveFeatureModel` took the parameter as `db: Db` and "having the composition root satisfy a consumer-declared call signature (`FeatureModelResolver`) removed the cross-module edge too, because the module then imports no sibling." Confirmed by grep: `modules/intent/service.ts` never imports `resolveFeatureModel` — it calls an injected `this.deps.featureModel(...)` closure wired from `container.ts:241`. The module that actually does the direct cross-import today is `modules/conventions/service.ts:17`, which is an *accepted* `no-cross-module-internals` warning, not the clean pattern.

Consequence: T8 instructs the implementer to write, inside `onboarding/service.ts`, "resolve the model with `resolveFeatureModel(container.db, workspaceId, ONBOARDING_FEATURE_MODEL)`" — a direct import of `modules/settings/feature-models.ts` from `modules/onboarding`. That reproduces the exact cross-module edge the cited INSIGHTS entry moved *away from*, and `no-cross-module-internals` (`from: ^src/modules/onboarding/`, `to: ^src/modules/settings/`) is not exempted for it. T8's own Done-condition requires `depcruise` to show "no new errors or warnings attributable to `modules/onboarding`" — as written, T8 would fail its own acceptance bar. The safe precedent to copy is intent's injected-closure `FeatureModelResolver`, not a raw cross-module call.

**3. Neither `Compass` nor `BookOpen` exists as an `IconName` in `client/src/vendor/ui/icons`**

Plan (T3):
> "an existing `IconName` (`Compass` or `BookOpen` — pick one that exists in `src/vendor/ui/icons`; verify before writing)"

Actual `icons.tsx` icon registry (lines ~86–165): `grep -n "Compass\|BookOpen"` → no matches. Neither name is in the exported `IconName` union.

Consequence: minor but real — the plan presents these as the two live candidates to choose between. In fact neither exists, so the implementer only discovers this by hitting a `tsc` error (or, worse, by not checking and shipping a broken icon reference) — precisely the failure mode the plan's own red-flag warns against ("the sidebar renders nothing where the icon should be and no gate sees it"), just triggered by a wrong premise rather than by skipping verification.

**Minor / low-severity slip — not a line-number issue, a field-name issue**

Plan (T4): "implement it... returning `{ file, endpoints, crons }` rows." Actual `IndexerFileFactsRow` (`repository.ts:99`): `{ filePath: string; endpoints: string[]; crons: string[] }` — the field is `filePath`, not `file`. An implementer copying this shape literally would name the field wrong; caught immediately by `tsc`, so consequence is trivial.

### Compact verdict table (representative — full detail in the six passes)

| Area | Claim | Verdict |
|---|---|---|
| repo-intel | `getTopFilesByRank`/`getCriticalPaths`/`getFileRank`/`getRepoMap`/`getIndexState`/`getConventionSamples` exist as described, at cited lines (`:813`, `:837`/`:880`, `:592-596`, `:572`, etc.) | confirmed, exact lines |
| repo-intel | `getCriticalPaths` seeds unfiltered; `getTopFilesByRank` applies `isJunkPath`; 10× over-fetch | confirmed |
| repo-intel | `getConventionSamples` is a one-line alias of `getTopFilesByRank` | confirmed |
| repo-intel | `getFileFacts` at `repository.ts:565`; `RepoIntel` interface (206-241) doesn't expose it | confirmed |
| repo-intel | `getFileFacts` return shape `{file, endpoints, crons}` | **FALSE** (minor) — actual field is `filePath` |
| constants.ts | `MAX_INDEXED_FILES=5000`, `BFS_DEPTH=2`, `INDEXER_VERSION=3`, `CRITICAL_PATH_ROOTS=5`, `EXCLUDED_DIRS` (8, no `.pnpm-store`) | confirmed exactly |
| vendor/shared | `Onboarding`/`OnboardingSection`/`OnboardingLink` at `knowledge.ts:28-47` | confirmed (actual 29-47, ±1 line) |
| vendor/shared | `FEATURE_MODELS[0]` exact onboarding entry; `FeatureModelId` includes it | confirmed exactly |
| vendor/shared | `StructuredResult<T>` fields at `adapters.ts:72-80` | confirmed exactly |
| vendor/shared | Two `index.ts` barrels byte-identical today | confirmed — `diff` empty |
| vendor/shared | `blast.ts` reuses `ChangedSymbol`/`DownstreamImpact` from `brief.js` | confirmed |
| client/feature-models | `client/src/lib/feature-models.ts` carries `onboarding` at ~line 15 | confirmed exactly |
| confined-doc.ts | `isCandidate` (`:304-307`), `resolve` (`:218-240`), doc-comment (`:42-45`) | confirmed exactly |
| confined-doc.ts | `RepoDocWalkOptions.excludedDirs` exists, `match` does not yet | confirmed |
| adapters/mocks.ts | `MockLLMProvider` `.calls`, `structuredBySchema`, safeParse+throw, always `attempts:1` | confirmed |
| platform/errors.ts | 404/422/502/500 mapping, no `ConflictError` | confirmed exactly |
| platform/jobs.ts | `enqueue`/`register` shape, 120,000ms at `:41` | confirmed exactly |
| intent/service.ts | deadline-race at `:147-172`, rejection folded into resolved value | confirmed |
| blast/service.ts | `toReason` (`:86-99`), `statusOf` (`:356-363`) mappings | confirmed exactly |
| conventions/prompt.ts | `renderTemplate` replaces unmatched placeholder with empty string | confirmed exactly (note: this contradicts the *spec's* own EC-23 wording — plan is right, spec text is the inaccurate one, out of this fact-check's scope) |
| conventions/schemas.ts | no `.optional()`, no array `.min()/.max()` constraints | confirmed word-for-word |
| onboarding.system.md | exists, takes `{{sections}}`/`{{language}}`, untrusted-data clause at 11-12 | confirmed |
| onboarding.system.md | "three clauses naming `routes_and_apis`" | **FALSE** — only 2 |
| db/schema | `onboarding` table's 3 current columns at `context.ts:120` | confirmed exactly |
| db/schema | `pr_intent` column set at `reviews.ts:139-179` | confirmed (table closes at 180, immaterial) |
| migrations | `0000_init.sql:205` onboarding CREATE TABLE | confirmed exactly |
| client/nav.ts | WORKSPACE order (pulls, context), carve-out comment ~22-32, `SHORTCUTS` shape | confirmed (comment actually 21-33, ±1) |
| client/nav.ts | `Compass`/`BookOpen` exist as `IconName` | **FALSE** — neither exists |
| client/Sidebar.tsx | imports `NAV` directly, no override hook | confirmed |
| app-shell/helpers.ts | `activeKeyFor` (26-40), ladder, `/onboarding` clause, sole consumer, no test | confirmed exactly |
| MermaidDiagram.tsx | `return null` at `:59`, `MERMAID_RE`, `mermaid.parse({suppressErrors:true})`, sole real consumer `BlastRadiusCard.tsx:285` | confirmed exactly |
| DocumentMarkdown | dir + test exist, sole importer `DocPreview.tsx:20`, doc-comment 15-20 | confirmed exactly |
| github-urls.ts | `githubBlobUrl` signature at `:24` | confirmed exactly |
| onboarding.json | existing keys, `generate.body`'s different five sections | confirmed verbatim |
| shell.json | `nav.onboarding-tour` already present | confirmed |
| hooks/conventions.ts | `:38` function-form `refetchInterval` polling precedent | confirmed exactly |
| architecture | `resolveFeatureModel` "already consumed cross-module by `modules/intent`" | **FALSE** — that's `modules/conventions`; intent uses an injected closure to avoid the edge |
| architecture | `no-cross-module-internals` at `.dependency-cruiser.cjs:92`; blocks the named sibling modules | confirmed exactly at line 92; rule itself is generic (any-module→any-sibling), not a literal list — the plan's *stated effect* is still correct (nuance, not false) |
| architecture | `modules-no-raw-sdk` doesn't list `node:fs` | confirmed |
| architecture | `application-no-db-schema` / `routes-no-data-access` restrict db/schema access | confirmed present, but both are `warn`-severity with pre-existing drift, not hard error gates (nuance/partly — the plan's Done-conditions already phrase this correctly as "no *new* errors/warnings," just the standalone Architecture bullet reads as stricter than it is) |
| architecture | `adapters-are-leaves` — `src/adapters/**` imports nothing from `src/modules/**` | confirmed |
| CI/gates | 9 named binaries exist at their `node_modules/.bin/` paths | confirmed, all present |
| CI/gates | `.github/workflows/server-unit.yml` excludes `**/*.it.test.ts` | confirmed |
| CI/gates | `server/package.json` deps list, no YAML parser | confirmed exactly |
| CI/gates | `tsconfig.json` include `["src/**/*.ts"]`; `tsconfig.eslint.json` widens it | confirmed exactly |
| CI/gates | `client/vitest.config.ts` duplicates tsconfig aliases | confirmed |
| container.ts | `projectContext`/`priorPrs` lazy-getter + `ContainerOverrides` precedent | confirmed |
| settings/routes.ts, app.ts | per-route rate-limit precedent at `:45`; global `120/1min` at `app.ts:96` | confirmed exactly |
| client/api.ts | conditional content-type for body-less POST, Fastify error text | confirmed exactly |

### Claims not checked, and why

- **`file_rank` write-side** (whether it's genuinely written for *every* indexed file): only the read side (`getFileRankFor`) was inspected; the indexer pipeline's write path was not traced. Low risk since it's consistent with every other observation, but not independently confirmed.
- **`client/src/app/skills/_components/SkillBody/`** existence (named in T5's Forbidden list as "a near-sibling with different needs"): not independently opened — referenced only in passing, not a load-bearing plan claim.
- The full set of dated `server/INSIGHTS.md` / `client/INSIGHTS.md` entries cited in "Prior findings that bind specific tasks" (2026-08-02, 2026-08-03, 2026-08-04, 2026-08-05, 2026-08-11, 2026-08-14): the 2026-08-06, 2026-08-10, 2026-08-14, and 2026-08-19 entries most load-bearing to T8/T2 were spot-checked and confirmed verbatim; the remainder were not individually re-verified line-for-line.
- **Execution of any gate/binary** was deliberately not performed (per the task's constraints) — binary existence was confirmed via `ls -la` only, never run.
- Two `knowledge.ts` copies (server vs client) were found to have **pre-existing, unrelated drift** (server's carries extra `AgentVersion`/`AgentVersionConfig` types the client's lacks) — the plan makes no claim these two files are currently byte-identical (only the barrels and the three untouched symbols), so this isn't a plan error, just noted as pre-existing drift outside this plan's scope.

---

## The thirteen edits applied to `plan.md`

Applied by the parent after both reviews returned. Every reviewer premise that was
re-checked held; **none was disproved, so no fix was withheld.** Five were verified
against the tree directly rather than taken on the reviewer's word — marked below.

| # | Finding | Severity | What changed in `plan.md` |
|---|---|---|---|
| A | `resolveFeatureModel` is **not** consumed cross-module by `modules/intent` (**re-verified**: `intent/sources.ts:156` declares `FeatureModelResolver`, `service.ts:141` calls the injected closure, `container.ts:238-244` satisfies it; the direct importer is `conventions/service.ts:17`) | **CRITICAL** | Constraints bullet and the `## Verified facts` entry rewritten; **T8's instruction changed** from a direct `resolveFeatureModel(...)` call to the injected resolver, with the resolver added to T6's `types.ts`; new Done-condition `grep -rn "modules/settings" src/modules/onboarding/` → 0 lines |
| J | EC-21 unhandled (**re-verified**: the `ON DELETE cascade` confirmed in `db/schema/context.ts`) | WARNING | New bullet in T8's `service.ts`: re-read the repository before persisting, return silently when gone, and **do not** wrap the upsert in a blanket `try/catch`. Added to T8's `Acceptance` and to the `onboarding-service` row in `## Tests` |
| B | Two `routes_and_apis` clauses, not three (**re-verified**: `grep -n` → lines 8 and 23) | WARNING | Corrected in T8, `## Verified facts` and Assumption 6, each naming the two real lines, plus an explicit warning that the Mermaid-rules block does not mention it and must not be touched |
| C | Neither `Compass` nor `BookOpen` is an `IconName` (**re-verified**: no match in `icons.tsx`) | WARNING | T3 now says so outright and names members that do exist (`Workflow`, `Boxes`, `ListChecks`), keeping the verify-before-writing instruction |
| I | The registration check matched the import line only (**re-verified**, and the replacement was **executed** against the real tree — clean on all 15 modules) | WARNING | Both copies replaced with a two-stage check: resolve the imported identifier, then require its membership in the exported record |
| G | Nothing measured T2's own column set | WARNING | T2 gains two Done-conditions over the generated `.sql`: `ADD COLUMN` count = 14, and a per-name loop printing `MISSING COLUMN:` |
| H | `grep -c completeStructured` = 1 proves one call **site**, not one call | WARNING | Kept as a cheap smoke check but relabelled honestly, pointing at `MockLLMProvider.calls` in `onboarding-service.test.ts` as AC-9's real proof |
| E | T3 declared `Depends-on: —` while needing T1's `OnboardingReason` enum | WARNING | `Depends-on: T1`, with the reason. Changes no wave ordering — it makes the declaration true |
| F | T3's key list omitted the diagram-unavailable string T9 must pass as `fallback` | WARNING | Added to T3's enumerated list, tagged AC-38 |
| D | T4 described `getFileFacts` as returning `{ file, … }` (**re-verified**: `IndexerFileFactsRow` at `repository.ts:99`) | SUGGESTION | Corrected to `filePath` |
| K | `(enabling)` used on T4/T5/T7 but not on T1/T2/T3 | SUGGESTION | Markers added to all three. No AC removed from any `Satisfies` line |
| L1 | `application-no-db-schema` / `routes-no-data-access` read as hard gates; both are `warn` with pre-existing drift | SUGGESTION | The Architecture bullet now states the severity and warns against adopting inherited warnings |
| L2 | The **spec's own EC-23** misdescribes `renderTemplate` (**re-verified** in `conventions/prompt.ts`) | SUGGESTION | Recorded under the recommendations as a `doc-writer` amendment for when the feature lands — it changes no criterion, so not a blocker |

**Left unchanged, with the reason recorded:** T6's `node:fs` grep is labelled AC-22 when it
is really the `modules-no-raw-sdk` blind spot (the AC-22 check is the line directly below
it, correctly labelled), and that pattern would miss an `exec` alias imported under a
different local name. Neither changes what an implementer does.

**Checked and needing no change** — recorded because a review that lists only faults
misrepresents what was examined: every one of the ~40 spot-checked `path:line` citations
was confirmed exact; every named constant matched its value; all nine gate binaries exist
at the paths given; the two `vendor/shared/index.ts` barrels `diff` clean; the three
"discharged without a test" claims match the spec's own `Verify:` hints exactly; all 47
acceptance criteria are claimed by at least one task, with no open row; and waves 2–5 are
each exactly one server task and one client task, so the disjointness rule holds by
construction.
