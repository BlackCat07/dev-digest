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

_No entries yet._

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

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

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

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

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

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

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

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

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
