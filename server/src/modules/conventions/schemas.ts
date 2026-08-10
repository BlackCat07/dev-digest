import { z } from 'zod';

/**
 * The two structured-output shapes of the extraction dialogue.
 *
 * Kept apart from `@devdigest/shared` on purpose: these are what the MODEL
 * returns, not what the API serves. The model's output is raw material — it has
 * not been verified against the clone, its line numbers have not been corrected,
 * and its `confidence` is a self-report. `ExtractedConvention` in the shared
 * contracts is what survives all of that. Letting one type do both jobs would
 * mean a shape carrying `confidence` that sometimes means "counted" and
 * sometimes means "the model felt good about it".
 *
 * Two constraints come from `zodResponseFormat`, which turns these into a strict
 * JSON Schema:
 *  - **No `.optional()`.** Strict mode requires every property in `required`;
 *    an optional field makes the request itself invalid. Use `.nullable()`.
 *  - **No array `.min()`/`.max()`.** They are not expressible in the schema, so
 *    they would not constrain the model — they would only fail validation after
 *    the fact and burn a reprompt. Bounds are stated in the prompt and enforced
 *    in code.
 */

/** One citation, exactly as claimed. Unverified: the file may not even exist. */
export const ClaimedEvidence = z.object({
  path: z.string(),
  start_line: z.number().int(),
  snippet: z.string(),
});
export type ClaimedEvidence = z.infer<typeof ClaimedEvidence>;

/** One proposed rule, before the evidence gate and the adherence count. */
export const ProposedConvention = z.object({
  rule: z.string(),
  rationale: z.string(),
  evidence: z.array(ClaimedEvidence),
  /** JS regex matching a line that FOLLOWS the rule. Null when unmeasurable. */
  match_conforming: z.string().nullable(),
  /** JS regex matching a line that BREAKS it. Null when unmeasurable. */
  match_violating: z.string().nullable(),
  /** The model's own estimate. Used only when adherence cannot be counted. */
  confidence: z.number(),
});
export type ProposedConvention = z.infer<typeof ProposedConvention>;

/** Step 2 — what one category's extraction call returns. */
export const ConventionExtraction = z.object({
  candidates: z.array(ProposedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/**
 * Step 1 — which of the offered paths are worth reading in full.
 *
 * Paths only, so this call stays cheap no matter how large the repo is: the
 * model sees a list of names and returns a subset. Anything it returns that was
 * not offered is discarded by the caller — a model that invents a path here
 * would otherwise steer the whole scan at a file that does not exist.
 */
export const ConventionFileSelection = z.object({
  paths: z.array(z.string()),
});
export type ConventionFileSelection = z.infer<typeof ConventionFileSelection>;
