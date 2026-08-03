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

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

- **2026-08-02** — `pnpm <script>` can die before the script runs: pnpm's pre-script
  dep-status check shells out to `pnpm install`, which trips this repo's supply-chain policy
  with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features, esbuild, protobufjs,
  ssh2` and exits 1 (`pnpm db:generate` never reached drizzle-kit). Two consequences: run the
  binary directly instead — `./node_modules/.bin/drizzle-kit generate`,
  `./node_modules/.bin/vitest run`, `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — and
  check for a scaffold `server/pnpm-workspace.yaml` that pnpm drops on failure, which
  contradicts the root "NOT a monorepo workspace" convention and must be deleted, not
  committed. Evidence: `package.json` (`db:generate`), root `CLAUDE.md` (Conventions).
- **2026-08-03** — Drizzle 0.38's `count()` is `sql\`count(...)\`.mapWith(Number)`, so a
  `GROUP BY` aggregate yields a real `number` with no bigint-as-string coercion needed. Worth
  stating because `src/modules/pulls/latest.ts` documents the opposite habit — over-fetch
  ordered rows and reduce in JS — and its stated reason is narrow: Drizzle has no portable
  per-group `LIMIT 1`. An aggregate that needs no per-group latest row (a plain sum or count)
  should use `.groupBy()` in SQL rather than copy that precedent; the JS path would otherwise
  pull every finding of every historical run in the repo to produce three numbers per PR.
  Evidence: `src/modules/pulls/routes.ts`, `src/modules/pulls/latest.ts`,
  `node_modules/drizzle-orm/sql/functions/aggregate.js`.

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

- **2026-08-02** — `agent_runs.pr_id` is **nullable** (`onDelete: 'set null'`) while
  `reviews.pr_id` is `notNull`. Copying the PR-list "latest per PR" grouping from the reviews
  block to `agent_runs` therefore fails typecheck with `Type 'string | null' is not
  assignable to type 'string'` on the `Map<string, …>` write — a run outlives the PR it
  reviewed. Guard with `if (row.prId == null) continue`. Evidence: `src/db/schema/runs.ts`
  (`agentRuns.prId`), `src/modules/pulls/latest.ts` (`pickLatestPerPr`).

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
