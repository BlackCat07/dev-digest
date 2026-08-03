/**
 * Pure reductions behind the PR-list aggregates, kept out of the route so they
 * are testable without a live database.
 *
 * A review fans out over N agents and writes one `agent_runs` row + one
 * `reviews` row PER AGENT, so neither list column is a single row's value:
 * COST is the sum of what every agent spent, SCORE is the worst agent's verdict.
 * Both aggregate over each agent's LATEST row — re-running one agent replaces
 * that agent's figure instead of double-counting it.
 *
 * The list endpoint denormalizes nothing: both columns are computed on read from
 * one `IN`-query apiece. Postgres has no portable per-group `LIMIT 1` in
 * Drizzle's builder, so both queries over-fetch ordered newest-first and
 * collapse in JS here.
 */

/**
 * Bucket rows by `prId`, keeping only the newest row per agent within each
 * bucket. **Input MUST already be sorted newest-first** — this function does no
 * sorting and cannot detect an unsorted caller.
 *
 * Rows with a null `prId` are skipped: `agent_runs.pr_id` is nullable
 * (`onDelete: 'set null'`), so a run whose PR was deleted survives with no PR
 * to attribute it to.
 *
 * A null `agentId` is NOT a group: `agent_runs.agent_id` is nullable too
 * (`onDelete: 'set null'`), and `reviews.agent_id` carries no FK at all, so
 * collapsing those rows together would silently drop every run whose agent was
 * deleted but one. Such rows fall back to `fallbackKey` (the row's own id), so
 * each keeps its own slot and still counts towards the sum.
 */
export function groupLatestPerAgent<T extends { prId: string | null; agentId: string | null }>(
  rows: T[],
  fallbackKey: (row: T, index: number) => string,
): Map<string, T[]> {
  const byPr = new Map<string, Map<string, T>>();
  rows.forEach((row, i) => {
    if (row.prId == null) return;
    const agents = byPr.get(row.prId) ?? new Map<string, T>();
    byPr.set(row.prId, agents);
    // Prefixed so a fallback id can never collide with a real agent id.
    const key = row.agentId == null ? `row:${fallbackKey(row, i)}` : `agent:${row.agentId}`;
    if (!agents.has(key)) agents.set(key, row);
  });
  const out = new Map<string, T[]>();
  for (const [prId, agents] of byPr) out.set(prId, [...agents.values()]);
  return out;
}

/**
 * Total USD across the given runs, or null when NO run carries a figure.
 *
 * The null/zero distinction is load-bearing and survives the sum: `null` means
 * "no cost data" and renders "—", while `0` is a genuinely free model and
 * renders "$0" (see `formatCost` on the client). So an all-null set leaves the
 * column empty, but a free run mixed in with nulls still totals `0`.
 */
export function sumCosts(rows: { costUsd: number | null }[]): number | null {
  let total: number | null = null;
  for (const row of rows) {
    if (row.costUsd == null) continue;
    total = (total ?? 0) + row.costUsd;
  }
  return total;
}

/**
 * The worst (lowest) score across the given reviews — the signal the list's
 * score ring gates on, so one agent finding a blocker can't be hidden by a
 * sibling agent that approved. Null-score rows are ignored; all-null (or no
 * rows) yields null, which the list reads as "never reviewed".
 */
export function minScore(rows: { score: number | null }[]): number | null {
  let worst: number | null = null;
  for (const row of rows) {
    if (row.score == null) continue;
    if (worst == null || row.score < worst) worst = row.score;
  }
  return worst;
}
