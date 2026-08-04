# PR-level aggregates: score, cost, findings

Referenced by name from `src/modules/pulls/routes.ts`. Read this before touching any
figure the Pull Requests list shows, because **no PR-level number on this schema is a
single row's value** — and the three columns beside each other deliberately do not share a
basis.

## The fan-out that makes it hard

One review of one PR runs N agents. `runOneAgent`
(`src/modules/reviews/run-executor.ts`) writes, **per agent**:

- one `agent_runs` row — timing, tokens, `cost_usd`, `status`
- one `reviews` row — verdict, `score`, and the `findings` hanging off it

So "the latest review of this PR" is not the PR's review; it is whichever agent finished
last. Derive a PR figure from that single newest row and you get a number that changes
depending on which agent happened to finish first. On real dev data this showed up as PR #1
reporting `$0.00064` of an actual `$0.0051` — one agent's cost out of six runs.

## The three bases

| Column | Basis | A re-run of one agent… |
|---|---|---|
| **SCORE** | **worst** (`minScore`) over each agent's **latest** `reviews` row | replaces that agent's score |
| **COST** | **sum** (`sumCosts`) over each agent's **latest `status='done'`** `agent_runs` row | replaces that agent's cost |
| **FINDINGS** | **sum over every run**, latest or not, grouped in SQL | **adds** to the counts |

The first two are "latest per agent"; the third is "all runs ever". That is not an
oversight:

- **SCORE takes the worst**, not the mean or the newest, so one agent finding a blocker
  can never be hidden by a sibling agent that approved.
- **COST filters `status='done'`** because failed / cancelled / running rows persist
  `cost_usd = null` and zeroed tokens. Counting the newest row outright would erase an
  agent's last real figure the moment it hit a quota error. It also keeps COST aggregating
  over the same agent set as SCORE, which likewise only ever sees successful runs.
- **FINDINGS sums everything** because the column has to equal the "Agent runs" tab badge
  on the PR detail page, which counts every persisted review's findings. Harmonising it
  with its two neighbours would break that equality — check the badge before you try.

Where they live: `minScore`, `sumCosts` and `groupLatestPerAgent` in
`src/modules/pulls/latest.ts`; `countFindingsBySeverity` in `src/modules/pulls/status.ts`.
All pure, all unit-tested without a database.

## Four traps, each already paid for

### 1. `reviews.score`, never `agent_runs.score`

`agent_runs.score` arrived in migration `0006_sharp_mordo.sql` **with no backfill**. Every
run created before it carries `score = null` while its `reviews` row still holds the real
figure. Reading score off `agent_runs` would fold the list's two `IN`-queries into one and
silently blank the score for older PRs. Don't.

### 2. A null `agent_id` is not a group

`agent_runs.agent_id` is nullable (`onDelete: 'set null'`) and `reviews.agent_id` carries
**neither an FK nor `notNull`**. Keying a per-agent `Map` on the raw value collapses every
agent-deleted row into one bucket, and the COST sum then drops all but one of them — no
error, just a quietly smaller number. `groupLatestPerAgent` keys on `agentId ?? row.id`,
prefixed (`agent:` / `row:`) so a row id can never collide with an agent id.

Unlike trap 3 this does **not** fail typecheck, because the key is assembled by hand.

### 3. A null `pr_id` outlives its PR

`agent_runs.pr_id` is nullable (`onDelete: 'set null'`) while `reviews.pr_id` is `notNull`
— a run outlives the PR it reviewed. Copying the reviews-side grouping to `agent_runs`
fails typecheck with `Type 'string | null' is not assignable to type 'string'`. The guard
is `if (row.prId == null) return`, not a cast.

### 4. `null` cost and `0` cost are different

`sumCosts` returns `null` only when **no** row carries a figure. `null` means "no cost
data" and renders as an em-dash; `0` is a genuinely free model and renders `$0`. So an
all-null set leaves the column empty, but one free run mixed in with nulls still totals
`0`. Preserve that distinction through any refactor.

## Why the reductions are in JS, and the counting is not

Drizzle's builder has no portable per-group `LIMIT 1` for Postgres, so the SCORE and COST
queries **over-fetch ordered newest-first** and collapse in JS. `groupLatestPerAgent`
therefore *requires* its input already sorted newest-first — it does no sorting and cannot
detect an unsorted caller. If you touch the `orderBy`, you have changed the reduction.

FINDINGS needs no per-group collapse at all, so it is counted in SQL:
`GROUP BY (reviews.pr_id, findings.severity)` returns at most three rows per PR instead of
every finding ever written. Note the join path — `findings` has neither `pr_id` nor
`run_id`; `findings.review_id → reviews.id` is the only route to a PR, so the PR filter
sits on the joined table.

## The severity blind spot

`findings.severity` is a plain `text` column — no pg enum, no `CHECK`. Anything outside the
`Severity` contract enum is storable, and both rollups **ignore** it rather than guessing a
bucket. Consequences, accepted on both sides of the wire:

- the three counters can sum to **less** than a PR's total finding count;
- such a finding is unreachable by a severity filter.

Two shapes exist on purpose: `rollupSeverities` returns lowercase keys (its own internal
shape) while `countFindingsBySeverity` returns the uppercase wire shape
`FindingsBySeverity`, which mirrors the `Severity` enum so the client can index its token
registry with it directly. Don't "unify" them.

One more: `EMPTY_FINDINGS_BY_SEVERITY` is **frozen and shared** by every never-reviewed PR
in a response. `countFindingsBySeverity` builds a fresh object per PR precisely so it can
never alias it.

## Related

- Spec for the findings half: [`../specs/findings-severity.md`](../specs/findings-severity.md)
- How the client renders these three columns: `../../client/specs/findings-severity.md`
- The findings that produced this doc, with dates: [`../INSIGHTS.md`](../INSIGHTS.md)
  (2026-08-02 and 2026-08-03 entries under *What Doesn't Work*, *Codebase Patterns* and
  *Recurring Errors & Fixes*)
