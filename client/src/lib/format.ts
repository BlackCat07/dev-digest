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

/**
 * How long ago a timestamp was, compactly: `"3h"`, `"11d"`, `"2mo"`, `"1y"`.
 *
 * The unit, not the word: the caller supplies the phrasing from its own i18n
 * namespace (`"{age} ago"`), so this stays a pure formatter with no message
 * catalogue behind it — the same split the PR list's own `relativeTime` uses.
 * It differs from that one by not stopping at days: pull-request history is
 * routinely months old, and "412d" is a number a reader has to convert.
 *
 * Months are calendar-averaged (30.44 days) rather than exact. This is a
 * scanning aid — "roughly when" — and an exact month boundary would cost a date
 * library for a distinction nobody reads.
 *
 * `null` / unparseable → `"—"`, never `"now"`: a missing timestamp must not
 * render as a fresh one.
 */
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365.25)}y`;
}

/**
 * An absolute local timestamp, `YYYY-MM-DD HH:mm`.
 *
 * For the places where WHEN matters more than HOW LONG AGO — a run you are about
 * to compare against another run, where "1h" and "1h" are two different runs that
 * look like one. {@link formatAge} stays the right answer for a freshness hint.
 *
 * Built by hand rather than with `toLocaleString()`, which two components already
 * call locally, and for two reasons. It varies by the viewer's locale, so the
 * field order itself changes (`5/29/2026` vs `29.05.2026`) and a column of dates
 * stops being sortable by eye; and it renders differently under Node and under
 * the browser, which is a hydration mismatch wherever a timestamp reaches the
 * server pass. The parts below come from the local-time getters, so the clock is
 * still the reader's own — only the layout is fixed.
 *
 * `null` / unparseable → `"—"`, the same contract as `formatAge`.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * A duration in milliseconds as a seconds figure with its unit — `8200` → `"8.2s"`.
 *
 * Promoted here from two private `helpers.ts` files (`DDG-UI-002`): the agent
 * picker on the pull-request page and the Configure-run screen both render
 * `AgentRunEstimate.mean_duration_ms`, in two different route subtrees, and were
 * applying the identical arithmetic to it.
 *
 * **`null`, never `"0.0s"`, when there is no figure.** `AgentRunEstimate` reports
 * `mean_duration_ms: null` with `sample_size: 0` for an agent that has never
 * completed a run, and that is not the same statement as "this agent runs
 * instantly". Both callers turn the null into a dash — the picker from
 * `runs.picker.noEstimate`, the Configure screen from
 * `runs.configure.estimateUnavailable` — so the absence stays visible instead of
 * being rounded into a number.
 *
 * `null` rather than the dash itself, unlike {@link formatCost}: both callers
 * have their own sentence for an absent estimate and neither is a bare `—`, so
 * returning the character here would be a user-visible string this module has no
 * business owning.
 *
 * One decimal, and the unit is part of the return value — the same shape as
 * {@link formatTokenTotal}'s `" tok"` and {@link formatAge}'s `"h"`.
 */
export function formatDurationSeconds(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return `${(ms / 1000).toFixed(1)}s`;
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
