/* Unit-private pure helpers for the workspace eval dashboard.

   Every function here is a function of its arguments — no React, no fetch, no
   i18n. They exist so the component reads as a composition of parts rather than
   as arithmetic interleaved with markup, and so the two things that are easy to
   get quietly wrong are each stated once: WHEN a sparkline may be drawn, and how
   a skipped agent is named when all the skip carries is an id.

   None of it is promoted. A second consumer would move it to `src/lib/eval.ts`,
   where the metric order and the delta formatters already live — and note that
   the per-agent view next door re-derives its own change-against-the-previous-
   batch helper rather than importing this one, because `src/lib/` is not this
   task's to edit. */
import type { EvalDashboardRow, EvalRunAllResult } from "@devdigest/shared";
import { MIN_SPARKLINE_POINTS, SPARKLINE_METRIC } from "./constants";

/**
 * The row's sparkline series, or null when there is nothing to draw.
 *
 * Null and not a short array: below two points the primitive divides by zero and
 * a "trend" of one batch is a dot on an empty grid. Points whose metric was
 * never measured are dropped rather than substituted with 0 — a batch that
 * measured nothing is not a batch that scored zero — so an agent with two
 * batches of which one measured nothing correctly gets no line either.
 */
export function sparklineSeries(row: EvalDashboardRow): number[] | null {
  const series = row.trend
    .map((point) => point[SPARKLINE_METRIC])
    .filter((v): v is number => v != null);
  return series.length >= MIN_SPARKLINE_POINTS ? series : null;
}

/**
 * Whether this row has a completed batch, and therefore anything to show.
 *
 * The AGENTS section renders only these. The predicate is a type guard so the
 * card can read `row.last_batch` without a second null check and without a
 * non-null assertion at every field — a card is only built for a row that has
 * one, and the compiler should be the thing that knows it.
 *
 * `last_batch` is the MOST RECENT COMPLETED batch, so a running first batch is
 * correctly still "nothing to show": its metrics do not exist yet.
 */
export function hasBatch(row: EvalDashboardRow): row is EvalDashboardRow & {
  last_batch: NonNullable<EvalDashboardRow["last_batch"]>;
} {
  return row.last_batch != null;
}

/**
 * Whether activating this row can go anywhere.
 *
 * A batch outlives its agent, so a row may describe an agent that no longer
 * exists: it still appears — omitting it would leave a reader unable to tell a
 * deleted agent from a missing one — but there is no page to navigate to.
 */
export function isNavigable(row: EvalDashboardRow): row is EvalDashboardRow & {
  agent_id: string;
} {
  return row.agent_id != null;
}

/** One skipped agent, as the notice renders it: a name and its reason. */
export interface SkipNotice {
  agentId: string;
  /** The agent's name if the dashboard knows it, else its raw id. */
  name: string;
  reason: EvalRunAllResult["skipped"][number]["reason"];
}

/**
 * Name every skipped agent, falling back to its id.
 *
 * `EvalRunAllResult.skipped` carries only an `agent_id`, and the notice reads
 * "Skipped {name} — {reason}"; resolving the name against the rows already on
 * screen is what keeps that sentence readable. The fallback is the id and never
 * an empty string: a skip nobody can attribute is worse than an ugly one.
 *
 * Keyed on the row's `agent_id` and skipping the null ones on purpose — a map
 * keyed on a nullable value collapses every agent-deleted row into one bucket,
 * and a deleted agent is never a skip target anyway.
 */
export function skipNotices(
  result: EvalRunAllResult | undefined,
  rows: readonly EvalDashboardRow[],
): SkipNotice[] {
  if (!result) return [];
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.agent_id && row.agent_name) names.set(row.agent_id, row.agent_name);
  }
  return result.skipped.map((skip) => ({
    agentId: skip.agent_id,
    name: names.get(skip.agent_id) ?? skip.agent_id,
    reason: skip.reason,
  }));
}
