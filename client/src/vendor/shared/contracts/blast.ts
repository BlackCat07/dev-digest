/**
 * Blast Radius — the contracts L04 adds on top of the `BlastRadius` document in
 * ./brief.js.
 *
 * `BlastRadius` there is the PR **Brief**'s composed shape: three fields, one of
 * them a required `summary` string. It is deliberately LEFT AS IS and nothing here
 * edits it — this package is extend-by-new-file (see ./intent.js for the same move
 * against `PrIntentRecord`). `ChangedSymbol`, `BlastCaller` and `DownstreamImpact`
 * are IMPORTED and reused rather than redeclared: those three already described
 * exactly this data and had no consumer, and two vocabularies for one concept is
 * the drift this package exists to prevent.
 *
 * Three differences carry the whole feature, and each is a constraint rather than
 * an embellishment:
 *
 *  - **No `summary`.** The Brief's shape requires one, which only a model can
 *    write. This map is derived entirely from the persistent index, so the API
 *    response has no such field and the main path makes no model call. A summary
 *    would be a separate, explicitly optional endpoint.
 *  - **An empty map is never silently empty.** `status` says which of three things
 *    an empty `downstream` means — a truthful "nothing calls this" (`ok`), an index
 *    that covers only part of the repository (`partial`), or no usable index at all
 *    (`degraded`) — and `reason` names the cause. A consumer that reads only the
 *    arrays cannot tell those apart, which is precisely the inference this feature
 *    must not invite.
 *  - **Order is meaning.** `downstream[].callers` arrives sorted by the caller
 *    file's importance (PageRank-based `file_rank`) and truncated to
 *    `MAX_CALLERS_PER_SYMBOL` per symbol, so the first entries are the ones worth
 *    reading first. `truncated` says when there were more.
 */
import { z } from 'zod';
import { ChangedSymbol, DownstreamImpact } from './brief.js';

/**
 * How much of the answer the index could actually support.
 *
 * Deliberately NOT the facade's `DegradedReason`-style boolean: a reviewer needs
 * to know whether "no callers" is a finding or a gap, and a single `degraded` flag
 * collapses `partial` into `ok` on the way out. Mirrors `IntentStatus`'s
 * ok/partial split in ./intent.js for the same reason.
 *
 *  - `ok`       — the index covers this repository; the map is complete.
 *  - `partial`  — the index exists but covers only some files; callers may be
 *                 missing and absence proves nothing.
 *  - `degraded` — nothing usable was read. Every array is empty because no
 *                 analysis happened, not because there is no impact.
 */
export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

/**
 * Why the status is not `ok`. Null when it is.
 *
 * `no_changed_files` is the one that catches a real operational trap rather than a
 * code path: `pr_files` is written ONLY by `GET /pulls/:id`, so a pull request
 * whose detail has never been opened has no changed files to analyse and this
 * route says so instead of answering an empty map (`server/INSIGHTS.md`,
 * 2026-08-11).
 */
export const BlastReason = z.enum([
  'flag_off',
  'index_missing',
  'index_partial',
  'index_failed',
  'repo_too_large',
  'no_changed_files',
]);
export type BlastReason = z.infer<typeof BlastReason>;

/**
 * One HTTP endpoint or scheduled job that may be reached from the changed code.
 *
 * Carries its own `via` so the UI can say WHY it is listed — the reachable file
 * whose `file_facts` declared it — and `depth`, the number of reverse-import hops
 * from the changed file (1 = a direct importer). Both are facts from the index;
 * neither is inferred.
 */
export const BlastEndpoint = z.object({
  /** "METHOD /path" for an endpoint, or the job's name for a cron. */
  label: z.string(),
  kind: z.enum(['endpoint', 'cron']),
  /** Repo-relative file that declares it. */
  file: z.string(),
  /**
   * Reverse-import hops from the changed file, bounded by the walk.
   *
   * **`0` means the changed file declares it itself** — not a missing value. That is
   * the strongest form of impact in the map and deliberately sorts first: if a PR
   * edits the file holding `GET /pulls/:id`, that endpoint is affected directly
   * rather than through a dependency.
   */
  depth: z.number().int(),
});
export type BlastEndpoint = z.infer<typeof BlastEndpoint>;

/**
 * `DownstreamImpact` plus what the UI needs to render one collapsible symbol row.
 *
 * The base shape's `callers` / `endpoints_affected` / `crons_affected` are kept
 * verbatim so a Brief composed later reads the same fields. `caller_count` is the
 * count BEFORE truncation, which is why it can exceed `callers.length` — the
 * header in the design reads "14 callers" while the expanded list shows the top
 * ones, and those two numbers are allowed to differ.
 */
export const BlastDownstream = DownstreamImpact.extend({
  /** The changed symbol's own declaring file, for the row's file:line link. */
  file: z.string(),
  kind: z.string(),
  /** Total resolved callers before the per-symbol cap. */
  caller_count: z.number().int(),
  truncated: z.boolean(),
  /** Per-caller line numbers travel in `callers`; this is the endpoint detail. */
  impacted: z.array(BlastEndpoint),
});
export type BlastDownstream = z.infer<typeof BlastDownstream>;

/** The four figures the design's stat row shows, precomputed so it cannot drift. */
export const BlastCounts = z.object({
  symbols: z.number().int(),
  callers: z.number().int(),
  endpoints: z.number().int(),
  crons: z.number().int(),
});
export type BlastCounts = z.infer<typeof BlastCounts>;

/**
 * Response of `GET /pulls/:id/blast` — the impact map for one pull request.
 *
 * Derived fresh on every read from the persistent index, with no row of its own,
 * no cache table and no freshness rule; there is nothing here a second reader
 * could disagree about. `changed_files` is echoed back because it is the input the
 * whole map is a function of — without it, an empty answer is unattributable.
 */
export const PrBlastRadius = z.object({
  pr_id: z.string(),
  /** Repo-relative paths this PR changes, as `pr_files` recorded them. */
  changed_files: z.array(z.string()),
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(BlastDownstream),
  /**
   * Every endpoint and cron in the blast radius, whatever reached it — the union the
   * stat row counts.
   *
   * Strictly wider than the per-symbol lists in `downstream`, and the difference is
   * not redundancy. Two kinds of impact belong to the PR rather than to any single
   * changed symbol: a route the changed file DECLARES ITSELF (`depth: 0` — the most
   * direct impact a diff can have), and a route reached from a changed file that
   * declares no symbols at all. Both were invisible when the map only carried
   * per-symbol attribution, measured on a real PR that edited a `routes.ts`.
   */
  impacted: z.array(BlastEndpoint),
  counts: BlastCounts,
  status: BlastStatus,
  reason: BlastReason.nullable(),
  /** Head commit the index was built at, for pinning file:line links. null if unknown. */
  indexed_sha: z.string().nullable(),
});
export type PrBlastRadius = z.infer<typeof PrBlastRadius>;
