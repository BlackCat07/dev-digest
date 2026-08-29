import { z } from 'zod';
import { EvalCaseCreate, EvalCaseSave, EvalPeriod, EvalTrialRunRequest } from '@devdigest/shared';
import { DEFAULT_PERIOD } from './constants.js';

/**
 * Every request shape the eval routes accept, declared once and attached to the
 * route (`params` / `body` / `querystring`) rather than parsed inside a handler.
 *
 * That placement is the point of the file. A schema on the route runs before the
 * handler, so an invalid id becomes a clean `422 validation_error` from the
 * shared error handler and never reaches `getContext`, the service or Postgres;
 * a `Schema.parse(req.body)` inside a handler runs after the workspace lookup and
 * turns the same bad input into a `500`. It also means the handler's `req.params`
 * and `req.body` are typed off these declarations, so nothing below needs a cast
 * — every boundary parses, and none of them casts.
 *
 * Two of them are the CONTRACT schema itself rather than a copy:
 * {@link SaveEvalCaseBody} is `EvalCaseSave` and the period enum is `EvalPeriod`.
 * A second hand-written copy of either would be free to drift from the type the
 * client sends, which is exactly the drift the shared contract exists to stop.
 */

/** `/eval/agents/:agentId/…` — the agent whose set or history is addressed. */
export const AgentIdParams = z.object({ agentId: z.string().uuid() });
export type AgentIdParams = z.infer<typeof AgentIdParams>;

/** `/eval/cases/:caseId` — one stored case. */
export const CaseIdParams = z.object({ caseId: z.string().uuid() });
export type CaseIdParams = z.infer<typeof CaseIdParams>;

/** `/eval/batches/:batchId(/events)` — one batch, or its progress stream. */
export const BatchIdParams = z.object({ batchId: z.string().uuid() });
export type BatchIdParams = z.infer<typeof BatchIdParams>;

/**
 * Deriving a draft from a decided finding: the finding id, and NOTHING else.
 *
 * `strict()` because there is genuinely nothing else to send — the whole draft
 * is computed server-side, and a field silently stripped here would be a field a
 * client thought it had contributed.
 */
export const DraftEvalCaseBody = z.object({ finding_id: z.string().uuid() }).strict();
export type DraftEvalCaseBody = z.infer<typeof DraftEvalCaseBody>;

/**
 * Saving a derived case: the finding id, plus the three fields the draft modal
 * makes editable.
 *
 * The contract schema itself, narrowed only where a route may be stricter than a
 * wire type: `finding_id` is a uuid here, and the name has a length bound. What
 * the body still cannot carry is an EXPECTATION or an anchor — those are derived
 * from the finding's own decision (accepted → `must_find`, dismissed →
 * `must_not_flag`), so a caller able to send one could file a case that
 * contradicts the human decision it claims to come from. `strict()` makes that
 * refusal explicit instead of silently stripping the field.
 */
export const CreateEvalCaseBody = EvalCaseCreate.extend({
  finding_id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
}).strict();
export type CreateEvalCaseBody = z.infer<typeof CreateEvalCaseBody>;

/**
 * One trial run of an unsaved draft — the contract schema itself.
 *
 * It carries the expectation and the anchors where {@link CreateEvalCaseBody}
 * may not, and the asymmetry is not an inconsistency: a trial writes nothing, so
 * there is no stored assertion for a mismatched expectation to corrupt. What it
 * would do is produce a run whose outcome answers a different question than the
 * case the reader is about to save — which the client prevents by sending the
 * draft's own values, and which no schema can check.
 */
export const TrialRunEvalCaseBody = EvalTrialRunRequest;
export type TrialRunEvalCaseBody = z.infer<typeof TrialRunEvalCaseBody>;

/**
 * A hand-edited case, saved as submitted — the contract schema itself.
 *
 * `expected_output` stays `unknown` inside it: it is a jsonb blob whose shape is
 * the case author's, and the one rule about it (a `must_not_flag` anchor naming a
 * file absent from the diff) is a refusal the service owns, not a shape a schema
 * can express.
 */
export const SaveEvalCaseBody = EvalCaseSave;
export type SaveEvalCaseBody = z.infer<typeof SaveEvalCaseBody>;

/**
 * Starting a batch: both fields optional, because the default request is "run
 * the whole set with no label".
 */
export const StartEvalBatchBody = z.object({
  label: z.string().min(1).max(200).optional(),
  case_id: z.string().uuid().optional(),
});
export type StartEvalBatchBody = z.infer<typeof StartEvalBatchBody>;

/**
 * The body as the route declares it — optional AS A WHOLE, not merely two
 * optional fields.
 *
 * `apiFetch` sets `content-type: application/json` only when a body is actually
 * sent, so a caller that sends nothing arrives with no body at all; a schema of
 * two optional fields would still reject that, and Fastify would answer "Body
 * cannot be empty when content-type is application/json" for the opposite
 * mistake. `nullish()` accepts both, which is the shape `modules/brief/routes.ts`
 * already uses for the same reason.
 */
export const StartEvalBatchPayload = StartEvalBatchBody.nullish();

/**
 * `?period=` on every history and dashboard read, defaulting to
 * {@link DEFAULT_PERIOD}.
 *
 * The default lives in the schema rather than in a handler's `??`, so every
 * route that takes a period gets the same one and a reader can see which it is
 * without opening five handlers.
 */
export const EvalPeriodQuery = z.object({ period: EvalPeriod.default(DEFAULT_PERIOD) });
export type EvalPeriodQuery = z.infer<typeof EvalPeriodQuery>;

/**
 * `/eval/compare?a=&b=` — the earlier batch and the later one, in that order.
 *
 * Both are plain ids here: whether they belong to one agent (and to the caller's
 * workspace) is the service's `cross_agent_compare` refusal, which a schema
 * cannot see.
 */
export const EvalCompareQuery = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
});
export type EvalCompareQuery = z.infer<typeof EvalCompareQuery>;
