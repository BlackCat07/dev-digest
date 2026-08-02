/* format.ts — pure display formatters shared across route subtrees (the PR list,
   the PR-detail timeline, the run-trace drawer, the verdict banner). Same role as
   github-urls.ts / model-label.ts: no React, no fetch, no i18n. */

/**
 * Adaptive USD cost. A review run costs anywhere from $0.0004 to a few dollars,
 * so a single fixed precision is wrong at one end or the other: 2dp renders a
 * real sub-cent run as a misleading "$0.00", while 4dp makes a dollar run
 * unreadable.
 *
 *   null / undefined → "—"       absent data — NEVER "$0.00"
 *   0                → "$0"      a genuinely free model (e.g. z-ai/glm-4.7-flash)
 *   < $0.01          → 4dp       "$0.0013"
 *   < $1             → 3dp       "$0.014"
 *   ≥ $1             → 2dp       "$1.24"
 *
 * Accepting `undefined` is load-bearing, not defensive: traces persisted while
 * cost was removed from the contract have no `stats.cost_usd` key at all, and
 * nothing Zod-parses a stored trace on the way out of the API.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  const abs = Math.abs(usd);
  return `$${usd.toFixed(abs < 0.01 ? 4 : abs < 1 ? 3 : 2)}`;
}

/**
 * Total tokens a run consumed, thousands-grouped (e.g. "9,119 tok").
 *
 * The locale is pinned to en-US rather than left to the environment: the app
 * ships only `messages/en`, and an env-dependent separator would make the jsdom
 * tests non-deterministic.
 */
export function formatTokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn == null && tokensOut == null) return "—";
  return `${((tokensIn ?? 0) + (tokensOut ?? 0)).toLocaleString("en-US")} tok`;
}

/** Token in→out flow, thousands-scaled (e.g. "8.2K→1.3K", "12K→1.5K"). */
export function formatTokenFlow(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn == null || tokensOut == null) return "—";
  const k = (n: number) => `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${k(tokensIn)}→${k(tokensOut)}`;
}
