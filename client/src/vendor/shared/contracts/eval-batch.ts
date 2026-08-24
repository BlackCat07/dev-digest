/**
 * Eval Pipeline — the contracts L06 adds on top of `EvalCase` / `EvalRun` in
 * ./knowledge.js and the API shapes in ./eval-ci.js.
 *
 * Extend-by-new-file, like the rest of this package: nothing here edits an
 * existing symbol. `EvalCase`, `EvalCaseInput`, `EvalRun`, `EvalRunRecord`,
 * `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`, `EvalPerTrace` and
 * `EvalOwnerKind` are all consumed unchanged — `EvalOwnerKind` keeps both
 * `skill` and `agent`, and the `skill` half stays unused on purpose.
 *
 * Three shape decisions carry the whole feature:
 *
 *  - **A batch is the unit of comparison, not a run.** `eval_runs` is one row
 *    per case execution with no batch identity, so "compare these two runs" and
 *    "which prompt produced this number" are not expressible from it.
 *    `EvalBatch` therefore carries the agent config version number AND a
 *    snapshot of the system prompt and model text it ran with: a version row is
 *    deleted with its agent, and a comparison that renders "the prompt that
 *    produced this" from a row which may be gone is a comparison that can start
 *    lying.
 *  - **Every metric and count is `.nullable()`, and null means "not
 *    measured".** A metric with a zero denominator — no `must_find` anchor in
 *    the batch, no citation kept or dropped — is null, never 0. Nullable and
 *    never optional: an absent key cannot carry that distinction through a jsonb
 *    round-trip, and a reader seeing `undefined` cannot tell "we could not
 *    measure recall" from "recall is 0%".
 *  - **No numeric range keyword anywhere in this file.** The shipped `EvalRun`
 *    and `EvalDashboard` bound their metrics with `.min(0).max(1)`. A Zod object
 *    carrying numeric range keywords breaks when used as an LLM
 *    structured-output schema against Anthropic via OpenRouter, surfacing only
 *    as `400 Provider returned error`. These types are persistence and API
 *    shapes and are never a response format; omitting the bounds keeps that true
 *    even if someone later reaches for one.
 */
import { z } from 'zod';
import { EvalCase } from './knowledge.js';

// ===========================================================================
// Cases — expectation, anchor, outcome, refusals
// ===========================================================================

/**
 * What a case asserts about the agent's output.
 *
 * First-class rather than inferred from the expected output, because the UI
 * filters and counts by it and a batch's metrics aggregate by it.
 */
export const EvalExpectation = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * One place in a diff that a case is about: a file plus an inclusive line range.
 *
 * Every line number is a NEW-side diff line — the same side the citation
 * grounding gate indexes — and `low_line <= high_line` always. The producer
 * normalises, because `Finding` does not guarantee `start_line <= end_line` and
 * the live table holds rows where it does not.
 */
export const EvalAnchor = z.object({
  file: z.string(),
  low_line: z.number().int(),
  high_line: z.number().int(),
});
export type EvalAnchor = z.infer<typeof EvalAnchor>;

/**
 * How one case's execution ended.
 *
 * Three values and not a boolean: a case that never executed is neither passed
 * nor failed, and it still counts in the batch's covered total.
 */
export const EvalCaseOutcome = z.enum(['passed', 'failed', 'not_run']);
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/**
 * Why a case reached `not_run` — present whenever the outcome is `not_run`, and
 * null otherwise. A `not_run` case is distinct from a failure everywhere it is
 * rendered: nothing was measured, rather than measured and wrong.
 */
export const EvalNotRunReason = z.enum([
  'deadline',
  'provider_error',
  'diff_unparseable',
  'not_scorable',
  'cancelled',
]);
export type EvalNotRunReason = z.infer<typeof EvalNotRunReason>;

/**
 * Every named refusal this feature answers with, so a client renders the reason
 * rather than a bare status code.
 */
export const EvalRefusalReason = z.enum([
  'review_has_no_agent',
  'finding_has_no_decision',
  'duplicate_source_finding',
  'conflicting_anchor',
  'case_limit_reached',
  'diff_too_large',
  'anchor_not_in_diff',
  'cross_agent_compare',
  'batch_already_running',
]);
export type EvalRefusalReason = z.infer<typeof EvalRefusalReason>;

/**
 * A case as an agent's eval set renders it: the shipped `EvalCase` fields plus
 * what this feature adds. A NEW symbol precisely so `EvalCase` is not reshaped.
 *
 * `source_finding_id` is provenance and carries no foreign key: deleting the
 * finding a case came from neither deletes the case nor blanks the only trace of
 * where its expectation came from. `edited` says a human has changed the case
 * since it was derived, so a derived case and a hand-tuned one are
 * distinguishable.
 *
 * `last_execution` is the most recent execution of this case in any batch, and
 * null when it has never run. Its counts are nullable because a `not_run` case
 * produced no output to count.
 */
export const EvalAgentCase = EvalCase.extend({
  expectation: EvalExpectation,
  expected_anchors: z.array(EvalAnchor),
  source_finding_id: z.string().nullable(),
  edited: z.boolean(),
  last_execution: z
    .object({
      outcome: EvalCaseOutcome,
      not_run_reason: EvalNotRunReason.nullable(),
      expected_count: z.number().int().nullable(),
      actual_count: z.number().int().nullable(),
    })
    .nullable(),
});
export type EvalAgentCase = z.infer<typeof EvalAgentCase>;

/**
 * The body of a save of a hand-edited case.
 *
 * `expected_output` stays `unknown`, as it is on the shipped `EvalCaseInput` —
 * that is what lets the expected anchors live inside it without reshaping
 * anything. `name` carries no length keyword here: this file holds no range
 * keywords at all (see the header), and the route declares its own schema,
 * which is where a non-empty name is enforced.
 */
export const EvalCaseSave = z.object({
  name: z.string(),
  input_diff: z.string(),
  expectation: EvalExpectation,
  expected_anchors: z.array(EvalAnchor),
  expected_output: z.unknown(),
});
export type EvalCaseSave = z.infer<typeof EvalCaseSave>;

// ===========================================================================
// Batches — one on-demand run of a whole set, and its results
// ===========================================================================

/** Where a batch is. `error` is the batch's own failure, never a case's. */
export const EvalBatchStatus = z.enum(['running', 'complete', 'error']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/**
 * One execution of an agent's whole eval set, and the unit two runs compare as.
 *
 * `agent_id` is nullable, and `agent_name` with it: deleting an agent leaves its
 * batches readable with the agent presented as unavailable, rather than deleting
 * the history. Anything grouping batches by agent therefore needs a fallback
 * key — keying a map on the raw nullable value collapses every agent-deleted row
 * into one bucket, and a cost sum then drops all but one of them with no error.
 *
 * `system_prompt_snapshot` and `model_snapshot` are written once, when the batch
 * is created, and never re-read from the agent afterwards.
 *
 * Every metric and count is nullable: a batch is `running` before it has any, a
 * zero denominator yields null rather than 0, and `cost_usd` is null — not a
 * smaller sum — when any executed case's cost is unavailable.
 */
export const EvalBatch = z.object({
  id: z.string(),
  workspace_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  agent_version: z.number().int(),
  system_prompt_snapshot: z.string(),
  model_snapshot: z.string(),
  status: EvalBatchStatus,
  label: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  cases_covered: z.number().int().nullable(),
  cases_passed: z.number().int().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
  /** Why the batch itself ended in `error` — a deadline, not a case's failure. */
  error: z.string().nullable(),
});
export type EvalBatch = z.infer<typeof EvalBatch>;

/**
 * One case's result inside a batch.
 *
 * `kept_count` / `dropped_count` are the citation-grounding gate's own counts
 * for this case, which is where citation accuracy comes from — no second
 * grounding pass and no new logic.
 */
export const EvalBatchCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  outcome: EvalCaseOutcome,
  not_run_reason: EvalNotRunReason.nullable(),
  expected_count: z.number().int().nullable(),
  actual_count: z.number().int().nullable(),
  kept_count: z.number().int().nullable(),
  dropped_count: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchCaseResult = z.infer<typeof EvalBatchCaseResult>;

/**
 * What the scorer returns for a whole batch: three nullable metrics and the
 * tallies they were computed from.
 *
 * The tallies are always present — a batch with nothing to find has zero true
 * positives, and zero is a number — while a metric over a zero denominator is
 * null, because "nothing to measure" is not a score of 0.
 */
export const EvalMetrics = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  true_positives: z.number().int(),
  false_negatives: z.number().int(),
  false_positives: z.number().int(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;

/**
 * Two batches of one agent, side by side.
 *
 * Each metric block reads earlier → later → signed change, and `change` is null
 * whenever either side is null, so "not measured" never renders as no movement.
 * `same_config` says both batches ran the same agent config version, which is
 * what lets a prompt-diff region state that the prompt is unchanged instead of
 * drawing an empty box. Cost is compared the same way as a metric, and is not
 * one — it carries currency, not a 0–1 ratio.
 */
export const EvalComparison = z.object({
  earlier_batch_id: z.string(),
  later_batch_id: z.string(),
  earlier_agent_version: z.number().int(),
  later_agent_version: z.number().int(),
  earlier_system_prompt: z.string(),
  later_system_prompt: z.string(),
  same_config: z.boolean(),
  recall: z.object({
    earlier: z.number().nullable(),
    later: z.number().nullable(),
    change: z.number().nullable(),
  }),
  precision: z.object({
    earlier: z.number().nullable(),
    later: z.number().nullable(),
    change: z.number().nullable(),
  }),
  citation_accuracy: z.object({
    earlier: z.number().nullable(),
    later: z.number().nullable(),
    change: z.number().nullable(),
  }),
  cost_usd: z.object({
    earlier: z.number().nullable(),
    later: z.number().nullable(),
    change: z.number().nullable(),
  }),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

// ===========================================================================
// Dashboard — per agent, and across the workspace
// ===========================================================================

/**
 * The window a dashboard read covers. `all` is bounded in practice by the
 * 50-batch-per-agent retention cap, so it is not an unbounded query.
 */
export const EvalPeriod = z.enum(['7d', '30d', '90d', 'all']);
export type EvalPeriod = z.infer<typeof EvalPeriod>;

/**
 * One chronological point on an agent's metric trend — one retained batch.
 *
 * Distinct from the shipped `EvalTrendPoint`, whose three metrics are
 * `z.number()` and therefore cannot express a batch that measured nothing.
 */
export const EvalBatchTrendPoint = z.object({
  batch_id: z.string(),
  started_at: z.string(),
  agent_version: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchTrendPoint = z.infer<typeof EvalBatchTrendPoint>;

/**
 * One agent's row on the eval dashboard, and the whole payload of that agent's
 * own eval page.
 *
 * `agent_id` and `agent_name` are nullable for the same reason `EvalBatch`'s
 * are: a batch outlives its agent and stays readable with the agent presented
 * as unavailable. `last_batch` is null for an agent that has never completed
 * one, and `trend` is then empty — an agent with no numbers appears, rather
 * than being omitted.
 *
 * `alert` is structured rather than a composed sentence: the server decides
 * WHICH metric regressed and by how much, and the client owns the wording and
 * the unit the change is rendered in. A pre-composed string would put a second
 * delta convention on the screen and could not be translated.
 */
export const EvalDashboardRow = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  model: z.string(),
  cases_total: z.number().int(),
  last_batch: z
    .object({
      batch_id: z.string(),
      agent_version: z.number().int(),
      started_at: z.string(),
      cases_covered: z.number().int().nullable(),
      cases_passed: z.number().int().nullable(),
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
    })
    .nullable(),
  trend: z.array(EvalBatchTrendPoint),
  alert: z
    .object({
      metric: z.enum(['recall', 'precision', 'citation_accuracy']),
      change: z.number(),
    })
    .nullable(),
});
export type EvalDashboardRow = z.infer<typeof EvalDashboardRow>;

/**
 * The whole-workspace dashboard: one row per agent, plus a cross-agent list of
 * recent batches. `period` echoes the window the rows were computed over, so a
 * client never has to remember what it asked for.
 */
export const EvalWorkspaceDashboard = z.object({
  period: EvalPeriod,
  rows: z.array(EvalDashboardRow),
  recent_batches: z.array(EvalBatch),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

/**
 * The answer to "run every agent": what started, and what did not.
 *
 * A skip is named with its reason, because a reader cannot otherwise tell a
 * disabled agent from an agent holding no cases.
 */
export const EvalRunAllResult = z.object({
  created: z.array(EvalBatch),
  skipped: z.array(
    z.object({
      agent_id: z.string(),
      reason: z.enum(['agent_disabled', 'no_cases']),
    }),
  ),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;
