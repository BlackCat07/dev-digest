/* Pure helpers for the Configure-run screen. No React, no fetch, no i18n —
   everything here is a function of its arguments, so the arithmetic AC-57…AC-59
   pin down can be read (and tested) without mounting a tree.

   `import type` from `@devdigest/shared` is mandatory, not stylistic: a runtime
   value import from that barrel pulls its ESM `.js` re-exports into webpack and
   500s every route that transitively reaches it, while `tsc` and `vitest` both
   stay green (`client/INSIGHTS.md`, 2026-08-03). */

import type { AgentRunEstimate, PrMeta, ReviewRecord } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { NON_OPEN_PR_STATUSES } from "./constants";

/**
 * The repository's open pull requests, newest number first (AC-53).
 *
 * **No cap and no truncation.** A repository with 400 open pull requests yields
 * 400 options: a cap would silently hide the pull request the reviewer came for
 * (EC-20), and "the one I wanted isn't in the list" is indistinguishable from
 * "it isn't imported yet".
 *
 * Descending number is a *total* order, because the number is unique per
 * repository — so two reads of the same list can never disagree about the
 * order, which `updated_at` (nullable, and equal across a bulk import) cannot
 * promise.
 */
export function openPullsDescending(pulls: readonly PrMeta[]): PrMeta[] {
  return pulls.filter((p) => !NON_OPEN_PR_STATUSES.has(p.status)).sort((a, b) => b.number - a.number);
}

/**
 * The most recent review each agent recorded on one pull request, by agent id.
 *
 * A review whose `agent_id` is null is skipped rather than bucketed: the column
 * carries no FK and no `notNull` (`server/INSIGHTS.md`, 2026-08-03), so keying
 * on the raw value would collapse every agent-deleted review into one entry —
 * and here there is no card to attach such a review to anyway.
 *
 * `created_at` alone is not a total order (two runs of one fan-out share a
 * timestamp), so the review id breaks the tie and the result is stable across
 * two reads of the same list.
 */
export function latestReviewByAgent(reviews: readonly ReviewRecord[]): Map<string, ReviewRecord> {
  const latest = new Map<string, ReviewRecord>();
  for (const review of reviews) {
    const agentId = review.agent_id;
    if (agentId == null) continue;
    const held = latest.get(agentId);
    if (!held || compareRecency(review, held) > 0) latest.set(agentId, review);
  }
  return latest;
}

function compareRecency(a: ReviewRecord, b: ReviewRecord): number {
  const ta = Date.parse(a.created_at) || 0;
  const tb = Date.parse(b.created_at) || 0;
  return ta !== tb ? ta - tb : a.id.localeCompare(b.id);
}

/** The estimates keyed by agent, for a per-card lookup. */
export function estimatesByAgent(
  estimates: readonly AgentRunEstimate[],
): Map<string, AgentRunEstimate> {
  return new Map(estimates.map((e) => [e.agent_id, e]));
}

/** What the run action's aggregate shows. Either half may be absent on its own. */
export interface AggregateEstimate {
  /** The LONGEST selected mean, not the total — see below. `null` ⇒ unavailable. */
  durationMs: number | null;
  /** The SUM of the selected means. `null` ⇒ no selected agent recorded a cost. */
  costUsd: number | null;
}

/**
 * The aggregate beside the run action (AC-57, AC-58, AC-59).
 *
 * **Duration is the maximum and cost is the sum**, and the asymmetry is the
 * whole point: the agents now run concurrently (a bounded pool of 4 replaced
 * the executor's sequential loop), so the fan-out finishes when its slowest
 * member does, while every member is still paid for. On the old sequential
 * executor the duration would have been a sum too.
 *
 * An agent with no estimate contributes to neither half (AC-58) rather than
 * contributing a zero — a never-run agent must not drag a mean down or make a
 * free fan-out look priced. When nothing is left, both halves are `null` and
 * the caller renders "unavailable", never `0.0s · $0.00` (AC-59).
 *
 * The two halves are computed independently because they can genuinely differ:
 * `mean_cost_usd` is null whenever none of an agent's sampled runs recorded a
 * cost (an unpriced model), while its `mean_duration_ms` is perfectly good.
 */
export function aggregateEstimate(
  estimates: readonly (AgentRunEstimate | undefined)[],
): AggregateEstimate {
  const durations = estimates
    .map((e) => e?.mean_duration_ms)
    .filter((v): v is number => v != null);
  const costs = estimates.map((e) => e?.mean_cost_usd).filter((v): v is number => v != null);
  return {
    durationMs: durations.length > 0 ? Math.max(...durations) : null,
    costUsd: costs.length > 0 ? costs.reduce((sum, v) => sum + v, 0) : null,
  };
}

/**
 * An estimated cost at the design's money precision — `$0.06`, `$0.20`.
 *
 * Two decimals rather than `lib/format.ts`'s adaptive precision, which renders
 * `0.2` as `$0.200` and `0.06` as `$0.060`: this figure sits beside a duration
 * in one short line and is read as a price, so the trailing digit is noise.
 * Below a cent that argument inverts — 2dp would print `$0.00` for a real cost,
 * which is the exact trap `formatCost` exists to avoid — so the shared
 * formatter takes over there and keeps its four decimals.
 */
export function formatEstimateCost(usd: number): string {
  if (usd !== 0 && Math.abs(usd) < 0.01) return formatCost(usd);
  return `$${usd.toFixed(2)}`;
}
