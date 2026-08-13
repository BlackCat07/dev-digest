/**
 * Intent Layer — the contracts L03 adds on top of `PrIntentRecord` in
 * ./review-api.js.
 *
 * `PrIntentRecord` is the earlier, narrower shape (`Intent` plus the `pr_id` it
 * scopes). It is deliberately LEFT AS IS and nothing here edits it: this package
 * is extend-by-new-file. `Intent` in ./brief.js is untouched too — the PR Brief
 * still composes that shape.
 *
 * Two differences carry the whole feature:
 *
 *  - **A derivation always has a row, even when it has no intent text.** The
 *    classifier runs in the background and can be in flight or have failed, so
 *    `intent` is widened to nullable here and `status` says which of the two it
 *    is. A missing intent is a worse review, never a broken one.
 *  - **Sources are recorded, never invented.** Every input the classifier was
 *    offered appears in `sources` with the status it actually got — `used` when
 *    it was read, `unfetched` when it could not be, with the reason in `note`.
 *    What could not be read is stated in `missing_context`, not guessed at.
 */
import { z } from 'zod';
import { PrIntentRecord } from './review-api.js';
import { Risk } from './brief.js';

/**
 * Where one piece of classifier context came from.
 *
 * `unfetched_link` is the catch-all for a URL the app deliberately does not
 * follow (anything outside the PR's own repo): it is recorded so the gap is
 * visible, and never dereferenced.
 */
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'file_list',
  'hunk_headers',
  'linked_issue',
  'repo_doc',
  'unfetched_link',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/** Whether the source actually reached the classifier's prompt. */
export const IntentSourceStatus = z.enum(['used', 'unfetched']);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

/**
 * One entry in the audit trail of what the classifier saw.
 *
 * `chars` is the size of the text that reached the prompt after truncation, and
 * is null for an `unfetched` source (nothing was read). `note` carries the human
 * reason — why it was skipped, or that it was truncated — and is null when there
 * is nothing to say.
 */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** Identifier of the source: a path, an issue reference, or an origin+path. */
  ref: z.string(),
  status: IntentSourceStatus,
  chars: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * Lifecycle of one derivation.
 *
 * `partial` means an intent was produced but at least one source came back
 * `unfetched`; `failed` means the model call itself did not complete.
 */
export const IntentStatus = z.enum(['running', 'ok', 'partial', 'failed']);
export type IntentStatus = z.infer<typeof IntentStatus>;

/**
 * The persisted intent for a PR, as the card and the reviewer both read it.
 *
 * `intent` is overridden to `.nullable()` ON PURPOSE. `PrIntentRecord` inherits
 * a required string from `Intent`, which only describes a *finished* derivation;
 * a run that is still `running`, or one that ended `failed`, has a row to record
 * itself on and no intent text yet. `in_scope`/`out_of_scope` keep their inherited
 * shape — they arrive empty rather than absent in those states.
 *
 * `confidence` is DERIVED from which sources were actually available; the model's
 * own self-report may only lower it, never raise it. The rest of the fields are the
 * derivation's receipt: which model produced it, what it cost, and when.
 */
export const PrIntent = PrIntentRecord.extend({
  intent: z.string().nullable(),
  /** Head commit the derivation was made against; drives staleness. */
  head_sha: z.string().nullable(),
  confidence: z.number(),
  sources: z.array(IntentSource),
  /** What we could not read, stated plainly — never filled in by guessing. */
  missing_context: z.array(z.string()),
  /**
   * Where this change is most likely to hurt (L03).
   *
   * Reuses `Risk` from ./brief.js rather than declaring a second risk shape: that
   * type already had exactly these five fields and no consumer, and two
   * vocabularies for one concept is the drift this package exists to prevent. The
   * PR Brief will compose the same `Risk` when it lands.
   *
   * `Risk.kind` is an open string HERE while the classifier is constrained to a
   * closed enum at generation time — so a model that invents a sixth kind is
   * stored faithfully and the card falls back to a neutral icon, rather than the
   * derivation failing validation and losing the whole intent.
   *
   * Every `file_refs` entry has been checked against the PR's real changed-file
   * list before it reaches this field; invented paths are dropped, not stored.
   */
  risk_areas: z.array(Risk),
  status: IntentStatus,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  // USD cost of the derivation. null = no price is known for the model — NOT the
  // same as a free call (which is 0).
  cost_usd: z.number().nullable(),
  derived_at: z.string().nullable(),
  /** Failure message when `status` is 'failed'; null otherwise. */
  error: z.string().nullable(),
});
export type PrIntent = z.infer<typeof PrIntent>;

/**
 * Body of `POST /pulls/:id/intent`. `force` re-derives even when the stored
 * intent is still fresh for the current head SHA.
 */
export const DeriveIntentPayload = z.object({
  force: z.boolean().optional(),
});
export type DeriveIntentPayload = z.infer<typeof DeriveIntentPayload>;
