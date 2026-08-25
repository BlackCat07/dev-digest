import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - MultiAgentRunRequest its request body
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentRunEstimate     what one agent's next run is expected to take/cost
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/**
 * A finding as surfaced in a multi-agent column (subset of FindingRecord).
 *
 * It carries everything the tabs-mode detail panel renders — the rationale, the
 * confidence, the optional suggested fix and the accept/dismiss state — so the
 * multi-agent view is served by ONE read. The alternative (a second read of the
 * pull request's reviews, joined client-side) reintroduces the per-agent re-run
 * double-count trap recorded in `client/INSIGHTS.md`, 2026-08-11.
 *
 * `accepted_at` / `dismissed_at` are `nullable` rather than `nullish` to match
 * `FindingRecord`: the field is always present, and `null` means "not acted on".
 */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown; absent when the agent proposed no fix
  confidence: z.number().min(0).max(1),
  kind: z.string().nullish(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /**
   * The run's OWN status, straight from `agent_runs.status`. `cancelled` is one
   * of the four values that column writes (`POST /runs/:id/cancel` produces it),
   * and it is distinct from `failed`: reporting a cancelled run as failed is
   * untrue.
   */
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  /**
   * The reason the RUN itself recorded — `agent_runs.error` — and `null` on a
   * run that did not fail.
   *
   * Distinct from `summary`, which is the `reviews` row's summary and is `null`
   * for a run that failed before it wrote one. AC-68 asks for the outcome AND
   * the reason the run recorded, so without this field a failed column can only
   * show the status word: the reason exists in the database and stops at the
   * mapper. A cancelled run puts its cancellation note here too, which is the
   * same column and the same rendering.
   */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/**
 * Body of POST /pulls/:id/multi-agent-run — the dedicated create route.
 *
 * The list is non-empty HERE, where an empty list is simply not a request this
 * route accepts. `ReviewRunRequest` (contracts/review-api.ts) deliberately does
 * NOT carry the same `.min(1)`: on `POST /pulls/:id/review` an empty `agentIds`
 * has its own named refusal, and a schema rejection would pre-empt it.
 */
export const MultiAgentRunRequest = z.object({
  agentIds: z.array(z.string()).min(1),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

// ---------------------------------------------------------------------------
// Per-agent run estimates (what a fan-out is about to cost, before committing)
// ---------------------------------------------------------------------------

/**
 * One agent's mean run duration and cost, over a bounded window of that agent's
 * most recent completed runs.
 *
 * `null` and `0` are NEVER interchangeable here. `mean_duration_ms: null` with
 * `sample_size: 0` means "this agent has never completed a run", which the UI
 * renders as a dash — not as `0 ms`. `mean_cost_usd: null` means no sampled run
 * recorded a cost (an unpriced model), which is not the same as a run that
 * genuinely cost nothing.
 */
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  mean_duration_ms: z.number().nullable(),
  mean_cost_usd: z.number().nullable(),
  /** How many runs both means were computed from. 0 ⇒ both means are null. */
  sample_size: z.number().int(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
