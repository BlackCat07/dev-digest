/**
 * Pure "newest row per PR" reduction, shared by the PR-list aggregates.
 *
 * The list endpoint denormalizes nothing: the latest review's score and the
 * latest completed run's cost are both computed on read from one `IN`-query
 * apiece. Postgres has no portable per-group `LIMIT 1` in Drizzle's builder, so
 * both queries over-fetch ordered newest-first and collapse in JS. Extracted
 * here so that collapse is testable without a live database.
 */

/**
 * First row wins per `prId`. **Input MUST already be sorted newest-first** —
 * this function does no sorting and cannot detect an unsorted caller.
 *
 * Rows with a null `prId` are skipped: `agent_runs.pr_id` is nullable
 * (`onDelete: 'set null'`), so a run whose PR was deleted survives with no PR
 * to attribute it to.
 */
export function pickLatestPerPr<T extends { prId: string | null }>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.prId == null) continue;
    if (!latest.has(row.prId)) latest.set(row.prId, row);
  }
  return latest;
}
