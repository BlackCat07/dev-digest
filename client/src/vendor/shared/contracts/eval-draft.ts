/**
 * Eval Pipeline — the DRAFT half of turning a finding into an eval case.
 *
 * Extend-by-new-file, like every other contract here: nothing below edits a
 * shipped symbol. `EvalExpectation`, `EvalAnchor`, `EvalCaseOutcome` and
 * `EvalNotRunReason` are imported from ./eval-batch.js and reused unchanged.
 *
 * The whole file exists because of one behavioural decision: **pressing `Turn
 * into eval case` must not add anything to an agent's eval set.** It derives a
 * DRAFT the reader can inspect, edit, and run as many times as they like, and
 * only `Save` writes a row. Three shapes carry that:
 *
 *  - {@link EvalCaseDraft} is everything a stored case would hold, computed by
 *    the server and persisted NOWHERE. It has no `id` for exactly that reason:
 *    an id would be the one field a client could mistake for "this exists".
 *  - {@link EvalTrialRunResult} is one execution of a draft against the agent's
 *    CURRENT prompt, model and skills, recorded in no `eval_batches` and no
 *    `eval_runs` row. A trial that wrote a batch row would move the agent's
 *    dashboard metrics every time somebody pressed `Run case` to see whether a
 *    finding reproduces — which is the opposite of measuring a regression.
 *  - {@link EvalCaseCreate} is the save, and its three editable fields are
 *    OPTIONAL. `expectation` and `expected_anchors` are absent on purpose: what
 *    a case asserts is still derived server-side from the finding's own
 *    decision, so a client that could send an expectation could file a case
 *    contradicting the human decision it claims to come from.
 *
 * No numeric range keyword anywhere in this file, for the reason ./eval-batch.js
 * states in its own header.
 */
import { z } from 'zod';
import {
  EvalAnchor,
  EvalCaseOutcome,
  EvalExpectation,
  EvalNotRunReason,
} from './eval-batch.js';

/**
 * Which human decision a draft was derived from.
 *
 * Rendered rather than re-derived: the modal's subtitle says "seeded from an
 * accepted finding", and `must_find` is not a word a reader of that sentence
 * should have to translate back.
 */
export const EvalDraftDecision = z.enum(['accepted', 'dismissed']);
export type EvalDraftDecision = z.infer<typeof EvalDraftDecision>;

/**
 * The finding a draft came from, as the modal's assertion banner states it.
 *
 * `severity` and `category` are plain strings and not the `Severity` / `Category`
 * enums, matching `EvalAgentCase.source_severity`: `findings.severity` is a text
 * column, and a narrower type here would be the one link in the chain that
 * rejects a value the findings table holds.
 */
export const EvalDraftSource = z.object({
  finding_id: z.string(),
  title: z.string(),
  file: z.string(),
  low_line: z.number().int(),
  high_line: z.number().int(),
  severity: z.string(),
  category: z.string(),
  decision: EvalDraftDecision,
});
export type EvalDraftSource = z.infer<typeof EvalDraftSource>;

/**
 * An eval case as it would be stored, derived and returned WITHOUT being stored.
 *
 * Deliberately not `EvalAgentCase`: that type carries `id`, `owner_kind`,
 * `edited` and `last_execution`, every one of which is a statement about a row
 * that does not exist yet. What it does carry is the agent the case would land
 * on, so the modal can name it before anything is written.
 *
 * `expected_output` is seeded with a finding-shaped skeleton for a `must_find`
 * draft and an empty array for a `must_not_flag` one — the assertion a human is
 * being asked to check, prefilled rather than demanded from a blank box. It is
 * documentation of the case, not an input to the score: recall, precision and
 * citation accuracy are computed from `expected_anchors` and the expectation
 * alone.
 */
export const EvalCaseDraft = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expectation: EvalExpectation,
  expected_anchors: z.array(EvalAnchor),
  expected_output: z.unknown(),
  source: EvalDraftSource,
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/**
 * The body of `POST /eval/cases` — the finding id, plus what the reader edited.
 *
 * The three optional fields are exactly the three the draft modal makes
 * editable. Omitting all of them is the pre-modal request and still means "save
 * the case as derived", which is what keeps the endpoint's older behaviour
 * expressible.
 */
export const EvalCaseCreate = z.object({
  finding_id: z.string(),
  name: z.string().optional(),
  input_diff: z.string().optional(),
  expected_output: z.unknown().optional(),
});
export type EvalCaseCreate = z.infer<typeof EvalCaseCreate>;

/**
 * One trial execution of a draft, as the client asks for it.
 *
 * `expected_output` is NOT part of it, and the omission is the honest one: the
 * scorer reads the expectation and the anchors and nothing else, so sending the
 * expected-output text would imply it is scored against. The client's JSON gate
 * is about the value it will SAVE, not about the run.
 */
export const EvalTrialRunRequest = z.object({
  name: z.string(),
  input_diff: z.string(),
  expectation: EvalExpectation,
  expected_anchors: z.array(EvalAnchor),
});
export type EvalTrialRunRequest = z.infer<typeof EvalTrialRunRequest>;

/**
 * What one trial run answered.
 *
 * The same four figures a stored `EvalBatchCaseResult` carries, plus the agent's
 * actual output so a reader can see WHAT it said when a run disagrees with the
 * expectation. Every count is nullable for the reason the batch contracts give:
 * a `not_run` case produced no output to count, and null means "not measured"
 * rather than zero.
 */
export const EvalTrialRunResult = z.object({
  outcome: EvalCaseOutcome,
  not_run_reason: EvalNotRunReason.nullable(),
  expected_count: z.number().int().nullable(),
  actual_count: z.number().int().nullable(),
  kept_count: z.number().int().nullable(),
  dropped_count: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** `{ findings: [...] }` when the agent answered, null when it never did. */
  actual_output: z.unknown(),
});
export type EvalTrialRunResult = z.infer<typeof EvalTrialRunResult>;
