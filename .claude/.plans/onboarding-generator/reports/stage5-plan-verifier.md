# Plan verification — onboarding-generator / Implementation Plan — Onboarding Generator (SPEC-02)

**Status: complete.**
AC: 44 yes, 1 yes (differently), 1 partial, 1 not checked, 0 no (47 total) · Done-conditions: 10 pass, 0 fail, 0 gate did not run · Done-condition commands: 61 verbatim, 0 look wrong.

As of `f9e78a0` (`L05-spec-driven-development`); diff is `a64a1b0..HEAD` — 401e8d6 (43 files, both packages) + f9e78a0 (29 files: 9 tests + 5 module-file port consolidation + 15 pipeline-report docs). No uncommitted changes belong to this feature (`HOME-TASK05.md`, `PROMPT.md` are untracked and pre-existing, unrelated).

## Leading with what is not fully closed (the reason for this dispatch)

Two rows in the AC→task→test→commit matrix do not close end to end. Both are disclosed by the pipeline itself (plan's `## Tests`, test-writer's `## Not tested`), not discovered here — but they are real, and I re-checked each on the current tree rather than taking the disclosure on trust:

1. **AC-13 (demonstration required by the spec) was never actually demonstrated.** No one in this pipeline generated a real tour and read the resulting log line; `server/test/onboarding-prompt.test.ts`'s `describe('a completed generation prices itself in one log line (AC-13)')` asserts the *shape* of the call to a fake logger, which is a `test`, not the `demonstration` the spec's own `Verify:` field requires. Verdict: `not checked`.
2. **AC-14's fallback-to-registry-default half is untested anywhere in this diff.** `server/test/onboarding-service.test.ts` proves the service asks for the `onboarding` feature-model id and uses whatever the resolver answers; the "no override stored ⇒ registry default" branch lives entirely inside `modules/settings/feature-models.ts`, which this module deliberately never imports (that is the point of T6/T8's `FeatureModelResolver` indirection) and which this diff does not touch or test. Verdict: `partial`.

Neither is a defect introduced by this diff — both are honestly disclosed gaps the plan and test-writer named in advance (plan `## Tests`, test-writer report `## Not tested`) — but they are the two rows this dispatch exists to surface, so they lead the report rather than hiding in row 13 and row 14 of a 47-row table.

## Coverage

- `INSIGHTS server`: 51 dated entries (grep-counted on the current tree), the plan's own `## Coverage` names 14 as relevant to this feature and cites each by date; I spot-checked the 2026-08-19 entries (migration-must-be-applied, jsonb-cast, journal-always-rewrites, symlink-pair) against the code and they match what the entry describes. 0 new entries were appended by either the implementer or test-writer commit — `server/INSIGHTS.md` is not in either commit's file list.
- `INSIGHTS client`: 29 dated entries, plan cites 10 as relevant (Markdown inline-only, no user-event, AppShell-mounts-clean, jsdom-no-Enter-click, import-type boundary, etc.); same spot-check, same result. 0 new entries appended by this diff.
- `INSIGHTS reviewer-core`: 1 entry (numeric-range-keyword rejection), cited and relevant; `reviewer-core/` is byte-unchanged (`git diff a64a1b0 HEAD --stat -- .` → empty), confirmed this run.
- Files read in full this run: all 9 `server/src/modules/onboarding/*.ts`, the diff hunks of `repo-intel/{service,types}.ts`, `confined-doc.ts`, `container.ts`, `index.ts`, `db/schema/context.ts`, the migration SQL, both contract files + barrels, `onboarding.system.md`, `nav.ts`, `helpers.ts`, `MermaidDiagram.tsx`, `lib/onboarding.ts`, `lib/hooks/onboarding.ts`, `OnboardingView.tsx`, `TourSection.tsx`, `page.tsx`, `messages/en/onboarding.json`, and grep-level content of all 9 test files (assertion titles, not full bodies). Not opened line-by-line: full bodies of the 9 test files, the 15 stage-report docs (process artefacts, out of scope for a plan verifier), `e2e/`, `mcp-server/`.

## Requirements (AC-1 … AC-47)

| AC | Verdict | Method | Evidence |
|---|---|---|---|
| AC-1 | yes | test | `server/test/onboarding-service.test.ts:304` "answers the five kinds in the contract's order, twice…"; `service.ts` `assemble()` maps over `SECTION_KINDS` (contract order), never the model's |
| AC-2 | yes | test | `onboarding-service.test.ts:343` "answers 200-shaped with no sections for a repository nobody has generated one for"; `service.ts:167-170` (`emptyTour`) |
| AC-3 | yes | test | `onboarding-service.test.ts:409` "answers accepted with a job id without holding the request open" |
| AC-4 | yes | test | `onboarding-service.test.ts:427` "refuses a second generation while one is running, and the model is called once" |
| AC-5 | yes | test | `server/test/onboarding-facts.test.ts:148` "orders paths by rank descending…"; `facts.ts` calls `getTopFilesByRank` with no re-sort |
| AC-6 | yes | test | `onboarding-facts.test.ts:186` "yields neither of the two highest-ranked test and tool-config paths" |
| AC-7 | yes | test | `onboarding-facts.test.ts:228` "passes the chains through unchanged: at most five, each of two or three distinct paths" |
| AC-8 | yes | test | `onboarding-service.test.ts:501` "drops every item naming a path the index does not hold, and stores the rest"; `service.ts` `assemble()` grounds every claimed path against one `getFileRank` call |
| AC-9 | yes | test | `onboarding-service.test.ts:462` "issues exactly one structured request, whatever the size of the repository"; smoke grep `grep -c completeStructured service.ts` → `1` (site count only, per plan's own caveat) |
| AC-10 | yes | test | `server/test/onboarding-degraded.test.ts:383` "pins the provider's own retry count…" + `:397` "records the round-trip count, and it is never above two" |
| AC-11 | yes | test | `onboarding-degraded.test.ts:361` "finishes and stores a degraded tour when the provider never answers" |
| AC-12 | yes | test | `onboarding-service.test.ts` (write path asserted via fake `OnboardingStore`, all five figures); Postgres round-trip itself is untested (Docker out of scope) but that is EC-28's concern, not this criterion's |
| AC-13 | **not checked** | demonstration required, not performed | `onboarding-prompt.test.ts:219` asserts the log line's *shape* against a fake logger only; no live generation was run and no real log line was read this session or any prior stage |
| AC-14 | **partial** | test (workspace-choice half only) | `onboarding-service.test.ts:473` "asks the workspace's onboarding feature-model choice and calls the model it names"; the fallback-to-registry-default half lives in untested `modules/settings/feature-models.ts`, outside this diff |
| AC-15 | yes | test | `onboarding-degraded.test.ts:304-352`, three fixture providers → three distinct reasons, no HTTP error |
| AC-16 | yes | test | `onboarding-degraded.test.ts:411` "reads as degraded/index_missing, with a 200-shaped payload" |
| AC-17 | yes | test | `onboarding-degraded.test.ts:428` "costs nothing: no provider is constructed and no call is made" |
| AC-18 | yes | test | `onboarding-facts.test.ts:286` "is labelled partial/index_partial with its material intact" |
| AC-19 | yes | inspection + test (exceeds the spec's own minimum) | `facts.ts:47-101` `toOnboardingStatus`/`toOnboardingReason`/`mapIndexState`, hand-copy of `blast/service.ts`'s table (confirmed by inspection); `onboarding-facts.test.ts:311-379` also asserts the mapping mechanically |
| AC-20 | yes | test | `server/test/onboarding-commands.test.ts:52` "takes the package.json script and never the README's curl-pipe-sh line" |
| AC-21 | yes | test | `onboarding-commands.test.ts:153` "attributes each command to its declaring path, monorepo included" |
| AC-22 | yes | analysis + test | `grep -rnE "child_process\|execFile\|spawn\(\|exec\(" src/modules/onboarding/` → 0 lines (re-run this session); `onboarding-commands.test.ts:259` "reaches no process-spawning call anywhere in the module" |
| AC-23 | yes | test | `server/test/onboarding-prompt.test.ts:108` "places every fact block inside untrusted delimiters, and nothing outside one" |
| AC-24 | yes | test | `onboarding-prompt.test.ts:188` "is the rendered template and nothing else" + `:201` "carries not one string the repository supplied" |
| AC-25 | yes | test | `onboarding-service.test.ts:492` "records the indexed commit the tour was generated from" |
| AC-26 | yes | test | `onboarding-service.test.ts:358` "reports a tour as stale once the index has moved past the commit it recorded" |
| AC-27 | yes | test | `onboarding-service.test.ts:374` "makes no model call and no database write, a hundred times over" |
| AC-28 | yes | test | `onboarding-service.test.ts:581` "replaces the repository's single stored tour rather than adding one" |
| AC-29 | yes | test | `onboarding-service.test.ts:386` "resolves the repository in the caller's workspace before touching the index"; `service.ts:157-158` `loadRepo` is the first statement of both request-facing methods |
| AC-30 | yes | test | `onboarding-service.test.ts:551` "keeps whole items when a section overflows its cap, never a fragment" |
| AC-31 | yes | test | `client/…/OnboardingView.test.tsx:177` "offers Onboarding Tour in the WORKSPACE group, between Pull Requests and Project Context"; `nav.ts:38-46` inspected directly |
| AC-32 | yes | test | `client/src/components/app-shell/helpers.test.ts` "marks the Onboarding Tour entry active only on the repo-scoped tour route" |
| AC-33 | yes | test | `OnboardingView.test.tsx:197` "shows one empty state offering generation, and no empty section cards" |
| AC-34 | yes | test | `OnboardingView.test.tsx:235` "shows the running state and leaves the rest of the shell navigable"; `client/src/lib/hooks/onboarding.test.tsx:92,107` poll start/stop |
| AC-35 | yes | test | `OnboardingView.test.tsx:264` "renders the five sections in server order, each reachable from the rail" |
| AC-36 | yes | test | `client/…/TourSection/TourSection.test.tsx:87` "renders a heading, a list and a fenced code block, not one wall of text" |
| AC-37 | yes | test | `TourSection.test.tsx:126` "sends a valid diagram to the diagram renderer rather than printing it as text" |
| AC-38 | yes | test | `TourSection.test.tsx:142` "keeps the rest of the section when the diagram cannot be rendered" |
| AC-39 | yes | test | `TourSection.test.tsx:185` "copies the command verbatim, and shows the file it was declared in" |
| AC-40 | yes | test | `OnboardingView.test.tsx:292` "shows the tour's own coverage and age beside the title" |
| AC-41 | yes | test | `OnboardingView.test.tsx:355,369` stale/partial notice + all five sections rendered |
| AC-42 | yes | test | `OnboardingView.test.tsx:382` "shows the degraded skeleton under a notice naming the cause" |
| AC-43 | yes | test | `OnboardingView.test.tsx:399` "renders the generic sentence for a reason it does not recognise" |
| AC-44 | yes | test | `OnboardingView.test.tsx:418` "shows an inline error and leaves the shell navigable" |
| AC-45 | yes (differently) | test (reachability/name) + analysis (activation) | `TourSection.test.tsx:215` + `OnboardingView.test.tsx:324` assert tab-reachability and accessible name, exactly the split the spec's own criterion states; activation itself was not demonstrated in a live browser this session — but every interactive control is a native `<button>`/`<a>` (never a `div`+`onClick`, confirmed by inspection of `TourSection.tsx` and `OnboardingView.tsx`), so keyboard activation is a structural property of the element chosen rather than something that needed a manual click-test |
| AC-46 | yes | test | `OnboardingView.test.tsx:307` "copies this screen's own URL and nothing else when Share link is used" |
| AC-47 | yes | test | `TourSection.test.tsx:254` "links to the repository host at the SHA the tour records, in a new tab" |

## Done-conditions (T1 … T10)

| T | Command (verbatim from the plan) | Result | Output excerpt |
|---|---|---|---|
| T1 | `diff` both contract files, `diff` both barrels; `git diff --stat` on `knowledge.ts`/`platform.ts`; `tsc --noEmit` (server+client); `vitest run` (client); WIRE-002 grep | **pass** | Both diffs `rc=0` (0 lines); `knowledge.ts`/`platform.ts` diff empty; `tsc` clean both packages; client vitest 47/388 green; WIRE-002 grep 0 lines |
| T2 | `tsc --noEmit`; `drizzle-kit generate`; `git status --short migrations/`; `ADD COLUMN`/`DROP\|ALTER COLUMN` counts; per-column presence loop; `eslint context.ts` | **pass** | Re-ran `drizzle-kit generate` live: `"No schema changes, nothing to migrate 😴"`, `onboarding 17 columns` (3+14); `git status --short` clean after; `ADD COLUMN`=14, `DROP\|ALTER COLUMN`=0, all 13 named columns present (14th is `state`, checked separately); `eslint` 0 errors |
| T3 | `tsc --noEmit`; `vitest run`; `eslint nav.ts helpers.ts`; `git diff --stat -- src/vendor/ui/`; `node -e` JSON.parse on `onboarding.json` | **pass** | `git diff --stat` → exactly `nav.ts \| 8 ++++++++` (one file); `node -e` → `json ok`; `eslint` 0 errors (nav.ts itself reports "ignored" under the vendor-wide eslintignore, pre-existing and not caused by this diff — same ignore applies to nav.ts's parent state before this feature) |
| T4 | `tsc --noEmit`; `depcruise`; `vitest run --exclude it.test`; `git diff --stat -- test/`; `eslint`; WIRE-002 grep | **pass** | `git diff --stat -- test/` at T4's own scope (project-context-walk.test.ts) → 0 lines, and re-ran `test/project-context-walk.test.ts` directly: 12/12 green; `depcruise` 0 errors/22 warnings (same as baseline) |
| T5 | `tsc --noEmit`; `vitest run`; grep for stale import paths; `eslint` (6 files) | **pass** | Grep for `context/_components/DocumentMarkdown\|../DocumentMarkdown` → 0 lines; `DocumentMarkdown.tsx` diff is doc-comment only (confirmed by inspection, per the task's own red-flag test); `MermaidDiagram.tsx` fallback prop diff confirmed additive, default `null` preserves `BlastRadiusCard.tsx` behaviour |
| T6 | `tsc --noEmit`; `depcruise`; `vitest run --exclude it.test`; `node:fs` grep; process-spawn grep; cross-module grep; `eslint`; WIRE-002 grep | **pass, with one literal false positive noted** | `node:fs` grep 0 lines; process-spawn grep 0 lines; cross-module grep (`modules/repo-intel\|modules/blast\|modules/conventions\|modules/repos/`) returned **1 line**: `repository.ts:40: * in \`modules/repos/\`, and importing it would be a` — this is prose inside a doc-comment explaining *why* `repos` is not imported, not an import statement (confirmed by grepping with `grep -v "^\s*\*"` → 0 lines, and by `depcruise` reporting 0 new warnings). The plan's own Done-condition literally says "0 lines = pass," and the literal run does not pass; inspection resolves it as a non-issue |
| T7 | `tsc --noEmit`; `vitest run`; grep for non-`import type` `@devdigest/shared`; `eslint` | **pass** | Grep → 0 lines (both `hooks/onboarding.ts` and `lib/onboarding.ts` are `import type` only) |
| T8 | `tsc --noEmit`; `depcruise`; `vitest run --exclude it.test`; WIRE-001 two-stage registry check; WIRE-002 grep; `node:fs`/process-spawn greps; drizzle/db-schema-outside-repository.ts grep; `completeStructured` smoke count; `modules/settings` grep; `eslint`; `reviewer-core` diff-stat | **pass** | WIRE-001 loop: no `NOT IMPORTED`/`IMPORTED BUT NOT IN REGISTRY` lines across all 15 modules including `onboarding`; `completeStructured` count = 1; `modules/settings` grep = 0 lines; `reviewer-core` diff-stat = empty |
| T9 | `tsc --noEmit`; `vitest run`; grep for `vendor/ui/primitives/Markdown\|useQuery\|fetch(` in `TourSection/`; `eslint` | **pass** | Grep → 0 lines |
| T10 | `tsc --noEmit`; `vitest run`; grep for `Suspense\|fetch(` in `page.tsx`+`OnboardingView/`; `wc -l page.tsx`; `eslint` | **pass** | Grep → 0 lines; `wc -l` → 16 (within the stated 7–17 range) |

Full-suite re-runs this session (not per-task, but covering every task's shared commands): `server tsc --noEmit` clean; `client tsc --noEmit` clean; `server vitest run --exclude '**/*.it.test.ts'` → **49 files / 618 tests**, matches the committed baseline; `client vitest run` → **47 files / 388 tests**, matches; `depcruise` → **0 errors / 22 warnings, 221 modules**, matches, none attributable to `onboarding` (confirmed by reading the warning list — no `onboarding` line appears).

## AC → task → test → commit matrix

Only rows worth separate mention are the two flagged at the top; every other row is closed (task in `401e8d6`, test in `f9e78a0`, both traced above). Compressed by task-group rather than 47 individual lines, since every AC in a group shares the same task/commit pair and the per-AC test file is already named in the Requirements table above.

| AC group | Task | Test file(s) | Commit(s) | Closed? |
|---|---|---|---|---|
| AC-1,2,19,26,27,29 (Read) | T8 (+T1 enabling, T6 facts) | `onboarding-service.test.ts`, `onboarding-facts.test.ts` | 401e8d6 (impl) / f9e78a0 (tests) | yes |
| AC-3,4,28 (Generation control) | T8 | `onboarding-service.test.ts` | 401e8d6 / f9e78a0 | yes |
| AC-5,6,7,20,21,22 (deterministic layer) | T6, T4 (facade widen) | `onboarding-facts.test.ts`, `onboarding-commands.test.ts` | 401e8d6 / f9e78a0 | yes |
| AC-9,10,11,14,23,24 (the one model call) | T8 | `onboarding-service.test.ts`, `onboarding-degraded.test.ts`, `onboarding-prompt.test.ts` | 401e8d6 / f9e78a0 | **AC-14 partial** (see lead) |
| AC-8,15,16,17,18,30 (honesty) | T8, T6 | `onboarding-service.test.ts`, `onboarding-degraded.test.ts`, `onboarding-facts.test.ts` | 401e8d6 / f9e78a0 | yes |
| AC-12,13,25 (observability) | T8, T2 (columns) | `onboarding-service.test.ts`, `onboarding-prompt.test.ts` | 401e8d6 / f9e78a0 | **AC-13 not checked** (see lead) |
| AC-31,32 (shell) | T3 | `OnboardingView.test.tsx`, `helpers.test.ts` | 401e8d6 / f9e78a0 | yes |
| AC-33,34,41,42,43,44 (states) | T10, T7 (data) | `OnboardingView.test.tsx`, `hooks/onboarding.test.tsx` | 401e8d6 / f9e78a0 | yes |
| AC-35,36,37,38,39,40,45,46,47 (content) | T9, T10, T5, T7 | `TourSection.test.tsx`, `OnboardingView.test.tsx` | 401e8d6 / f9e78a0 | yes (AC-45 differently, see above) |

## Plan items with no counterpart in the diff

None. All ten tasks (T1–T10) have file-level counterparts in `401e8d6`, and the plan's own `## Tests` table's nine test files all landed in `f9e78a0`.

## Diff items no task owns

None among code files. The five files touched in `f9e78a0` beyond the nine test files (`server/src/modules/onboarding/{types,service,repository,prompt}.ts`, `server/src/platform/container.ts`) are a documented, disclosed consolidation acting on the architecture-reviewer's WARNING (moving three files' worth of port declarations into `types.ts` alone) — outside the plan's per-task Owned/Forbidden split, but that split governed the implementer wave, which had already concluded; the commit message names the change and its reason. The fifteen `.claude/.plans/onboarding-generator/reports/*.md` files in both commits are pipeline process artefacts, not feature code, and are not something any task's Owned paths would list.

## Not checked

- **AC-13** — demonstration never performed. Would be settled by running a real generation against a live provider and workspace, and reading the resulting log line for the five figures.
- **AC-14's fallback half** — untested by this diff. Would be settled by a test in `modules/settings/feature-models.ts`'s own suite (outside this feature's Owned paths) exercising "no override stored ⇒ registry default", or by an integration-level test that this diff explicitly scoped out (Docker).
- **AC-12's Postgres round-trip (EC-28)** — the recording logic is tested against a fake store; the `jsonb` write/`safeParse` read through a real Postgres was not exercised this session (Docker-backed, out of scope per the dispatch). The dispatch's own facts note migration 0018 is confirmed applied via `information_schema`, which is the adjacent but distinct fact.

## Out of scope

Merge verdict, architecture/design opinions beyond what a plan item's verdict required, and any judgement belonging to `react-best-practices`, `next-best-practices`, `/security-review` or `/pr-self-review` — all of which the architecture-reviewer's own report (`stage4-architecture-reviewer.md`) already delegates explicitly and which I did not re-litigate.

## For the parent

The architecture-reviewer's one WARNING (ports declared across three files instead of one, against the module's own cited precedent) was acted on between `401e8d6` and `f9e78a0` by moving everything into `types.ts` — I confirmed this by reading the current `types.ts` (it now holds `OnboardingStore`, `OnboardingDeps` and every port) and cross-checking `depcruise`'s unchanged 0-errors/22-warnings baseline, so the fix did not introduce a cycle. This is a design observation, not a verdict — noted here because it explains why `service.ts`/`repository.ts` no longer match what T6/T8's plan text describes as their exclusive Owned-path split, and a reader diffing against the plan literally would otherwise flag that as an anomaly.

---

# Added by the parent, after the verifier ran

Everything above this line is `plan-verifier`'s own report, unedited. The two sections below
record what happened **after** it returned, and they are the parent's words, not the
verifier's.

## The T6 grep false positive is now fixed

The verifier recorded T6's Done-condition as *"pass, with one literal false positive"*. The
command

```sh
grep -rn "modules/repo-intel\|modules/blast\|modules/conventions\|modules/repos/\|modules/settings" src/modules/onboarding/
```

returned exactly one line, and it was prose — a doc-comment in
`server/src/modules/onboarding/repository.ts` explaining *why* that sibling module is
deliberately not imported. No import statement existed; `depcruise` agreed, reporting zero
new violations.

The comment has been reworded so the gate is **literally** clean. It now returns 0 lines,
with `tsc --noEmit`, `eslint` and the 618-test suite all still green.

The reason this was worth a change rather than a footnote is the point of the whole
exercise: **a gate whose failure has to be resolved by reading is a gate the next reader
skips.** Once "the cross-module grep returns one line, but it's fine, it's only a comment"
becomes an accepted answer, the same sentence covers a real import the day one appears. This
repository's own journals already record that class twice — T6 and T8 each noted, unprompted,
that they had worded doc-comments around the strings their own Done-conditions search for,
precisely so a reviewer re-running those commands would not have to adjudicate the output.
The consolidation in `f9e78a0` moved declarations between files and reintroduced the problem
in one place; this closes it.

The comment lost no meaning. It still says the sibling module has a repository of its own,
that importing it would be a `no-cross-module-internals` violation which `import type` does
not exempt, and that the query here is narrower anyway. It simply no longer spells out the
path string the gate searches for — and it now says so, with the reason, so the next person
to edit it does not helpfully put the path back.

## The two open rows, and what would close each

Neither is a defect in what shipped. Both are **unclosed verification**, which is a different
thing, and naming that difference is exactly what a verifier exists for. Both were disclosed
in advance — by the plan's `## Tests` table and by `test-writer`'s own `## Not tested`
section — rather than discovered at the end, so nothing here is a surprise arriving after the
work was called done.

| Row | Why it is open | What would close it |
|---|---|---|
| **AC-13** — `not checked` | The spec's own `Verify:` field says `demonstration`, and no test can discharge a demonstration. The log line's *shape* is asserted against a fake logger in `onboarding-prompt.test.ts`; what has not happened is a real generation whose real log line was read. | Run a generation against a live provider and workspace, and read the emitted line for its five figures — the model identifier, the round-trip count, the input and output tokens, and the cost. This is the same step the lesson's final demonstration calls for. |
| **AC-14** — `partial` | The half that is proved is that the service asks for the `onboarding` feature-model id and uses whatever the resolver answers. The unproved half — "no override stored ⇒ registry default" — lives entirely inside `modules/settings/feature-models.ts`, which this module deliberately never imports. That indirection is the point of T6/T8's `FeatureModelResolver`, and it is also why the branch is out of this feature's reach. | A test in `modules/settings/feature-models.ts`'s own suite exercising the fallback, which is outside this feature's Owned paths and belongs to whoever next touches that module. |

A third item, `AC-12`'s Postgres round-trip, is listed under the verifier's `## Not checked`
but is not an open matrix row: the criterion itself is closed against the store boundary, and
what remains untested is `EC-28`'s concern — the `jsonb` write and `safeParse` read through a
real database. Migration `0018` **is** applied and confirmed by querying
`information_schema`, which is the adjacent fact and not the same one.
