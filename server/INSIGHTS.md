# server — engineering insights

Append-only journal for `@devdigest/api`. Seven fixed sections; newest entry at the
bottom of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or
  already stated in `CLAUDE.md` / `README.md` / `../TESTING.md`.
- **Substantial.** Record what cost real time or would mislead the next reader. Not:
  code structure that is plain from reading it, style nits, linter-catchable issues,
  or facts true only inside one session.
- Nothing substantial this session → write nothing. That is a valid outcome.

## Entry format

One bullet per insight, appended under the one section it belongs to:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `src/path/file.ts` (`functionName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

Replacing a section's `_No entries yet._` placeholder on first append is expected — it is
not an entry.

The skill that maintains this file: `.claude/skills/engineering-insights/`.

---

## What Works

Approaches and solutions that worked and should be reused.

<!-- append below -->

- **2026-08-20** — **A fake whose every port method defaults to a thrower is the only way to
  prove a negative like "this path reads no bytes and resolves no clone".** `unreachable(name)`
  as the default body of each method on a port fake turns an absence into a failing test that
  names the offending call, where an assertion over the *result* can only say the answer looked
  right. Used to pin that `ProjectContext.listEffectiveDocs` performs no `repoDocs.read` and
  resolves no repository name; mutation-verified by inserting one `read` call, which turned two
  tests red. Reusable for any port-based module that promises "this path performs no I/O" —
  the promise is otherwise only a comment. Evidence:
  `test/project-context-effective.test.ts` (`unreachable`, `reader({})`),
  `src/modules/project-context/service.ts` (`listEffectiveDocs`).

- **2026-08-20** — **A `200` on a new route is only evidence of registration if the `404` path
  is checked too, and the two are distinguishable in one extra request.** An unregistered module
  and a registered one both answer `404` for a nonexistent id — but only the registered one
  answers with the service's own envelope, `{"error":{"code":"not_found",…}}`, rather than
  Fastify's route-not-found. So one `curl` against a made-up uuid turns "the route answered" into
  "the handler ran and the workspace resolution executed". Worth pairing with the 2026-08-19
  status-code triage in this file (`404` = unregistered, `500` = migration unapplied): that entry
  tells you what a failure means, this one tells you what a success does **not** yet mean.
  Evidence: `src/modules/brief/routes.ts`, `src/modules/index.ts`.

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

- **2026-08-25** — **A whole-file `grep` Done-condition flags the doc-comment that documents
  the very absence the gate enforces — so the better the code is commented, the redder the
  gate — and it happened THREE times in one plan.** Extends 2026-08-19 in this section, which
  prescribes scoping a gate to import statements; this is the inverted shape that entry does not
  cover, and it now reaches the client too. Measured on the Export-to-CI plan: `grep -arn
  "EventSource" src/lib/hooks/ci.ts` hit a comment stating the hook deliberately opens none;
  `grep -arnE "…Suspense…" src/app/ci-runs` hit a header comment stating why there is no
  boundary; and AC-45's `reviewer-core` purity grep was **red on a clean base** on
  `llm/structured.ts:2` (`openai/helpers/zod`, a schema helper that makes no call, present
  since `b86cdee`). Two implementers independently refused to reword the prose and cited
  2026-08-19 back at the plan, which is the correct response and is why nothing was bent.
  Three rules follow. Scope the pattern to code (`new EventSource\|EventSource(`,
  `^\s*import .*Suspense`), never to a bare name. A gate over a *package you do not own*
  needs its exceptions measured on the base commit first, or it is red on arrival and stops
  being read (`../reviewer-core/INSIGHTS.md`, 2026-08-23). And carve out a **named pair**
  rather than a directory — `llm/(openrouter|structured)\.ts`, not `llm/`, or a real provider
  call in a future file there passes unnoticed. Evidence:
  `../.claude/.plans/export-to-ci/plan.md` (the three corrected Done-conditions),
  `../reviewer-core/src/llm/structured.ts:2`, `../client/src/app/ci-runs/page.tsx:7`.

- **2026-08-25** — **An acceptance criterion can demand more distinct outcomes than its
  input is capable of producing, and only a written test finds it.** SPEC-05's AC-24 requires
  four *distinct* named reasons across four unreadable-artifact cases — but an expired artifact
  and a cancelled run that uploaded nothing both arrive at the decoder as the **identical
  `null` bytes**, so any function of those bytes can produce at most three. The first run of
  `test/ci-ingest.test.ts` failed on exactly that (3 distinct where 4 were asserted), which is
  the only reason it was caught; every gate was green and a reviewer reading the code would
  have agreed with it. The fix keeps the decoder honest — `modules/ci/artifact.ts` stays a pure
  function of bytes with the four byte-derived reasons — and adds
  `reasonForMissingArtifact(reason, conclusion)` above it, refining `artifact_missing` to
  `run_cancelled` from the **workflow run's own conclusion**, the one source that can tell them
  apart. Generalises: when a criterion says "each with its own distinct reason", ask which
  *input* carries the distinction before implementing it, and assert the reasons are
  **pairwise different** rather than merely present — an assertion that each case yields *a*
  reason passes with one catch-all. Evidence: `src/modules/ci/artifact.ts`
  (`readResultArtifact`, `reasonForMissingArtifact`), `test/ci-ingest.test.ts`.
- **2026-08-25** — **`@fastify/rate-limit` is not registered at all under `NODE_ENV=test`, so a
  test asserting a per-route `config.rateLimit` passes with the declaration DELETED.** `src/app.ts`
  guards the `app.register` on `config.nodeEnv !== 'test'`, which makes the per-route config inert
  and the assertion vacuous — the same class of false green as the 2026-08-20 injection-defence
  entry, and invisible for the same reason: the test exercises the mechanics around the thing
  rather than the thing. What works, and stays hermetic: build the app with
  `NODE_ENV=development` + `LOG_LEVEL=silent`. The limiter runs in `onRequest`, **ahead of
  validation**, so ten deliberately-invalid requests and then a `429` exercise the limit without a
  handler, a service or a query ever running. Evidence: `src/app.ts` (the guarded register),
  `test/reviews-multi-run.test.ts` ("the per-route rate limit").

- **2026-08-20** — **A test suite that checks WRAPPING MECHANICS is not evidence of an
  injection defence, and the gap is measurable: 9 of 10 passed with the defence deleted.**
  Measured on the PR Brief prompt — with the `## SECURITY` section removed from
  `src/prompts/brief.system.md`, every block was still wrapped exactly once, the system message
  still carried no foreign text, and the token budget still held; only the one assertion written
  against the *rendered clause* failed. Delimiters are inert without a sentence telling the model
  what they mean. The compounding fact is what makes this reachable rather than theoretical:
  `INJECTION_GUARD` is a module-private, **non-exported** const at `../reviewer-core/src/prompt.ts`
  and is concatenated only inside `assemblePrompt`, so any module that builds its own messages —
  which a feature module must, because `platform/prompts.ts` is the only loader it may use — reaches
  no shared guard and there is **nothing to duplicate**. A plan that says "do not duplicate the
  guard" will be read as "the guard is handled". Carry the clause in the template, the shape
  `src/prompts/onboarding.system.md` already uses, and assert on the rendered system message
  rather than on the file's existence. Related: 2026-08-05, Codebase Patterns, for where the
  trust decision lives. Evidence: `src/prompts/brief.system.md`,
  `src/modules/onboarding/prompt.ts` (its header states the same reasoning),
  `test/brief-prompt.test.ts`.

- **2026-08-20** — **Adding a REQUIRED field to a `vendor/shared` contract has a blast radius
  that `tsc --noEmit -p tsconfig.json` reports only two thirds of — and one site is invisible to
  every typechecker there is.** Measured over two remediation rounds on `BriefDiffStats`: of eight
  breaking sites, 3 were in `src/`, 2 in `server/test/` (visible only under `tsconfig.eslint.json`,
  per 2026-08-10 in Tool & Library Notes), 3 in `client/**/*.test.tsx` (visible only to the client's
  own `tsc`) — and a ninth was `expect(x).toEqual({…exhaustive object})`, which **no** typechecker
  reports because `toEqual`'s parameter type accepts a wider object while the assertion itself
  demands an exact match. It fails at runtime only. This is the mirror image of the 2026-08-10
  entry: that one is a fixture structurally wrong that *never* fails; this is an assertion
  structurally accepted that *always* fails. Before scoping a contract-field change, grep every
  construction site across **both** packages and every `toEqual` over the type — a scope drawn from
  `tsc -p tsconfig.json` alone will be wrong by a third. Evidence:
  `src/modules/brief/assemble.ts` (the `diffStats` literal), `test/brief-assemble.test.ts`
  (the two `toEqual` blocks), `../client/src/lib/hooks/brief.test.tsx`.

- **2026-08-19** — **A `grep`-based Done-condition that passes on zero lines is failed by a
  DOC-COMMENT, and the pressure that creates is to bend the code around a text search.**
  Measured across the Onboarding Generator's ten tasks. The gates are
  `grep -rn "node:fs" src/modules/<name>/ # 0 lines = pass` and
  `grep -rnE "child_process|execFile|spawn\(|exec\(" # 0 lines = pass`. Written the plain
  way, prose explaining *why* this module does not import Node's filesystem module returned
  six comment hits, and `RegExp.prototype.exec` returned two — output an implementer cannot
  distinguish from a real violation. Two implementers independently responded by wording
  every doc-comment around the forbidden strings, and one wrote `String.prototype.match`
  where `.exec()` was natural. The prose half is fine and `modules/project-context/types.ts`
  already did it ("Node's own filesystem module"); the API half is the line — a control-flow
  or API choice made to satisfy a text search is a finding, and it was only harmless here
  because neither regex carries `/g`, so the two calls are behaviourally identical. The same
  gate then failed again at verification time on a *different* file, because a consolidation
  moved a comment naming `modules/repos/` into a directory the gate scans. Two rules follow:
  when adding a grep gate over a directory, scope it to import statements (or exclude
  comment lines) rather than to the whole file; and when one fires, fix the prose rather
  than annotating the gate as a known false positive — a gate whose failure has to be
  resolved by reading is a gate the next reader skips. Evidence:
  `src/modules/onboarding/repository.ts` (the reworded sibling-module paragraph),
  `src/modules/onboarding/commands.ts` (`line.match(MAKE_TARGET)`),
  `.claude/.plans/onboarding-generator/plan.md` (T6 and T8 Done-conditions).

- **2026-08-11** — **Ranking a derived list by SIZE inverts the feature whose whole purpose
  is that size is not importance.** Smart Diff's split suggestion bucketed the changed files
  and sorted the buckets by changed lines, which is the obvious ordering and reads fine in
  isolation. On the demo PR it put "Generated, tests & lock files" (940 lines) above
  "Core: src/api" (300), so a too-big PR was advised to split its **lock file** out first —
  the exact inversion the classifier exists to correct, produced by the one part of the
  feature that had not been told about roles. Nothing else caught it: the partition
  invariant held, every bucket was correct, and the totals were right. The fix is to sort by
  ROLE first and only then by size, so the advice reads in the same order as the groups above
  it. Generalises to any list this codebase derives from a mix of signals — if one signal is
  the feature's thesis, it has to be the primary sort key, not a filter applied elsewhere
  (here the roles only gated the `too_big` THRESHOLD, which felt like enough and was not).
  Evidence: `src/modules/smart-diff/split.ts` (`buildSplitSuggestion`, the `ordered` sort),
  `test/smart-diff-split.test.ts` ("orders splits by role first").

- **2026-08-11** — **A fixture that reports its own size will lie for months, and changing
  what a fixture CONTAINS silently invalidates every other fixture that describes it.** Two
  halves, both found while giving `SEED_PR_FILES` real patch text. (1) `pull_requests` for PR
  #482 hand-wrote `additions: 247, deletions: 38, filesCount: 9` over four `pr_files` rows
  that summed to `126 / 8`. No gate, screen or test compares the two, so the PR header
  contradicted the file list below it indefinitely; counting `+`/`-` lines out of each patch
  and summing the rows for the PR row removes the whole class. (2) The knock-on was the
  expensive part: `seedPrIntent` is a hand-written record of what a real derivation *would*
  have produced, so adding patches made three of its claims false at once — a real
  `collectSources` would now read a `hunk_headers` source (+0.05 weight → confidence
  `0.40 → 0.45`), its `missing_context` line "No hunk headers were available" became
  untrue, and its comment explaining the absent `deps` risk stopped applying now that
  `package.json` is in the file list. One of those is asserted by a browser flow, so the
  seed edit reached `e2e/specs/11-pr-intent.flow.json` too. Before editing seed MATERIAL,
  grep the seed for every fixture derived from it and ask what each one now claims.
  Evidence: `src/db/seed.ts` (`SEED_PR_PATCHES`, `countChanges`, `SEED_PR_TOTALS`,
  `seedPrIntent`), `test/seed-pr-fixture.test.ts`.

- **2026-08-06** — **`ORDER BY <score> DESC` with no tiebreaker reads as a UI feature, and
  the report will be "the row I clicked moves down the list".** `listCandidates` ordered on
  `confidence DESC` alone, and conventions tie constantly — a measured 62/62 is `1.0`, so is
  the next one — so tied rows came back in whatever physical order the scan read them.
  Accepting a candidate UPDATEs its row, Postgres writes a new tuple version elsewhere in
  the heap, and on the next refetch that card had slid down its tie group. The user
  reported it as a deliberate "triaged items sort to the bottom" behaviour and asked for
  the feature to be removed; there was no feature. It is also **intermittent** — a HOT
  update can keep the tuple in place, and once a row has moved it tends to stay — so "it
  stopped happening" is not evidence it is fixed. Any list a client renders in order needs
  a **total** order: `desc(confidence), asc(createdAt), asc(id)`. Note `createdAt` alone is
  not enough here, because `insertCandidates` writes every candidate of a scan in one
  statement and `now()` is transaction-scoped, so they all share a timestamp. A regression
  test must assert the returned ids equal the *sorted* ids (asserting only "unchanged after
  an update" passes without the fix); verified by reverting the `orderBy` — the test fails,
  and passes again with it. Evidence: `src/modules/conventions/repository.ts`
  (`listCandidates`, `insertCandidates`), `src/db/schema/knowledge.ts` (`conventions`),
  `test/conventions.it.test.ts` ("keeps tied candidates in a fixed order").

- **2026-08-06** — **Counting rule adherence with `CodeIndex.grep` does not scale, and
  tuning batch size against a live provider does not converge.** Two abandoned approaches
  from the conventions extractor, both reasonable-looking:
  (1) One `grep` per pattern meant up to sixty walks of the clone in one scan. On a real
  26-file repository that alone consumed the whole time budget, because the clone also
  contained a committed `.pnpm-store` of thousands of files that `RipgrepCodeIndex`'s
  `IGNORE_DIRS` does not list and the walk had no reason to visit. Counting over the corpus
  the scan has already read in memory is both faster and more defensible — the denominator
  becomes the indexed, rank-filtered source, which is the only body of code a house rule
  can be said to hold across. A package cache is not one.
  (2) Fitting N model calls into `JobRunner`'s fixed 120s by choosing a batch size:
  concurrency 4 (three waves) and 5 (two waves) were each measured, and each both fit and
  overran on different runs of the SAME repo and model. A wave-level deadline then made it
  worse — one slow call discarded four good answers, and on the slow end the scan returned
  nothing at all. What works is per-CALL deadlines plus maximum concurrency: every call
  gets the full remaining budget, whatever answers in time is kept, and the scan reports
  `partial`. Don't predict provider latency; bound it.
  Evidence: `src/modules/conventions/adherence.ts` (`corpusCounter`),
  `src/modules/conventions/service.ts` (the extraction loop),
  `src/adapters/codeindex/ripgrep.ts` (`IGNORE_DIRS`).

- **2026-08-13** — **`ReviewRunResponse`'s doc-comment states the run is synchronous and that
  the persisted reviews come back with it. Both claims are false, and the file cannot be
  fixed.** `POST /pulls/:id/review` is fire-and-forget: `runReview` creates the `agent_runs`
  rows, fires `void this.executor.executeRuns(...)` and returns immediately, so `reviews` in
  that response is **always `[]`**. The comment at `contracts/review-api.ts:40-44` says the
  opposite ("The persisted reviews are also returned once the (synchronous) run completes"),
  and it is the single most expensive sentence in the contract for a new consumer — it invites
  "just read `reviews` off the POST response", which returns an empty array forever with no
  error. `src/vendor/shared/**` is a do-not-touch cross-package contract, so the comment stays
  wrong; this entry is the correction. Any consumer must do create → poll
  `GET /pulls/:id/runs` → read `GET /pulls/:id/reviews`. Evidence:
  `src/modules/reviews/service.ts` (`runReview`), `src/vendor/shared/contracts/review-api.ts`.

- **2026-08-13** — **`GET /pulls/:id/runs` does not check that the pull request exists — it
  answers `200 []`** — so a polling loop keyed on "no runs have appeared yet" spins forever
  against a typo'd or deleted `pr_id` and never errors. `listRunsForPull` is a plain
  `where(eq(agentRuns.prId, id))`, and an empty result is indistinguishable from "the PR is
  not there". Key the loop on the **specific `run_id` returned by the POST** instead, and stop
  after a bounded number of consecutive absences with a report; the run id is the only value
  whose disappearance means something definite. Evidence:
  `src/modules/reviews/repository/run.repo.ts` (`listRunsForPull`),
  `src/modules/reviews/routes.ts`.

- **2026-08-03** — Deriving a **PR-level** figure from the newest **single** row per PR is
  wrong by construction on this schema: one review fans out over N agents and `runOneAgent`
  writes one `agent_runs` row *and* one `reviews` row **per agent**, so the PR list's
  "latest review's score / latest done run's cost" only ever showed whichever agent finished
  last (on real dev data, PR #1 had 6 done runs and the COST column reported $0.00064 of
  $0.0051). Aggregate across agents instead — sum cost, take the **min** score — over each
  agent's newest row, so re-running one agent replaces its figure instead of doubling it.
  `pickLatestPerPr` (see 2026-08-02, Recurring Errors) no longer exists;
  `groupLatestPerAgent` / `sumCosts` / `minScore` replace it in the same file. Evidence:
  `src/modules/pulls/latest.ts`, `src/modules/reviews/run-executor.ts` (`runOneAgent`).

- **2026-08-14** — **A per-LINE regex scan cannot see this repository's own route
  declarations, and it emptied half a feature while every gate stayed green.**
  `extractEndpoints` split the file and matched each line, so the verb and the path had to
  share one. Prettier formats every `modules/*/routes.ts` here as `app.get(\n  '/path',`, so
  none of them ever matched. Measured on the real index of this repo: **21 files carried
  endpoint facts and all 21 were client hooks** (`api.get(\`/agents\`)` fits on a line), while
  all 10 server route files carried none — i.e. `file_facts` described the API's consumers and
  not the API. Blast Radius reads those facts, so its endpoint column was empty on real data
  while returning correct callers, which is the worst shape for a bug: the feature looks
  half-working rather than broken. Nothing caught it because `test/extract.test.ts`'s fixture
  is single-line, and the patterns already contained `\s*` — only the loop was wrong. Two
  things to carry forward: scan whole files (`matchAll`) and keep the "only whitespace between
  the call and a literal" rule, which is what keeps a computed path from being reported as a
  fact; and remember the fix does not reach anyone without `INDEXER_VERSION`, because the
  facts are re-extracted only on a version mismatch. Evidence:
  `src/adapters/codeindex/extract.ts` (`extractEndpoints`),
  `src/modules/repo-intel/constants.ts` (`INDEXER_VERSION`, 2 → 3),
  `test/extract.test.ts` ("path is on the NEXT line").

- **2026-08-14** — **An early-return path that omits optional metadata makes a correct
  consumer report the wrong status, and the consumer is not the bug.**
  `tryPersistentBlast` has a second return for "the changed files declare no symbols" that
  returned `{ changedSymbols, callers: [], impactedEndpoints: [], degraded: false }` — no
  `indexStatus`, no `indexedSha`. The blast module derives `ok` / `partial` / `degraded` from
  that field and, given nothing, refuses to claim completeness it was not shown — so a repo
  with a **full** index answered `partial / index_missing` for any docs-only or config-only
  PR. Found only on real data (a 2-file PR against a 312-file indexed repo); every hermetic
  test passed, because they all exercised the main return. The same return also skipped the
  reverse graph walk, so a config file that a router imports reported no impact at all. Rule
  for any facade with several exits: if a consumer branches on an OPTIONAL field, every exit
  must set it — an absent value is not a neutral default, it is a third state the consumer has
  to invent a meaning for. Evidence: `src/modules/repo-intel/service.ts`
  (`tryPersistentBlast`, the `nameSet.size === 0` return), `src/modules/blast/service.ts`
  (`statusOf`), `test/repo-intel-blast.test.ts` ("still reports coverage when the changed
  files declare no symbols").

- **2026-08-14** — **A cap applied to a MERGED list is not the per-group cap it reads as, and
  the false negative it produces is indistinguishable from a true one.**
  `getBlastRadius` ended `callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the whole
  flat list, where the constant says *per symbol*. One popular helper with 25 callers consumed
  the entire budget, and every other changed symbol in the same PR rendered as "no callers" —
  which looks exactly like a symbol nobody calls. Group first, cap each group, and take the
  pre-cap count BEFORE the slice so the response can say "14 callers" over a shorter list
  honestly. The same list also sorted on `rank DESC` alone, the shape the 2026-08-06 entry in
  this section describes for `listCandidates` — but here it is worse than a wobbling order,
  because the list is then TRUNCATED, so a tie decides which callers a reviewer is shown at
  all, and ties are the norm (every unranked file shares `0`, and the whole fallback path is
  `rank: 0`). Both were verified by mutation: reverting the cap turns 1 test red, reverting
  the tiebreakers 2. Evidence: `src/modules/repo-intel/service.ts` (`tryPersistentBlast`,
  `compareCallers`), `test/repo-intel-blast.test.ts` ("keeps the quiet symbol's callers").

- **2026-08-14** — **A reverse-reachability walk is correct to exclude its own seeds, and that
  correctness is exactly what loses the most direct impact of all.** The blast walk seeds
  `seen` with the changed files so a changed file is never reported as its own dependent —
  right, and non-negotiable. But on a real PR that edited `agents/helpers.ts` **and**
  `agents/routes.ts`, that meant every endpoint the diff literally rewrites was absent from
  the map while endpoints two hops away were present. Symbol-caller attribution did not cover
  it either, because the symbols lived in the *other* changed file. So a reachability feature
  needs a **depth-0 term** — the seeds' own facts, collected separately (`changedFileFacts`)
  and merged with a shallowest-depth-wins dedup — plus a map-level union for impact that
  belongs to the PR rather than to any one symbol, or the headline count and the tree below it
  disagree. Related: endpoints sourced from test files must be dropped at this layer, because
  `extractEndpoints` cannot tell "declares this route" from "calls it" and an `.it.test.ts`
  therefore records the API it exercises. Evidence: `src/modules/repo-intel/service.ts`
  (`reverseImpact`, `ownFacts`), `src/modules/blast/service.ts` (`mapLevelImpact`,
  `isTestPath`), `specs/blast-radius.md`.

- **2026-08-19** — **A directory walk that skips every symlink passes an "escaping symlink is
  not listed" test for the wrong reason, and the test cannot tell the difference.** The
  confinement re-check never fires, so the assertion is satisfied by the blanket skip rather
  than by the defence it is supposed to pin — and the defect only surfaces the day a symlink
  *inside* the clone stops being listed, which no test would then be watching. The escape case
  alone is therefore not a test of confinement; it needs its **pair**, an in-clone symlink that
  must still appear. Same shape as any negative-only assertion over a security check: assert
  what must be refused **and** what must be allowed, or a `return false` at the top of the
  function is a passing implementation. Evidence:
  `src/adapters/git/confined-doc.ts` (`collectCandidates`, the `isSymbolicLink` branch, and
  `resolve`, which is what actually decides), `test/project-context-walk.test.ts`
  ("omits a symlink that escapes the clone" + "keeps a symlink that stays inside the clone").

- **2026-08-19** — **An acceptance criterion whose *observable* omits a case makes that case
  invisible to every downstream check, and the implementation will be correct against the
  spec while being wrong against the requirement.** Project Context's AC-1 said "a recursive
  walk of the configured search roots" and illustrated it with `specs/a.md`, `docs/sub/b.md`,
  `src/c.md`, `pkg/INSIGHTS.md` — no case for a root nested under a package. So the walk was
  built to match a root as a **top-level prefix**, the tests were written from the observable
  and passed, and `plan-verifier` correctly returned `yes`. Measured on this repository, whose
  own `CLAUDE.md` requires every package to keep its own `specs/` and `docs/`: **17 documents
  returned where 25 exist**, the eight missing being every per-package `specs/README.md` and
  `docs/README.md` — the exact class the feature exists to attach. The originating requirement
  had said `**/{specs,docs,insights}/**/*.md`; the narrowing happened in the spec and nothing
  downstream could question it, because a spec's examples become the tests. Two things to
  carry: when a criterion enumerates examples, ask which case is **absent** rather than
  whether the listed ones pass; and a rule about paths needs a case at depth, because
  top-level and nested are different code paths in every implementation of it. The fix has to
  land in **both** the walk (`isUnderRoot`) and the grouping (`classifyDoc`) or a listed
  document reports a root it was not found under. Evidence:
  `src/adapters/git/confined-doc.ts` (`isUnderRoot`),
  `src/modules/project-context/service.ts` (`classifyDoc`),
  `test/project-context-walk.test.ts` ("matches a root at any depth"),
  `../specs/project-context.md` (AC-1, amended).

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

- **2026-08-25** — **This module has one deliberately SYNCHRONOUS long-ish route, and the rule
  that makes it different from every fire-and-forget one is worth stating: a route may await
  the work when the work is one model call AND there is no row the answer could be read back
  from.** `POST /eval/agents/:agentId/trial-runs` runs a single unsaved eval case and returns
  its outcome inside the request, where `POST /eval/agents/:agentId/batches` answers `202` with
  a `running` batch and `POST /pulls/:id/review` returns before its first finding exists
  (2026-08-13, this file). The difference is not "how long" — it is that a batch and a review
  both WRITE rows a client can poll, so returning early costs nothing, while a trial run
  persists nothing by design (that absence is its whole point: pressing `Run case` four times
  must not move the agent's recall four times) and an early return would throw the only copy of
  the answer away. It is bounded by one `CASE_DEADLINE_MS` (120 s), not by `BATCH_DEADLINE_MS`
  (15 min), which is what keeps it defensible. Before making a new eval route async "for
  consistency", check which of those two it is. Evidence: `src/modules/eval/routes.ts`
  (`/trial-runs`), `src/modules/eval/runner.ts` (`runTrial` vs `start`),
  `src/modules/eval/constants.ts` (`CASE_DEADLINE_MS`).


- **2026-08-24** — **Deleting every `reviews` and `agent_runs` row for a repo does NOT reset its
  pull requests to `needs_review` — the list status is DERIVED from
  `pull_requests.last_reviewed_sha`, which no delete touches.** `deriveReviewStatus` compares
  that column against `head_sha` and never reads a review row, so a wipe that misses it leaves
  the whole list showing `reviewed`/`stale` with no score, no cost and no findings behind it —
  the one state the screen cannot otherwise reach. The column survives because it has a single
  writer (`markReviewed`, called on the run's success path) and neither an FK nor a cascade
  pointing at it. A demo reset for one repo is therefore four statements, not two: delete
  `reviews` by `pr_id` (findings cascade via `findings.review_id`), delete `agent_runs` by
  `pr_id` (`run_traces` + `run_skills` cascade), delete `pr_intent` / `pr_brief` if the
  derivations should re-run, then `UPDATE pull_requests SET last_reviewed_sha = NULL`. Two
  things that look wrong afterwards and are not: closed PRs still read `Closed`, because the
  `pull_requests.status` column is GitHub's merge state and `deriveReviewStatus` returns it
  untouched; and `eval_cases` survive the findings they came from by design
  (`source_finding_id` carries no FK, `schema/eval.ts`). No API restart is needed — unlike the
  re-seed case in Recurring Errors (2026-08-06), the workspace row is not recreated, so the
  memoised `currentWorkspace` stays valid. Evidence: `src/modules/pulls/status.ts`
  (`deriveReviewStatus`), `src/db/schema/pulls.ts` (`lastReviewedSha`),
  `src/modules/reviews/repository/pull.repo.ts` (`markReviewed`).
- **2026-08-28** — **A multi-agent group is NOT identified by its file and line, and a
  persisted record keyed that way silently merges groups.** `SPEC-05`'s `EC-9` allows two
  groups at one file and line differing only in their titles — two agents flagging
  intersecting ranges with unrelated titles do not cluster — while `EC-32` asserts the
  opposite in one sentence, and the code followed the sentence. `GroupLabel` and
  `StanceNote` were stored as `(file, line, …)`, so on a real run three groups sharing
  `test/tasks.test.ts:70` all rendered the SAME synthesised heading while two of the three
  labels sat unused in the blob, and the client was handed three identical React keys. The
  key now carries the group's **deterministic fallback title** (`AC-31`), which both sides
  already held and neither persisted. Prefer a CONTENT key over a positional one here: if
  the grouping rule changes, a content key stops matching and the group keeps its fallback
  title — a state the read already renders (`AC-38`) — whereas an index would attach a
  label to the wrong group with no signal at all. Same shape as the 2026-08-03 entry above
  (a per-agent `Map` keyed on a nullable `agent_id` collapses every agent-deleted row into
  one bucket): the bug is always "the natural key is not unique and nothing says so".
  Evidence: `src/modules/multi-agent/helpers.ts` (`mergeSynthesis`),
  `src/modules/multi-agent/schemas.ts` (`GroupLabel`), `test/multi-agent-read.test.ts`.

- **2026-08-23** — **`AgentsRepository.snapshotVersion` re-reads `skillIdsForAgent(row.id)` from
  INSIDE `update`, so a caller that wants the new version's snapshot to record a particular skill
  set must write the links BEFORE calling `update`.** Writing them after leaves the snapshot
  carrying the *previous* set while every assertion about the agent's live links still passes — a
  bug that survives a green suite. Found making version promotion restore the promoted version's
  ordered skill ids: moving the `setSkills` call after `update` turned exactly two tests red, one
  of them the ordering assertion, and a fixture whose two sets differ only in *membership* would
  not have caught it. Related, and what makes "promotion always yields a higher version" true even
  when the promoted config equals the current one: `isConfigChange` treats any **defined**
  `outputSchema` in a patch as a config change. Evidence:
  `src/modules/agents/repository.ts` (`snapshotVersion`), `src/modules/agents/service.ts`
  (`promoteAgentVersion`), `src/modules/agents/helpers.ts` (`isConfigChange`).

- **2026-08-20** — **A feature module cannot use `node:crypto`, and the two files that appear to
  prove otherwise are the named infrastructure exception.** The `modules/<name>/` grep gates ban
  every `node:` import specifier, not only the filesystem one the 2026-08-10 entry in Tool &
  Library Notes is about — so a feature needing a digest has exactly two honest options: declare
  a port for the composition root to satisfy, or hand-roll a pure one and state its scope.
  `modules/repo-intel/pipeline/full.ts` and `.../incremental.ts` do call `createHash('sha1')`,
  which reads as a precedent and is not one: `repo-intel` is carved out in
  `.dependency-cruiser.cjs` as infrastructure reached only through `container.repoIntel`. The PR
  Brief's cache key took the second option — a non-cryptographic change detector, with the file
  header saying so, because nothing is authenticated by it and a collision costs one stale brief
  that the force path clears. Check which side of that carve-out a file is on before copying its
  imports. Evidence: `src/modules/brief/cache-key.ts` (`computeCacheKey`),
  `src/modules/repo-intel/pipeline/full.ts`, `.dependency-cruiser.cjs`.

- **2026-08-19** — **This server has TWO prompt-template renderers and they disagree about
  what a missing variable does, silently.** `modules/conventions/prompt.ts`'s
  `renderTemplate` replaces an unmatched `{{name}}` with the **empty string**;
  `platform/prompts.ts`'s replaces nothing and leaves the literal `{{name}}` in the prompt.
  A feature that copies the conventions shape — the obvious precedent, since it is the one
  with a worked example — and then switches to the platform loader (which it must, because
  the module-local one imports Node's filesystem module and a feature module may not) has
  changed what a missing variable sends to the model, with no type error and no gate.
  Neither behaviour is wrong; not knowing which one you have is. Check which loader you
  hold before relying on a placeholder being optional, and supply every variable regardless.
  Evidence: `src/modules/conventions/prompt.ts` (`renderTemplate`), `src/platform/prompts.ts`
  (`renderTemplate`), `src/modules/onboarding/prompt.ts` (the consumer that switched).

- **2026-08-19** — **Inside a module, WHICH file a port lives in is decided by the direction
  of the existing type-only edges, not by taste — and `dependency-cruiser` counts a
  type-only edge.** Two instances, one week apart, same mechanism. A facade row type that
  reuses `IndexerFileFactsRow` from `repo-intel/repository.ts` cannot live in
  `repo-intel/types.ts`, because `repository.ts` already imports `./types.js` — so the
  facade declares its own mirror row instead, which is what that file's header already
  asks for. And consolidating the onboarding module's ports into `types.ts` could not
  leave `TokenCounter` in `prompt.ts`: `prompt.ts` imports `OnboardingFacts` from
  `types.js`, so `OnboardingDeps.tokenizer` importing the type back would have closed a
  cycle and moved the 22-warning baseline. The port has to move **with** the deps
  interface, never be imported by it. Generalises: before placing a shared type, check
  which way the import already runs between the two files. Related: 2026-08-14, this file,
  for `import type` not exempting a CROSS-module edge — this is the same accounting one
  level down. Evidence: `src/modules/repo-intel/types.ts` (`FileFactsRow`),
  `src/modules/onboarding/types.ts` (`TokenCounter`), `src/modules/onboarding/prompt.ts`.

- **2026-08-11** — **When an acceptance criterion is UNIVERSAL over a set ("a lock file is
  always boilerplate"), the set has to be a named constant and the guard has to sit outside
  the rule table — and both are provable rather than stylistic.** Smart Diff's classifier
  walks a first-match-wins `[RegExp, role]` table; the tempting spelling is a lock-file row
  at the top of it. That is quietly fragile in a way a test cannot see: the criterion then
  holds only until someone inserts a broader pattern above it, and a lock file appearing in
  `core` breaks no assertion that checks the other roles. Two things fixed it, and the second
  is the surprising one. `LOCK_FILE_NAMES` is a list that `LOCK_FILE_PATTERN` is BUILT from,
  so `test/smart-diff-classify.test.ts` iterates the classifier's own set and a name added
  later is covered with no test edit. And the check is a statement ABOVE the loop, which is
  **load-bearing, not belt-and-braces**: `pnpm-lock.yaml` and `package-lock.json` both match
  the wiring block's config-by-extension catch-all (`.yaml`, `.json`) and nothing above it
  matches them first, so the table alone really does misclassify them. That is asserted
  directly ("is not redundant with the table") because a test that only called `classifyPath`
  would pass either way. Evidence: `src/modules/smart-diff/classify.ts` (`classifyPath`),
  `src/modules/smart-diff/constants.ts` (`LOCK_FILE_NAMES`, `ROLE_BY_PATH`).

- **2026-08-11** — **A derived record is only as good as the WRITE ORDER around its trigger, and
  in this codebase `GET /pulls/:id` is the only writer of a PR's body and files.** The Intent
  Layer enqueued its derivation from `GET /repos/:id/pulls`; `pull_requests.body` is not in the
  list upsert at all (the octokit list mapping drops it) and `pr_files` is written nowhere but
  the detail route — so every import-time derivation classified the PR from its TITLE alone.
  Measured on real data: 15 of 21 `pr_intent` rows had `sources = [pr_title]` at the confidence
  floor, and two PRs derived 0.6s apart differed only in what happened to be in the DB at that
  instant (one 46%, one 10%). Three properties made it permanent rather than merely unlucky: a
  title-only derivation is `status: 'ok'` (nothing was *unfetched*, so it is not `partial`);
  `needsDerivation` takes `Pick<IntentPull,'headSha'>` and is structurally blind to material
  improving; and the only manual repair path was a button that sent no body. So when adding a
  trigger for anything derived, ask which route WRITES the inputs and put the trigger there —
  and if a freshness predicate keys on a version identifier alone, note that a cheap early
  derivation at a stable identifier is cached forever. Evidence:
  `src/modules/pulls/routes.ts` (the list upsert vs the detail `.set`),
  `src/adapters/github/octokit.ts` (list mapping, no `body`),
  `src/modules/intent/service.ts` (`needsDerivation`).

- **2026-08-13** — Addendum to 2026-08-07 (Recurring Errors, the trace-before-status fix): the
  write order in `runOneAgent` is `insertReview` → `saveRunTrace` → `completeAgentRun`, so a
  terminal `agent_runs.status` is a promise about **the review row too**, not only the trace.
  That is load-bearing for any out-of-process consumer: it means "status is terminal" is
  sufficient warrant to issue exactly **one** `GET /pulls/:id/reviews` and expect the row to be
  there — no retry loop, no second poll for the review itself. Keep all three writes in that
  order if the executor is ever reshaped; moving `insertReview` after `completeAgentRun` would
  reintroduce the same race the 2026-08-07 entry closed for traces, one layer up and against
  every external reader rather than only against CI. Evidence:
  `src/modules/reviews/run-executor.ts` (`runOneAgent`).

- **2026-08-10** — **A helper that takes the whole `Container` puts every one of its callers
  into an import cycle with the DI root, and the fix is to narrow the parameter, not to
  restructure the callers.** `resolveFeatureModel(container, workspaceId, id)` only ever used
  `container.db`, but taking the root meant it imported `platform/container.ts`, which imports
  every module — so `modules/intent/service.ts → modules/settings/feature-models.ts →
  platform/container.ts → modules/intent/service.ts` was a `no-circular` warning, plus a
  `no-cross-module-internals` one for reaching into a sibling module at all. Changing the
  parameter to `db: Db` removed the file from every cycle; having the composition root satisfy
  a consumer-declared call signature (`FeatureModelResolver`) removed the cross-module edge
  too, because the module then imports no sibling. Measured: 24 warnings → 22, with the
  feature contributing none. Two things generalise. A service constructor taking the container
  **twice** — once as its declared ports and once as "the root, for that one call" — is the
  tell that a helper wants narrowing; `IntentService` had exactly that shape and lost its
  second parameter as a result. And structural interfaces are what make this cheap: a
  `Container` satisfies `IntentDeps` with no `implements` clause, so ports can be added and
  narrowed without the root ever naming the module's types. Evidence:
  `src/modules/settings/feature-models.ts` (`resolveFeatureModel`),
  `src/platform/container.ts` (`featureModel`, `intent`), `src/modules/intent/sources.ts`
  (`FeatureModelResolver`, `IntentDeps`).

- **2026-08-06** — The conventions extractor is **pre-wired in four places, none of which
  mention "extractor"**, so searching for the feature name finds nothing and the parts get
  rebuilt. (1) `RepoIntel.getConventionSamples(repoId, n)` is fully implemented — rank DESC,
  over-fetching 10× before filtering, with `isJunkPath` dropping tests/configs/migrations/
  `.d.ts` — i.e. the file sampler already exists on the facade. Because it reads `file_rank`
  it can only ever return files the indexer actually indexed, so a committed package cache
  (`.pnpm-store` in a real demo repo) is excluded for free and needs no pattern of its own.
  (2) `MockLLMProvider.structuredBySchema` names the two intended schemas verbatim,
  `'ConventionFileSelection'` then `'ConventionExtraction'` — the intended design is a
  two-step dialogue (model picks files, then extracts from them), not one call, and that is
  also the deterministic path for tests. (3) `FEATURE_MODELS`' `conventions` entry and
  `resolveFeatureModel` had **zero callers** anywhere in the tree, so the first consumer
  inherits an untested code path. (4) The screen's copy is already written in
  `client/messages/en/conventions.json`. Evidence: `src/modules/repo-intel/service.ts`
  (`getConventionSamples`, `JUNK_PATH_PATTERNS`), `src/adapters/mocks.ts`
  (`MockLLMOptions.structuredBySchema`), `src/modules/settings/feature-models.ts`.

- **2026-08-05** — A per-entity statistic must be anchored on **what a run carried**, not on
  the entity's current links. `agent_skills` says what an agent is configured with *today*;
  deriving a skill's findings/accept-rate from it silently backdates a link onto runs that
  predate it. L02 added `run_skills` (`run_id`, `skill_id`, `version`, `order`) written by
  `runOneAgent` on the success path for exactly this. Two consequences worth copying for the
  next lesson that adds a metric: both sides of a ratio must filter the same
  `agent_runs.status` (numerator on `run_skills`, denominator on `agent_runs` — mismatch
  gives a rate above 100%), and `agent_runs.agent_id` is `ON DELETE SET NULL` while
  `run_skills` rows survive, so the ratio still needs a `Math.min(1, …)` clamp. Evidence:
  `src/db/schema/runs.ts` (`runSkills`), `src/modules/skills/repository.ts` (`usageCounts`),
  `src/modules/skills/service.ts` (`toUsage`).
- **2026-08-05** — Where a "is this input trusted?" decision lives is a layering choice, and
  the answer here is **the service, not the engine**. `assemblePrompt`'s `skills` slot is the
  one section it does *not* `wrapUntrusted` — the engine has no `source` column and cannot
  know. `SkillsService.resolveBodiesForAgent` wraps anything whose `source !== 'manual'`
  before handing bodies over, which keeps `reviewer-core` pure and puts the rule next to the
  data that drives it. Don't "fix" the asymmetry by wrapping in `prompt.ts`: that would
  double-wrap an already-wrapped body and make a hand-written rule read to the model as
  data. Evidence: `src/modules/skills/service.ts` (`resolveBodiesForAgent`),
  `src/modules/skills/constants.ts` (`TRUSTED_SKILL_SOURCES`),
  `../reviewer-core/src/prompt.ts`.

- **2026-08-02** — A stored run trace is returned by a **cast, not a Zod parse**:
  `getRunTrace` does `row.trace as RunTrace` and `GET /runs/:id/trace` declares no response
  schema, so whatever is in the `run_traces.trace` jsonb reaches the client verbatim. Adding
  a field to `RunStats` therefore needs **no jsonb backfill** — but traces written before the
  field existed arrive with the key *absent*, so every client reader must tolerate
  `undefined` (not just `null`) or it renders `$NaN`/`undefined`. Evidence:
  `src/modules/reviews/repository/run.repo.ts` (`getRunTrace`), `src/modules/reviews/routes.ts`.
- **2026-08-03** — Grouping rows **by agent** needs a fallback key: `agent_runs.agent_id` is
  nullable (`onDelete: 'set null'`) and `reviews.agent_id` carries **no FK and no `notNull`**
  at all, so keying a per-agent `Map` on the raw value silently collapses every
  agent-deleted row into one bucket and a COST sum then drops all but one of them — no error,
  just a quietly smaller number. Key on `agentId ?? row.id`, prefixed so a row id can never
  collide with an agent id. Unlike the `pr_id` case (2026-08-02, Recurring Errors) this does
  **not** fail typecheck, because the key is assembled by hand. Evidence:
  `src/db/schema/reviews.ts` (`reviews.agentId`), `src/modules/pulls/latest.ts`
  (`groupLatestPerAgent`).
- **2026-08-03** — `agent_runs.score` and `reviews.score` are **not interchangeable**: the run
  column arrived in migration `0006_sharp_mordo.sql` with **no backfill**, so every run created
  before it carries `score = null` while its `reviews` row still holds the real figure. A
  PR-level score aggregate must therefore read `reviews.score` (present since `0000_init.sql`),
  even though reading score off `agent_runs` would fold the PR list's two `IN`-queries into
  one. Evidence: `src/db/migrations/0006_sharp_mordo.sql`, `src/modules/pulls/routes.ts`.
- **2026-08-03** — The PR list's three aggregates deliberately run on **two different bases**,
  and the mismatch is load-bearing rather than an oversight: `score` (min) and `cost_usd` (sum)
  collapse to each agent's *latest* row, while `findings_by_severity` sums **every** run — so
  re-running one agent *replaces* its cost and score but *adds* to its findings. The reason is
  an equality with another screen: the FINDINGS column has to match the PR-detail "Agent runs"
  tab badge, which counts `reviews.flatMap(r => r.findings)`. That equality only holds because
  both sides filter `kind === 'review'`, and `reviewsForPull` does **not** filter kind — so the
  client page must, or the two numbers drift silently the first time anything writes a
  `kind: 'summary'` review. Don't "harmonise" the bases without changing the badge too.
  Evidence: `src/modules/pulls/routes.ts`, `src/modules/pulls/status.ts`
  (`countFindingsBySeverity`), `src/modules/reviews/repository/review.repo.ts`
  (`reviewsForPull`), `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.
- **2026-08-03** — The seeded review carries **both** `agentId: null` and `runId: null` and has
  no matching `agent_runs` row, so it shows up under "Review runs" but produces **no timeline
  row at all**. Anything that joins a timeline run to its review by `run_id` therefore has zero
  seeded coverage and cannot be asserted from `e2e/specs/` — cover it with client unit tests,
  and expect `Map.get` misses in the join rather than treating them as a bug. Relatedly,
  `findings` has neither `pr_id` nor `run_id`, so every findings rollup must travel
  `findings.review_id → reviews.id`. Evidence: `src/db/seed.ts`, `src/db/schema/reviews.ts`
  (`findings`), `e2e/specs/04-pr-findings.flow.json`.
- **2026-08-04** — Source comments here cite package docs by **bare filename**, not by path,
  and nothing resolves those citations: the PR-list aggregate block in `routes.ts` said "see
  the PrMeta doc-comment and `scores-and-costs.md`" while that file did not exist for two
  commits (no link check in CI, and a bare filename is not a path any tool would follow). So
  before naming a new file under `docs/`, grep the source for a filename the code already
  promises — `grep -rn '[a-z-]*\.md' src/` — and reuse it verbatim; inventing a synonym
  leaves the citation dangling and creates a second doc for the same topic. Evidence:
  `src/modules/pulls/routes.ts` (the SCORE/COST/FINDINGS comment block),
  `docs/scores-and-costs.md`.

- **2026-08-14** — **`import type` does NOT exempt a module from
  `no-cross-module-internals` — a types-only import of a sibling's `types.ts` is a real
  violation, and the fix takes ten minutes if done first.** `modules/blast/` was written
  against `repo-intel`'s `BlastResult` with `import type`, which feels free (it erases at
  compile time and cannot create a runtime cycle). `depcruise` counts it anyway: 22 → 24
  warnings, both attributed to blast. The fix is the shape the 2026-08-10 entry above
  prescribes for ports, applied to a whole result type: the CONSUMER declares the fields it
  reads (`IndexBlastFacts` in `modules/blast/types.ts`), the facade's real `BlastResult`
  satisfies it structurally with no `implements`, and the module imports nothing from its
  sibling — back to 22. Worth doing for a second reason that is not about the linter: the
  declared view is narrower than the real type, so it documents exactly which index facts the
  feature depends on. Keep one test importing the REAL type and passing it in, or the two
  shapes can drift silently — `test/blast-service.test.ts` does that deliberately. Evidence:
  `src/modules/blast/types.ts` (`IndexBlastFacts`), `.dependency-cruiser.cjs`
  (`no-cross-module-internals`).

- **2026-08-15** — **`pr_files` is sparse on every real workspace, so a feature that queries
  ACROSS pull requests is in its "partial" state by default, not by exception.** Measured on
  the live dev database while building `GET /pulls/:id/prior-prs`: `BlackCat07/typescriptdemo`
  had 14 pull requests and **10** with any `pr_files` rows, because that table is written only
  by `GET /pulls/:id` (2026-08-11, this section) and a row appears the first time somebody
  opens that PR in the studio. Two consequences worth carrying into the next cross-PR feature.
  The coverage figure has to be QUERIED, not inferred from the result — an empty overlap and a
  full overlap are the same empty array, and only `count(pull_requests)` vs
  `count(distinct pr_files.pr_id)` separates "nothing else touched these files" from "nothing
  else was searchable"; and the incomplete-coverage copy is the branch most users will see
  first, so it belongs in the design pass rather than in an edge-case list. Evidence:
  `src/modules/reviews/repository/pull.repo.ts` (`countPullCoverage`),
  `src/modules/prior-prs/service.ts` (`statusOf`), `specs/prior-prs.md` (States).

- **2026-08-18** — **A feature can arrive four-fifths pre-wired across three packages with no
  single name to grep for, and the parts get rebuilt.** Project Context already exists as:
  `assemblePrompt`'s `specs` slot, which renders `## Project context` and — unlike `skills` —
  wraps its own contents; `PromptAssembly.specs` and `RunTrace.specs_read` in **both** contract
  copies; a `// ---- Project Context ----` block in `contracts/platform.ts` defining `SpecFile`
  and `IndexStatus`; `useContextFiles` / `useReindexContext` already calling
  `GET /repos/:id/context` and `POST /repos/:id/context/reindex`; `shell.nav.context` plus a
  whole `client/messages/en/context.json`; and the trace drawer's "Specs read" row and specs
  `PromptBlock`. Exactly one thing is missing — a server module: nothing named `context` is
  registered in `modules/index.ts`, so **both client hooks 404 today** and the executor writes
  `specs_read: []`. The lesson is the search order: before building an L05+ feature, grep the
  **contracts** and the **message catalogues** for its product name first, not the module tree —
  the module tree is the one place a pre-wired feature leaves no trace. Evidence:
  `src/vendor/shared/contracts/platform.ts:265` (`SpecFile`), `src/modules/index.ts`,
  `src/modules/reviews/run-executor.ts` (`specs_read: []`),
  `../client/src/lib/hooks/core.ts:123` (`useContextFiles`).

- **2026-08-18** — **The clone is a mirror that is periodically `reset --hard`, which rules out
  any in-place write feature before it is designed.** `SimpleGitClient.sync` runs
  `git fetch origin <branch> --depth <RESYNC_FETCH_DEPTH>` and then
  `git reset --hard origin/<branch>`, justified in its own comment by "safe here because we
  never commit to or run code from the clone" — and the `GitClient` port carries no write,
  commit, branch or push method at all (clone, fetchPullHead, sync, currentHead, diff,
  diffNameOnly, blame, log, readFile, clonePathFor). So a document-authoring UI over the clone
  would ship a Save button whose work the Resync button beside it deletes silently, with no
  error and nothing in the log; making an edit durable needs commit + branch + push + author
  identity + a GitHub write scope + conflict handling on a **shallow** clone, which is a
  separate feature rather than a tab. Found while specifying Project Context, whose design mock
  drew `Preview | Edit` + Save + upload over exactly this directory. Evidence:
  `src/adapters/git/simple-git.ts` (`sync`), `src/vendor/shared/adapters.ts` (`GitClient`).

- **2026-08-19** — **"A listing that opens no files" and "a token figure counted from
  characters" are contradictory requirements, and the contradiction is invisible until both are
  written down.** `ConfinedRepoDocReader.list` deliberately reads no bytes — that is what makes
  listing a large or hostile clone cheap, and it is why it returns `size` from `stat` only. But
  `approxTokens` is `ceil(characters / 4)` and takes a **string**, and deriving the figure from
  byte `size` instead is explicitly ruled out (a multi-byte document would over-count, which is
  what makes the client's and the server's figures disagree). There is no third option: the list
  path re-reads each document it reports, and the cost is real and accepted. The one exception
  is a document past the 256 KB read cap, which is estimated from `size` because it is never
  going to be sent whole anyway. Worth knowing before adding a second "cheap list" endpoint over
  the same walk. Evidence: `src/modules/project-context/service.ts` (`tokensFor`),
  `src/adapters/git/confined-doc.ts` (`list`), `src/adapters/tokenizer/index.ts`
  (`approxTokens`), `../specs/project-context.md` (EC-16).

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-29** — **GitHub empties `workflow_run.pull_requests` the moment the pull request
  is merged or closed, so re-reading an old run reports `prNumber: null` for a run that
  plainly had one.** The array is populated ONLY while the PR is open and originates in the
  same repository. `OctokitGitHubClient.listWorkflowRuns` maps it as
  `r.pull_requests?.[0]?.number ?? null`, which is correct at read time — the bug is what the
  caller does with it. `recordRun`'s `onConflictDoUpdate` set `prNumber` unconditionally, so
  the first refresh after a merge overwrote a stored `17` with null and blanked the CI Runs
  screen's "Pull request" column for every already-merged run, i.e. for most of the history
  that screen exists to show. Fixed by omitting the key from the SET when the incoming value
  is null. Generalises to any GitHub field that is a *view of current state* rather than a
  fact about the event: re-reading is not idempotent for those, and an upsert that treats the
  newest read as the whole truth will unlearn things. Note the provenance rule (AC-23,
  take repository/PR/SHA from the run and never from the artifact) is untouched — a run never
  changes which PR it belongs to, so null is never the newer truth. Evidence:
  `src/adapters/github/octokit.ts` (`listWorkflowRuns`),
  `src/modules/ci/repository.ts` (`recordRun`), `test/ci-runs-order.it.test.ts`.

- **2026-08-29** — **A fine-grained PAT cannot write anything under `.github/workflows/`
  without the separate **Workflows** permission, and the refusal names no permission and
  points at the wrong API.** Contents: read-and-write plus Pull requests: read-and-write is
  not enough. GitHub rejects at **tree creation** — `POST /repos/{o}/{r}/git/trees`, because
  the tree carries a workflow path — with `403 Resource not accessible by personal access
  token` and a docs link to `create-a-tree`, so the message reads as a Contents problem and
  sends you to check the wrong setting. Using the Git Data API rather than the Contents API
  does **not** bypass it. Cost two failed real exports before the cause was found. Since
  nothing in the error can be turned into a specific message, the answer is preventive: the
  wizard's Install step now names all three permissions before the button is pressed
  (SPEC-05 AC-59, EC-2a). Evidence: `src/adapters/github/octokit.ts` (`commitFiles`),
  `../specs/export-to-ci.md` (EC-2a).

- **2026-08-25** — **`yaml.stringify(obj, { nullStr: '' })` is the only formulation that
  writes a valueless YAML key (`skills:`) which reads back as `null`.** The default `nullStr`
  emits the literal string `null`, and a `.default([])` on the Zod contract does **not** catch
  either shape — which is why `AgentManifest.skills` is declared `.nullish().transform(v => v
  ?? [])` rather than `.default([])`. This matters wherever a generated manifest must round-trip
  through a hand-editable file: the studio writes it and the CI runner parses it with the same
  schema, so a key that serialises one way and parses another splits the two ends silently.
  Evidence: `src/modules/ci/manifest.ts`, `test/ci-generate.test.ts` (the AC-4 case),
  `src/vendor/shared/contracts/eval-ci.ts` (`AgentManifest.skills`).
- **2026-08-28** — **Where the NUL bytes of the 2026-08-19 entry come from, and how to stop
  making them.** Extends 2026-08-19 (`grep` without `-a` reports nothing on a source file
  holding a NUL). The cause is a **raw `0x00` written into a template literal as a key
  separator** — `` `${locationKey(f, l)}<NUL>${agentId}` `` — which is a sound separator
  (it cannot occur in a path or a uuid) written the one way that breaks every text tool:
  `file(1)` calls the whole file `data`, and `grep`/`ripgrep` then return **silence**, not
  "binary file matches". Write it as the escape `\0` instead: byte-identical at runtime,
  ASCII in the source, and the file needs no `-a` at all. Fixed in
  `src/modules/multi-agent/helpers.ts` (`mergeSynthesis`) — this was the THIRD file with
  the defect, and it cost real time, because the module was invisible to every grep while
  a bug in it was being hunted. The two files 2026-08-19 names,
  `src/modules/project-context/service.ts` and `src/modules/onboarding/service.ts`, are
  still raw and still need `-a`. Evidence: `src/modules/multi-agent/helpers.ts`.

- **2026-08-28** — **Corrects the bullet above, and nobody's list of the NUL-byte files was
  right.** Counted directly (`b"\x00" in f.read_bytes()` over every `.ts`/`.tsx`), `server/src`
  holds exactly **four**: `src/adapters/depgraph/index.ts`,
  `src/modules/project-context/service.ts`, `src/modules/repo-intel/pipeline/repo-map.ts` and
  `src/platform/model-router.ts`. `client/src` and `reviewer-core/src` hold none. So the bullet
  above is wrong that `src/modules/onboarding/service.ts` is still raw — it is clean now — and
  `.claude/skills/pr-self-review/gate.md` names only two of the four, missing
  `project-context/service.ts` and `model-router.ts`. Three sources, three different lists, none
  of them complete: **count it, do not cite it.** The `-a` flag stays load-bearing for any
  `grep -r` over `server/src` until all four are written as `\0` escapes.

- **2026-08-25** — **`depcruise`'s `application-no-db-schema` does not cover `src/db/client.ts`**,
  so a service can acquire a Drizzle *handle* — and with it `db.transaction` — while the onion gate
  stays at its 22-warning baseline. The rule's `to.path` is
  `^src/db/schema|node_modules/drizzle-orm/`, and `src/db/client.ts` matches neither. Found while
  assessing whether a service could own a transaction spanning two repositories: the answer is that
  nothing mechanical would have stopped it, and the rule that actually forbids it (a Drizzle type
  crossing a consumer-declared port) is checked by no tool in this repo. Read with the 2026-08-04
  entry on anchored `to.path` patterns silently never firing — same failure, different cause: there
  the pattern could not match, here the pattern was never meant to. Evidence:
  `.dependency-cruiser.cjs` (`application-no-db-schema`), `src/db/client.ts`,
  `src/modules/multi-agent/types.ts` (the port header that states the real rule).

- **2026-08-23** — **`git status --short` reports a newly generated file as `??`, never `A`, so a
  Done-condition written against an `A` line cannot pass on an implementer's tree** — `A` needs a
  `git add`, and an implementer is forbidden to stage. The same shape defeats
  `git diff --name-only` as an "exactly N paths changed" check for any task that **adds** files:
  new files are untracked and `git diff` cannot see them at all, so the count silently comes back
  short. Use `git status --short -- <paths>` for both. Read with the 2026-08-19 entry on
  `_journal.json` always showing `M`, the only formulation that holds for a generated migration on
  an unstaged tree is **"exactly one `.sql` line, and it is not `M`"**. Evidence:
  `src/db/migrations/0020_short_the_anarchist.sql`, `../.claude/.plans/eval-pipeline/plan.md`
  (T1 and T4 Done-conditions).

- **2026-08-23** — **`depcruise`'s `core-stays-pure` rule stays GREEN with a provider import
  sitting inside `reviewer-core`, because it only forbids edges that LEAVE the package.** Measured
  by deliberately breaking a gate: `import type { LLMProvider } from '../llm/openrouter.js'` at the
  top of `reviewer-core/src/eval/score.ts` — the one file whose entire purpose is that it makes no
  model call — left the cruise at `0 errors, 22 warnings` unchanged. An intra-package edge is not a
  violation that rule can express. So "this module reaches no provider" **cannot be gated
  architecturally**; the only mechanical check is a grep over that file's own import statements,
  scoped to import lines rather than whole-file text (a doc-comment naming the thing it avoids
  otherwise reads as a violation) and run with `-a`. Evidence: `reviewer-core/src/eval/score.ts`,
  `.dependency-cruiser.cjs` (`core-stays-pure`), `../scripts/verify-l06.sh`.

- **2026-08-22** — **A side-effect subpath import (`import 'dotenv/config'`) is a third class
  of scanner-invisible dependency: `scan.mjs` reports `importedInFiles: 0` for `dotenv` while
  four files in this package import it.** `src/platform/config.ts`, `src/db/migrate.ts`,
  `src/db/seed.ts` and `drizzle.config.ts` all open with `import 'dotenv/config'` — a bare
  side-effect import of a subpath, which the loose per-name regex does not attribute to
  `dotenv`. The only thing keeping it off the unused-candidates list is `referencedInConfig`
  (the name appears in `drizzle.config.ts`); a subpath-imported package with no config mention
  would surface as a removal candidate while being load-bearing. Same lesson as the
  `@vscode/ripgrep` entry beside this one: the Step 4 grep-by-name pass is what catches it,
  never the scanner column. Evidence: `src/platform/config.ts:1`,
  `.claude/skills/dependency-checker/scripts/scan.mjs` (`importedInFiles`).

- **2026-08-22** — **Two of this package's `dependencies` are invisible to every static
  dependency scan, in opposite directions, and a third is genuinely dead.** Measured
  while building `.claude/skills/dependency-checker/`. (1) `@vscode/ripgrep` looks unused
  to any importer-based tool because `src/adapters/codeindex/ripgrep.ts:33` loads it as
  `await import(/* @vite-ignore */ '@vscode/ripgrep' as string)` — the cast to `string`
  is what makes the specifier opaque, and it defeats regex scans and bundler resolution
  alike. It IS used; never remove it on a scanner's say-so. (2) `testcontainers` is
  declared here but only `@testcontainers/postgresql` is imported (`test/helpers/pg.ts:1`),
  and that package already depends on `testcontainers@^10.28.0` — redundant, but dropping
  the direct entry hands the version pin to the child. (3) `@fastify/autoload` has **zero**
  references in `src/` (`grep -ran autoload src/` → empty) and contradicts the static
  registration in `src/modules/index.ts` that the root `CLAUDE.md` mandates — that one is
  genuinely removable. The general shape: three superficially identical "unused" candidates,
  three different correct answers, none decidable without reading the source. Evidence:
  `src/adapters/codeindex/ripgrep.ts:33`, `test/helpers/pg.ts:1`, `package.json`.

- **2026-08-22** — **`du -sk` reports 0 bytes for every dependency in a pnpm
  `node_modules`, so any size audit built on it silently measures nothing.** Despite
  `node-linker=hoisted` in `.npmrc`, this tree's top-level entries are symlinks into
  `.pnpm/` (`node_modules/fastify -> .pnpm/fastify@5.8.5/node_modules/fastify`), and `du`
  does not follow symlinks: `du -sk node_modules/fastify` → `0`, `du -skL` → `3552`.
  The failure is the quiet direction — a size report full of zeros reads as "these
  dependencies are tiny". `-L` fixes it here but is wrong for the npm-managed packages
  (`reviewer-core`, `e2e`, `mcp-server`), whose flat trees can nest a second
  `node_modules` that then gets double-counted, and BSD/macOS `du` has no `--exclude`.
  Since this repo runs both managers, no single `du` invocation is correct everywhere.
  What worked: walk in JS, skip any directory named `node_modules`, never follow a
  symlink, cache by resolved real path — ~2 s for all six packages, and it agrees with
  `du` to within 5%. Implemented in
  `.claude/skills/dependency-checker/scripts/scan.mjs` (`dirSize`). Evidence: `.npmrc`,
  `node_modules/fastify` (the symlink).

- **2026-08-20** — **`depcruise`'s MODULE COUNT is the signal for "was this file analysed at
  all"; the warning count cannot tell you.** An unresolved file produces the *same*
  `x 22 dependency violations (0 errors, 22 warnings)` line as a clean one, so a green gate is
  equally consistent with "the new file has no bad edge" and "the new file was never cruised" —
  and the second is what a missing `tsConfig` path alias or a typo'd `--include` produces.
  The trailing `N modules, M dependencies cruised` is what separates them: 222 → 234 across
  twelve new files in one feature is the evidence they were read. Record the count alongside
  the warning line whenever a diff adds files, and treat an unchanged count over a growing
  tree as a broken gate rather than a clean one. Evidence: `.dependency-cruiser.cjs`
  (`tsConfig`), `src/modules/brief/` (the twelve files the count moved for).

- **2026-08-19** — **`grep` without `-a` reports NOTHING on two of this package's own source
  files, and prints no warning worth noticing.** `src/modules/project-context/service.ts` and
  `src/modules/onboarding/service.ts` contain a literal NUL byte, so `grep` treats them as
  binary: `grep -n "^export" src/modules/project-context/service.ts` returns empty while
  `grep -an` on the same file returns seven lines. The failure mode is the dangerous
  direction — a search for something forbidden comes back clean because the file was never
  scanned, not because the thing is absent. `gate.md` already uses `-a` for the ESM-extension
  check and that is why; the same applies to every ad-hoc grep over `src/modules/`, including
  the ones written into a plan's Done-conditions. Evidence: `src/modules/onboarding/service.ts`,
  `src/modules/project-context/service.ts`, `.claude/skills/pr-self-review/gate.md`.

- **2026-08-10** — **No test file in this package is typechecked by any gate, so a test can
  carry a real type error while `vitest` is fully green.** `tsconfig.json`'s `include` is
  `["src/**/*.ts"]`, so the prescribed `tsc --noEmit -p tsconfig.json` never looks at `test/`;
  vitest transpiles without typechecking; and `tsconfig.eslint.json` widens the include for
  ESLint's parser only — type-aware lint rules do not surface `error TS`. Measured today:
  `./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json` reports **16 errors across 6 test
  files** (`prompt-callers` ×7, `skills.it` ×3, `repo-intel-facade-degraded` ×3,
  `conventions.it`, `agents-versions.it`, `adapters`) while `vitest run` is 283/283 green.
  Most are the same shape: a `readonly` tuple from an `as const` fixture assigned to a mutable
  `string[]`/array field. This matters when a port's shape CHANGES: adding a required field to
  a structural `IntentDeps` left `test/intent-sources.test.ts` missing `featureModel`, and
  every gate — typecheck, eslint, the whole hermetic suite — stayed green, because the fixture
  is only structurally wrong and the method under test never reads that field. So after
  widening an injected interface, run `tsc --noEmit -p tsconfig.eslint.json` and diff the
  error count; the suite passing is not evidence the fixtures still match. Evidence:
  `tsconfig.json` (`include`), `tsconfig.eslint.json`, `test/intent-sources.test.ts`
  (`depsFor`).

- **2026-08-10** — **`dependency-cruiser`'s `modules-no-raw-sdk` rule is SDK-shaped and does
  not list `node:fs`, so a feature module reading the disk directly is invisible to the one
  gate that guards the adapters ring.** The rule enumerates `octokit`, `openai`, `postgres`
  and friends; a module that does `import { readFile, realpath, stat } from 'node:fs/promises'`
  passes with the gate reporting clean. Measured on this tree: `rg -n "node:fs" src/modules/`
  returned 4 files across 3 modules while `depcruise` reported **0 errors**. Two of those were
  `modules/conventions/` (L02) and `modules/intent/sources.ts` (L03), and both had
  independently reimplemented the same clone-path confinement (`resolveInRoot` in
  `conventions/verifier.ts`, `resolveInClone` in `intent/sources.ts`) — a security-relevant
  rule with two copies and no gate over either. Worth knowing before writing the next one:
  `GitClient.readFile(repo, path)` already exists on the port
  (`adapters/git/simple-git.ts`) and is a one-liner over `clonePathFor`, but it joins and
  reads in a single step, so it CANNOT express the post-`realpath` re-check that is the only
  defence against a symlink escaping the clone — reaching for it as the fix silently drops
  that check. What worked instead, without touching the frozen `src/vendor/shared/` contract:
  the consumer declares the port (`RepoDocReader` in `modules/intent/sources.ts`), an adapter
  implements it (`adapters/git/confined-doc.ts`), and the container wires the two, which the
  adapter satisfies **structurally** so it imports nothing from `modules/`. Evidence:
  `.dependency-cruiser.cjs` (`modules-no-raw-sdk`),
  `src/adapters/git/confined-doc.ts`, `src/modules/conventions/verifier.ts` (`resolveInRoot`).

- **2026-08-06** — A whole-suite `vitest run` **silently skips most `.it.test.ts` files even
  when Docker is up**, so a green run is not evidence the DB-backed half executed.
  `../TESTING.md` says those suites "self-skip when Docker is unavailable", which reads as
  the only cause; it is not. Measured on one machine with the daemon running: the full run
  reported `Test Files 25 passed | 5 skipped`, `Tests 217 passed | 50 skipped` — five
  integration files, mine among them, marked `↓ (n tests | n skipped)` — while
  `vitest run .it.test --pool=forks --poolOptions.forks.singleFork` ran all eight files and
  58 tests green. The mechanism is unconfirmed (each file resolves `dockerAvailable()` in a
  top-level `await` as its worker starts, so contention during parallel startup is the
  suspect, not anything in the tests). Practical rule: read the `↓` lines rather than the
  pass count, and re-run the integration half serially before believing it. Evidence:
  `test/helpers/pg.ts` (`dockerAvailable`), `test/conventions.it.test.ts`.

- **2026-08-06** — `drizzle-kit generate` **blocks forever on an interactive rename prompt**
  when one migration both drops and adds columns in the same table (`Is scan_id column in
  conventions table created or renamed from another column?`). It reads that answer straight
  from a TTY, so piping newlines into it does nothing — the process just sits there until the
  caller times out, and nothing is written. The fix needs no TTY and no `expect`: split the
  change into two migrations that are each unambiguous. Generate the ADDs first (nothing is
  being deleted, so drizzle has no rename candidate to offer), then the DROPs (nothing is
  being added, so there is nothing to ask about). Reshaping a table this way costs one extra
  migration file and reads clearly in the log. Evidence:
  `src/db/migrations/0013_conventions_l03_shape.sql`,
  `src/db/migrations/0014_conventions_drop_placeholder_columns.sql`.

- **2026-08-02** — `pnpm <script>` can die before the script runs: pnpm's pre-script
  dep-status check shells out to `pnpm install`, which trips this repo's supply-chain policy
  with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features, esbuild, protobufjs,
  ssh2` and exits 1 (`pnpm db:generate` never reached drizzle-kit). Two consequences: run the
  binary directly instead — `./node_modules/.bin/drizzle-kit generate`,
  `./node_modules/.bin/vitest run`, `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — and
  check for a scaffold `server/pnpm-workspace.yaml` that pnpm drops on failure, which
  contradicts the root "NOT a monorepo workspace" convention and must be deleted, not
  committed. Evidence: `package.json` (`db:generate`), root `CLAUDE.md` (Conventions).
- **2026-08-04** — Two install traps hit while adding ESLint, both new. (1) **A pnpm major
  mismatch breaks every `pnpm <script>`**, not just the install: CI pins
  `pnpm/action-setup@v4 version: 10` while the local CLI is 11, and a `node_modules` written
  by one major makes the other's pre-script dep-status check try to purge it —
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` with no TTY, which killed
  `../scripts/e2e.sh` at its `db:migrate` step mid-run. `CI=true` lets it proceed; the real
  fix is reinstalling with the CLI you actually use (`CI=true pnpm install --frozen-lockfile`
  keeps the lockfile untouched). Verified pnpm 10 still accepts a lockfile normalised by 11
  (`lockfileVersion` stays `9.0`), so CI is unaffected — but that install rewrites peer
  suffixes across unrelated entries, which is the churn root `CLAUDE.md` forbids committing.
  (2) **`@eslint/js@10` resolves against `eslint@9` under pnpm but not npm** — `.npmrc` here
  sets `strict-peer-dependencies=false`, so pnpm installed the mismatch silently while
  `npm i` in `reviewer-core`/`e2e` failed loudly with ERESOLVE. Pin `@eslint/js` to the
  eslint major. Evidence: `server/.npmrc`, `.github/workflows/server-unit.yml`,
  `../scripts/e2e.sh`.
- **2026-08-04** — Addendum to the entry above: the mismatch it describes is **closed**. All
  five workflows now pin `pnpm/action-setup@v4` to `version: 11`, and `client/package.json`
  and `server/package.json` carry `"packageManager": "pnpm@11.17.0"`, so pnpm self-corrects to
  that exact version. `action-setup` cannot read `packageManager` on its own here — there is
  no root `package.json` for it to look at — so the workflow pin and the field must be bumped
  **together**. The mechanism in the entry above is unchanged and still the thing to recognise
  if the two ever drift again.
- **2026-08-03** — Drizzle 0.38's `count()` is `sql\`count(...)\`.mapWith(Number)`, so a
  `GROUP BY` aggregate yields a real `number` with no bigint-as-string coercion needed. Worth
  stating because `src/modules/pulls/latest.ts` documents the opposite habit — over-fetch
  ordered rows and reduce in JS — and its stated reason is narrow: Drizzle has no portable
  per-group `LIMIT 1`. An aggregate that needs no per-group latest row (a plain sum or count)
  should use `.groupBy()` in SQL rather than copy that precedent; the JS path would otherwise
  pull every finding of every historical run in the repo to produce three numbers per PR.
  Evidence: `src/modules/pulls/routes.ts`, `src/modules/pulls/latest.ts`,
  `node_modules/drizzle-orm/sql/functions/aggregate.js`.
- **2026-08-04** — `dependency-cruiser` is already a **runtime dependency** here (it backs
  `adapters/depgraph`), so architecture linting needs no install — but a rule whose `to.path`
  anchors on `^node_modules/<pkg>` **silently never fires under pnpm**: resolved paths are
  `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/node_modules/drizzle-orm/index.cjs`.
  Measured on the same tree: `^node_modules/drizzle-orm` → 0 violations, `node_modules/drizzle-orm/`
  → 4 (`workspace`/`settings`/`pulls`/`polling` routes). Anchor-free, trailing-slash patterns only;
  an anchored rule reads as "clean" and is the worst failure mode for an enforcement rule. Also:
  `tsConfig: { fileName: 'tsconfig.json' }` is required or the `@devdigest/*` path aliases
  resolve to nothing, and `reviewer-core` legitimately imports `src/vendor/shared` (the port
  ring physically lives in this package), so any purity rule on it needs that explicit
  exception. Evidence: `package.json` (`dependency-cruiser`), `tsconfig.json` (`paths`),
  `src/adapters/depgraph/index.ts`.

- **2026-08-19** — **`drizzle-kit generate` ALWAYS rewrites `migrations/meta/_journal.json`, so
  a migration-shape check written as "one new `.sql` and no `M` line" can never pass.** The
  journal is append-only generated bookkeeping and every generate adds its `{"idx": N, "tag":
  …}` object, which `git status --short` reports as `M`. A gate or a plan's Done-condition
  phrased against "no `M` line" therefore fails on a perfectly correct run, and the tempting
  reading — "something modified an existing migration" — is exactly wrong. The precise
  formulation is **"no `M` line against a `.sql` file"**; the snapshot and the journal are
  expected to move. Confirmed against history: commit `b86cdee` shows
  `meta/_journal.json | 14 +` alongside its two new migrations. Evidence:
  `src/db/migrations/meta/_journal.json`, `src/db/migrations/0017_safe_hannibal_king.sql`.

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

- **2026-08-29** — **`column ci_runs.workflow_run_id does not exist` at runtime, minutes after
  `pnpm db:migrate` printed `✓ migrations applied` — because ANOTHER WORKTREE's migration is
  sitting in the slot yours needed.** The Postgres container is shared by every worktree, and
  Drizzle applies migrations by **journal position**, comparing counts rather than reconciling
  tags: `drizzle.__drizzle_migrations` held 23 rows, so `0022` was considered done. Row 23's
  hash was `69382f0b…` while `shasum -a 256 src/db/migrations/0022_petite_kylun.sql` is
  `030bb922…` — a *different* branch's `0022`, applied first. Nothing warns; migrate exits 0.
  **Diagnosis:** hash your migration file and compare it against
  `select id, hash from drizzle.__drizzle_migrations order by id desc` — a mismatch at your
  index is the whole story. **Two fixes, and pick deliberately:** point that worktree at its
  own database (clean, but starts empty — the imported repos, PRs and repo-intel index all
  live in the original one), or apply your `.sql` by hand with
  `docker exec -i devdigest-postgres psql -U devdigest -d devdigest -v ON_ERROR_STOP=1 < …`
  and leave the journal alone. Do **not** insert a journal row to "correct" it: that shifts
  the count and makes the next branch's migration look applied instead. Two branches with a
  conflicting `NNNN` on one database cannot both be right — this is a coordination problem
  wearing a tooling error's clothes. Extends the 2026-08-19 triage in What Works (`500` =
  migration unapplied) with the case where migrate *says* it applied them. Evidence:
  `src/db/migrations/0022_petite_kylun.sql`, `src/db/migrations/meta/_journal.json`.

- **2026-08-29** — **A real GitHub `403` reached the UI as `{"code":"internal_error",
  "message":"Internal error"}`, because Octokit spells its status `status` and the error
  handler reads `statusCode`.** `app.ts`'s handler does `const status = e.statusCode ?? 500`,
  so an `HttpError` — which carries `status: 403` and no `statusCode` — is classified 5xx and
  hits the branch that deliberately hides 5xx messages (a Postgres connection string or a
  prompt fragment must not leave the process). The one sentence that said *which* permission
  was missing was the sentence thrown away. Note `platform/resilience.ts`'s
  `defaultIsRetryable` reads `status` **and** `statusCode`, so retries were always correct and
  only the HTTP boundary was wrong — the two layers disagreed about the shape of the same
  object. Fixed in the adapter, the ring that owns the SDK: `mapGitHubError` turns a 4xx into
  an `AppError` (`github_permission` / `github_auth` / `github_not_found`) carrying GitHub's
  own words, and 5xx and socket errors are deliberately left alone so they stay retryable and
  stay hidden. **The testing lesson is the bigger one:** two green tests bracketed this defect
  without covering it — a service test asserted the service *throws* with the right message,
  and a client test asserted the wizard *renders* `error.message` from a hand-written
  `{code:"github_permission"}` envelope the server never produced (that string appears nowhere
  in `src/`). When a criterion is about what a caller SEES, one test has to cross the HTTP
  boundary. Evidence: `src/app.ts` (`setErrorHandler`),
  `src/adapters/github/octokit.ts` (`mapGitHubError`, `ghRetry`), `test/github-errors.test.ts`,
  `test/ci-routes.test.ts`.
- **2026-08-25** — **Adding a REQUIRED method to a port that a module's `Store` interface extends
  breaks every hand-built fake of that `Store`, and `tsc --noEmit -p tsconfig.eslint.json` is the
  only gate that sees it.** Measured adding `discard` to `MultiAgentRecorder`, which
  `MultiAgentStore` extends: the main typecheck stayed `rc=0`, `eslint` stayed clean, `vitest` was
  fully green — and the eslint-project typecheck went **16 → 20**, one error per fake, back to 16
  once each gained `discard: unreachable('discard')`. So a port's blast radius is "the port ring
  **plus every hand-built fake of anything that extends it**", which is not visible from the port
  file. This is the 2026-08-10 entry's mechanism (no test file is typechecked) reaching a second
  feature, and the practical rule is the same: after widening an injected interface, run that
  project and diff the count. Evidence: `src/modules/multi-agent/types.ts`
  (`MultiAgentRecorder.discard`), `test/multi-agent-read.test.ts` (`store`).

- **2026-08-25** — **Fastify hands a request with NO body to the zod validator as `null`, not
  `undefined`, so a top-level `.default({})` on a body schema never fires** and a route that used
  to tolerate a body-less POST starts answering `422 validation_error` with
  `"expected":"object","received":"null"`. Measured both cases on `POST /pulls/:id/review` before
  choosing: no payload → the 422; `{}` → the handler's own named 400. This matters wherever a
  tolerated empty body is load-bearing — here it was the difference between "behaves exactly as
  today" and a broken existing route. The shape that works is
  `z.preprocess((body) => body ?? {}, Schema)`. Evidence:
  `src/modules/reviews/routes.ts` (the `POST /pulls/:id/review` body schema).

- **2026-08-07** — **`Cannot read properties of undefined (reading 'skills')` on
  `trace.prompt_assembly`, CI-only, right after a run turns `done`.** The executor committed
  `agent_runs.status = 'done'` (`completeAgentRun`) *before* `saveRunTrace`, so anything that
  polls `agent_runs.status` and fetches `/runs/:id/trace` the moment it turns terminal can
  land between the two commits and get the 404 envelope instead of a trace. Locally the
  window is invisible; on a shared CI runner `reviews.it.test.ts` ("omits the skills block
  entirely…") hit it while the other 69 tests passed — a flake, not a broken assertion. Fixed
  by persisting the trace first at all three write sites (success, catch, `failAll`): a
  terminal status is the promise that the trace row already exists — keep that order if the
  executor is reshaped. Evidence: `src/modules/reviews/run-executor.ts` (`runOneAgent`,
  `failAll`), `test/helpers/runs.ts` (`waitForPrRuns`).

- **2026-08-06** — **Every list comes back empty, with no error anywhere, after re-seeding a
  running server.** `LocalNoAuthProvider.currentWorkspace` memoises the workspace for the
  life of the process (`if (this.cachedWorkspace) return this.cachedWorkspace`). Recreating
  the workspace row — `TRUNCATE` then `db:seed`, or dropping the schema — gives it a new
  uuid, and the running API keeps scoping every query to the old one. Nothing throws: the
  queries are valid, they just match nothing, so `GET /repos`, `GET /agents` and
  `GET /skills` all answer `[]` while the database is visibly full. Measured here after a
  deliberate wipe: 1 repo, 5 agents and 13 skills in Postgres, `[]` on all three endpoints.
  The fix is to restart the API; the tell is that the *client* looks freshly installed while
  `psql` disagrees. Evidence: `src/adapters/auth/local.ts` (`currentWorkspace`),
  `src/db/seed.ts` (`DEFAULT_WORKSPACE_NAME`).

- **2026-08-06** — **The API process dies with no error in its own log when a background job
  fails.** `JobRunner.enqueue` returns `{ id, done }` and `done` REJECTS if the job
  ultimately fails — so a caller that does `await container.jobs.enqueue(...)` and discards
  the result leaves a floating rejected promise, and Node kills the process on the
  unhandled rejection. Every existing caller has this shape (`repos/service.ts`,
  `repo-intel/service.ts`); it just never surfaced because clone and index jobs rarely fail
  outright. A conventions scan that overran the job timeout hit it on the first real run:
  the whole server went down mid-request, leaving the scan row stuck at `running` and the
  next scan of that repo refused forever. Two fixes, both needed — attach
  `void job.done.catch(…)` and record the failure on your own row, and give any
  `queued`/`running` state a staleness window so a dead worker cannot brick the entity
  (`SCAN_STALE_AFTER_MS`). Evidence: `src/platform/jobs.ts` (`enqueue`),
  `src/modules/conventions/service.ts` (`requestScan`),
  `src/modules/conventions/repository.ts` (`activeScan`).

- **2026-08-06** — **`StructuredRequest.timeoutMs` is silently ignored, and `maxRetries`
  defaults to 2 — i.e. THREE attempts per call.** The timeout is fixed when the OpenAI
  client is constructed (`timeout: opts.timeoutMs ?? 90_000`, a *constructor* option);
  nothing reads `req.timeoutMs` in `completeStructured`. So a per-request timeout looks
  like it bounds a call and does not, and one structured call can legitimately take three
  round-trips of up to 90s. Anything running several calls inside `JobRunner`'s fixed 120s
  must therefore bound them ITSELF — pass `maxRetries: 0` where a failed call is
  survivable, and race each call against a deadline rather than trusting the request
  fields. Measured on one repo and model over five real scans, per-wave latency swung from
  ~35s to over 105s, so any concurrency tuned against a live provider is tuned against one
  sample. Evidence: `../reviewer-core/src/llm/openrouter.ts` (`completeStructured`),
  `src/modules/conventions/constants.ts` (`EXTRACTION_MAX_RETRIES`).

- **2026-08-05** — `The "string" argument must be of type string or an instance of Buffer or
  ArrayBuffer. Received an instance of Date` from a repository method means a **JS `Date`
  was interpolated into a raw `sql` template**. Drizzle binds a `Date` fine in `eq()`/`gte()`
  and in `.values()`, but postgres-js rejects it inside `` sql`… ${d} …` `` — so the failure
  only appears in hand-written aggregate SQL. Two things make it expensive: it typechecks
  (the template accepts `unknown`), and Fastify's error handler swallows it into a generic
  `500 {"code":"internal_error"}`, so the route gives no clue — call the repository method
  directly from a test to see the real message. Fix: bind the ISO string and cast,
  `${since.toISOString()}::timestamptz`. Evidence:
  `src/modules/skills/repository.ts` (`usageCounts`, `usageCountsForAll`).

- **2026-08-02** — `agent_runs.pr_id` is **nullable** (`onDelete: 'set null'`) while
  `reviews.pr_id` is `notNull`. Copying the PR-list "latest per PR" grouping from the reviews
  block to `agent_runs` therefore fails typecheck with `Type 'string | null' is not
  assignable to type 'string'` on the `Map<string, …>` write — a run outlives the PR it
  reviewed. Guard with `if (row.prId == null) continue`. Evidence: `src/db/schema/runs.ts`
  (`agentRuns.prId`), `src/modules/pulls/latest.ts` (`pickLatestPerPr`).
- **2026-08-04** — Two **zsh** traps make a gate report the wrong result, and both look like
  the gate's own output. (1) `${PIPESTATUS[0]}` is a bash array — in zsh it expands to
  **empty**, so `tsc … | tail; echo rc=${PIPESTATUS[0]}` prints a blank rc and a failure
  reads as "no error"; redirect to a file and read `$?` on the next statement instead.
  (2) zsh does **not** word-split an unquoted variable, so `eslint $CHANGED` with a
  space-separated path list passes it as **one** argument and exits **2** with
  `No files matching the pattern "src/a.ts src/b.ts …"` — an exit code that reads as a lint
  failure but means nothing ran. List the paths literally or pipe them through `xargs`.
  Measured while running the four packages' gates from a zsh session. Evidence:
  `package.json` (`lint`, `typecheck`), `../TESTING.md` (Running locally).

- **2026-08-07** — **The API died again from a discarded `job.done` — and the trigger was the
  SEEDED repo, not a big one.** Refresh on `acme/payments-api` (a fixture that does not exist
  on GitHub) fails its clone job in ~0.4s with "Repository not found"; `RepoService.refresh`
  discards `done`, and the unhandled rejection killed the process (mechanism: 2026-08-06,
  this section's neighbour). Two updates to that entry's guidance. (1) The fix is now
  CENTRAL: `JobRunner.enqueue` attaches a side-branch `done.catch(() => undefined)` before
  returning, so all five fire-and-forget call sites — and any future one — are crash-safe;
  a per-caller `.catch` is still wanted only for bookkeeping (conventions keeps its own to
  fail the scan row). (2) When diagnosing "server died right after a repo action", read the
  `jobs` TABLE first — it survives the crash and names the real failing job. The first
  hypothesis here (big-repo indexing overrunning the 120s job timeout) was wrong: the
  300-file index finished `done` in 6.4s, well inside `INDEX_SOFT_BUDGET_MS`. Evidence:
  `src/platform/jobs.ts` (`enqueue`), `src/modules/repos/service.ts` (`refresh`),
  `test/jobs.test.ts`.

- **2026-08-19** — **A contract field declared `.nullish()` reads as "nullable" to whoever
  writes a helper against it, and `expect(x).not.toBeNull()` followed by `x!` looks like it
  closes the gap while covering only half of it.** `PromptAssembly.specs` is
  `z.string().nullish()` — `string | null | undefined` — because `getRunTrace` returns
  `row.trace as RunTrace`, a **cast, not a parse**, so a trace persisted before a field existed
  arrives with the key *absent*. A test helper typed `(specs: string | null)` and guarding on
  `=== null` therefore fails to compile at its call sites, and a `!` at a second call site
  silently accepts the very value the whole thing is about. Narrow with `== null` (loose, covers
  both) and prefer an explicit `if (x == null) throw` over `!`, so the failure is a readable
  message rather than a crash inside `.split`. This cost a remediation round because **no gate
  typechecks `test/`** (see 2026-08-10, Tool & Library Notes): `vitest run` was 559/559 green
  with two real `error TS` in the file. Related: 2026-08-02, this file, for the cast. Evidence:
  `test/project-context-run.test.ts` (`specOpenings`, `specBodies`),
  `src/vendor/shared/contracts/trace.ts` (`PromptAssembly.specs`),
  `src/modules/reviews/repository/run.repo.ts` (`getRunTrace`).

- **2026-08-19** — **A feature can pass every gate, every reviewer and a 559-test suite and
  still 500 on its first real request, because nothing in the pipeline applies the migration
  it ships.** `CLAUDE.md` already says migrations never run on boot; what it does not say is
  that **no hermetic test can tell "schema shipped" from "schema applied"** — services take
  their repository through `ContainerOverrides`, so the suite proves the call shape against a
  fake and never touches Postgres. Project Context shipped `0017_*.sql`, `DDG-WIRE-003` was
  satisfied, `/pr-self-review` recorded a clean verdict, and the screen answered
  `500 internal_error` the moment it was opened. **Read the status code first: `404` means the
  module is not registered in `modules/index.ts`; `500` on a route that exists, right after a
  feature that adds a table, means the migration was never applied.** Confirm in one query —
  `select table_name from information_schema.tables where table_name in (…)` — rather than by
  reading code, then `./node_modules/.bin/tsx src/db/migrate.ts`. Neither the implementation
  plan nor `/run-plan` has a step for this, and a task is normally told **not** to migrate
  (applying one is not the task's job), so the gap is structural rather than anybody's
  oversight. Evidence: `src/db/migrations/0017_safe_hannibal_king.sql`,
  `src/db/migrate.ts`, `src/modules/project-context/repository.ts` (`countAgentsByPath`, the
  query that failed).

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

- **2026-08-25** — **Nothing copies `src/prompts` → `dist/prompts`, so every prompt template is
  absent from a compiled build.** `package.json`'s `build` is `tsc -p tsconfig.json` and nothing
  else, while `src/platform/prompts.ts`'s own header states that a production build must copy that
  directory. Six templates are affected — `brief.system.md`, `intent.classify.system.md`,
  `onboarding.system.md`, both `conventions.*.system.md` and `multi-agent-notes.system.md` — and it
  is invisible in development because `tsx` reads `src/`. Unresolved because the fix is a
  build-script change that belongs to whoever owns deployment, and because no consumer in this repo
  currently runs from `dist/`. Whoever picks this up: confirm first whether anything ships compiled
  at all, since the answer decides between fixing the build and deleting the loader's promise.
  Evidence: `package.json` (`build`), `src/platform/prompts.ts` (the header).
