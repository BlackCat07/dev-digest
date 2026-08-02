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

_No entries yet._

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
