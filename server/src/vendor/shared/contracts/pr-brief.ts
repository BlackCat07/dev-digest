/**
 * PR Brief (Why + Risk) — the contracts SPEC-03 adds on top of the composed
 * `PrBrief` document in ./brief.js.
 *
 * A NEW FILE rather than fields on `PrBrief`, and the reason is that `PrBrief`
 * cannot express what this feature produces. It is `{ intent, blast, risks,
 * history }` — a composition of four whole documents — while the requirement asks
 * for `{ what, why, risk_level, risks, review_focus }`: no what, no why, no level
 * and no review focus, and its `BlastRadius` member requires a `summary` string
 * only a model can write, which is why the L04 contract already declined to
 * produce one. `PrBrief` and the `Intent` / `BlastRadius` / `Risks` / `PrHistory`
 * it composes are deliberately LEFT AS IS, nothing here edits or removes them,
 * and they are not a cleanup item; this package is extend-by-new-file, the same
 * move ./blast.js makes against `BlastRadius` and ./intent.js against
 * `PrIntentRecord`.
 *
 * `Risk` and `RiskSeverity` are IMPORTED and reused verbatim from ./brief.js —
 * that type already describes exactly this data, its own comment in ./intent.js
 * anticipated this file ("The PR Brief will compose the same `Risk` when it
 * lands"), and two vocabularies for one concept is the drift this package exists
 * to prevent. `RiskLevel` is built FROM `RiskSeverity.options` for the same
 * reason: it is a distinct symbol because it describes the whole pull request
 * rather than one risk, but its three values cannot drift from the severities the
 * level is derived from.
 *
 * Three properties carry the feature, and each is a constraint rather than an
 * embellishment:
 *
 *  - **The level is derived, never taken from the model.** It is the highest
 *    severity among the risks that survived grounding, and `low` when none did,
 *    so the badge and the list below it cannot disagree — the same reason the
 *    onboarding tour's section order is the contract's and not the model's.
 *  - **A thin brief is never silently thin.** `status` says which of three things
 *    missing content means, `reason` names the cause, and `sources` records one
 *    entry per input the assembly was offered — used, unreadable, or dropped over
 *    budget. A consumer reading only `risks` and `review_focus` cannot tell a
 *    calm pull request from a failed generation, which is precisely the inference
 *    this feature must not invite.
 *  - **Provenance and the cache key travel with the brief.** `head_sha`,
 *    `cache_key`, `generated_at` and the five generation figures are recorded ON
 *    the brief, so the card reports what THIS brief was generated from rather
 *    than what the pull request looks like today — and `stale` is what says the
 *    two have parted.
 *
 * Every nullable field below is `.nullable()` and not `.optional()` on purpose.
 * A stored brief is read back out of a jsonb column, and a document written under
 * an earlier shape arrives with keys **absent** rather than null — a distinction
 * that has cost this repository twice (`server/INSIGHTS.md`, 2026-08-02 and
 * 2026-08-19). Keeping every field present means a consumer narrows with
 * `== null` and never has to tell "absent" from "null"; the read side parses
 * rather than casts, so a payload that does not parse is treated as no brief at
 * all.
 *
 * No numeric range keyword appears anywhere below. The caps on a stored brief
 * (risks, review-focus rows, listed paths, the token budget) are enforced where
 * it is assembled: a range keyword in a shared contract has already broken a
 * structured call on Anthropic-via-OpenRouter (`reviewer-core/INSIGHTS.md`,
 * 2026-08-07), and a bound that rejects an already-stored brief on the way out
 * helps nobody.
 */
import { z } from 'zod';
import { Risk, RiskSeverity } from './brief.js';

/**
 * How risky this pull request is, as one word for the whole change.
 *
 * Built from `RiskSeverity.options` rather than spelled out again: the level is
 * DERIVED as the highest severity among the risks that survived grounding, so the
 * two sets are the same set by construction and a fourth severity could never
 * leave the level behind. It is nonetheless its own symbol, because a level is a
 * property of the pull request and a severity is a property of one risk — a
 * consumer rendering the card's headline badge and a consumer rendering a risk row
 * are reading two different facts.
 */
export const RiskLevel = z.enum(RiskSeverity.options);
export type RiskLevel = z.infer<typeof RiskLevel>;

/**
 * How much of the brief the assembly and the model could actually support.
 *
 * The same three values `BlastStatus` (./blast.js), `IntentStatus` (./intent.js)
 * and `OnboardingStatus` (./onboarding.js) already use, spelled identically on
 * purpose: one condition reported by four features in four vocabularies is four
 * stories about one pull request.
 *
 *  - `ok`       — every input was read and the generation completed.
 *  - `partial`  — a brief was written, and at least one input was missing or
 *                 incomplete: no intent, a blast map that is not `ok`, a source
 *                 dropped over budget, or a what that only restated the title.
 *                 What is here is true; what is missing proves nothing.
 *  - `degraded` — no brief was written. What is stored is the deterministic
 *                 facts the assembly already held, and nothing a model produced.
 */
export const BriefStatus = z.enum(['ok', 'partial', 'degraded']);
export type BriefStatus = z.infer<typeof BriefStatus>;

/**
 * Why the status is not `ok`. Null when it is.
 *
 * The first five are the index-side set carried through from `BlastReason`
 * (./blast.js), spelled identically for the reason above: when the blast map is
 * not `ok` this brief carries the map's OWN reason value rather than re-deriving
 * one, because a consumer that re-derives a status from an absent optional field
 * invents a third meaning for it (`server/INSIGHTS.md`, 2026-08-14).
 *
 *  - `index_missing`    — no usable index at all. Also where any unrecognised
 *                         index-side condition lands, rather than being invented
 *                         as a new value here.
 *  - `index_partial`    — the index covers only some of the repository's files.
 *  - `index_failed`     — the index exists and its last build failed.
 *  - `repo_too_large`   — the repository exceeded the indexer's file cap.
 *  - `no_changed_files` — no changed file is recorded for this pull request, so
 *                         there was nothing to reason about and no model call was
 *                         made. Not a rare case: `pr_files` is written ONLY by
 *                         `GET /pulls/:id`, so a pull request nobody has opened
 *                         has no rows — measured at 10 of 14 in a live workspace
 *                         (`server/INSIGHTS.md`, 2026-08-11 and 2026-08-15).
 *
 * The last six are this feature's own and have no index-side equivalent:
 *
 *  - `no_intent`         — no intent has been derived for this pull request, or
 *                          its derivation failed. The brief is written without it.
 *  - `inputs_too_large`  — the core input alone overran the token budget, so no
 *                          call was made: nothing is charged for an answer that
 *                          could not have been grounded.
 *  - `model_failed`      — the structured call threw.
 *  - `model_timeout`     — it did not answer inside the deadline.
 *  - `model_invalid`     — it answered, and the answer did not survive validation.
 *  - `restates_title`    — the what it produced only restated the pull request's
 *                          title after case and whitespace normalisation, so no
 *                          what is stored. The brief is partial rather than
 *                          degraded: the why and the risks are still real.
 */
export const BriefReason = z.enum([
  'index_missing',
  'index_partial',
  'index_failed',
  'repo_too_large',
  'no_changed_files',
  'no_intent',
  'inputs_too_large',
  'model_failed',
  'model_timeout',
  'model_invalid',
  'restates_title',
]);
export type BriefReason = z.infer<typeof BriefReason>;

/**
 * One value per input the model input may be assembled from, and no others.
 *
 * The set is closed and it is the enumeration of what the assembly is allowed to
 * send: the pull request's title (with its branch and base), its description, the
 * changed-file list, the stored intent record, the blast map's facts, the linked
 * issue, the prior pull requests overlapping these files, and the repository
 * documents of the effective document set. No diff hunk body is among them, and
 * that absence is what the token budget rests on.
 */
export const BriefSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'file_list',
  'intent',
  'blast',
  'linked_issue',
  'prior_prs',
  'repo_doc',
]);
export type BriefSourceKind = z.infer<typeof BriefSourceKind>;

/**
 * Whether the source actually reached the prompt, and if not, why not.
 *
 * `IntentSourceStatus` (./intent.js) has the first two; the third is this
 * feature's addition and it is a genuinely different fact. "We could not read it"
 * is a gap in the inputs, while "we chose not to send it" is a budget decision the
 * card should be able to explain — collapsing them would make a deliberately
 * shorter prompt look like a broken one.
 */
export const BriefSourceStatus = z.enum(['used', 'unfetched', 'dropped_over_budget']);
export type BriefSourceStatus = z.infer<typeof BriefSourceStatus>;

/**
 * One entry in the audit trail of what the generation was offered.
 *
 * The shape is `IntentSource`'s (./intent.js) with the wider status, deliberately
 * not a second spelling of it. `chars` is the size of the text that reached the
 * prompt and is null when nothing did — both for an `unfetched` source and for one
 * dropped over budget. `note` carries the human reason and is null when there is
 * nothing to say.
 */
export const BriefSource = z.object({
  kind: BriefSourceKind,
  /** Identifier of the source: a path, an issue reference, or a pull-request number. */
  ref: z.string(),
  status: BriefSourceStatus,
  chars: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type BriefSource = z.infer<typeof BriefSource>;

/**
 * One place to look first, with the reason to look there.
 *
 * `path` is the whole contract of the row: activating it navigates to the
 * `Files changed` tab with that file targeted, so every stored path has been
 * checked against the input's changed-file list before storage — stricter than a
 * risk's `file_refs`, because the blast radius is not an allowed source here and a
 * row that cannot navigate is worse than a missing row.
 *
 * `line` is a convenience and is explicitly UNGROUNDED: the model never sees a
 * hunk body, so nothing checks that the number means anything. A row that scrolls
 * to a plausible but wrong line is within spec; a row that scrolls to the wrong
 * file is not. Null when the model offered none.
 */
export const ReviewFocusItem = z.object({
  /** Repo-relative path, as `pr_files` recorded it. Never a `path:line` display form. */
  path: z.string(),
  line: z.number().int().nullable(),
  /** One line saying why this file is worth reading first. */
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * The deterministic figures the assembly holds before any model call.
 *
 * They are on the brief because they are the half that survives a failed
 * generation: a degraded brief carries these six and no risks, no review focus
 * and no level, so the card states something true rather than rendering an empty
 * page.
 *
 * `files_listed` is how many paths actually reached the prompt after the role
 * ordering and the cap, so `files_changed - files_listed` is the number the card
 * reports as omitted — the reader can see that the model did not look at
 * everything instead of being invited to assume it did.
 *
 * `symbols` and `endpoints` are the blast map's own counts, carried onto the
 * brief because AC-30 asks a brief the model did not produce to state the blast
 * map's counts, and spelled with the SAME names `BlastCounts` (./blast.js) gives
 * them — two vocabularies for one figure is the drift this file's header exists
 * to prevent. Only two of that object's four travel: the changed-symbol count
 * and the impacted-endpoint count are the pair a reviewer reads as "how far does
 * this reach", while `callers` and `crons` belong to the Blast Radius card, which
 * has the room to explain them.
 *
 * They are present on EVERY brief and not only a degraded one, so a reader is
 * never asked why a figure appears in one state and vanishes in another — and
 * they are plain integers rather than nullable for the reason the header states:
 * where the map is `degraded` the honest value is the zero the map itself
 * reported, not an absence.
 */
export const BriefDiffStats = z.object({
  /** Changed files recorded for the pull request. */
  files_changed: z.number().int(),
  /** Of those, how many paths the model input carried. */
  files_listed: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /** Changed symbols the blast map resolved — `BlastCounts.symbols` verbatim. */
  symbols: z.number().int(),
  /**
   * Endpoints in the blast radius, counted distinct by label —
   * `BlastCounts.endpoints` verbatim. Scheduled jobs are a separate figure there
   * (`crons`) and are deliberately not folded into this one.
   */
  endpoints: z.number().int(),
});
export type BriefDiffStats = z.infer<typeof BriefDiffStats>;

/**
 * Where this pull request's brief is in its lifecycle.
 *
 *  - `never_generated` — nobody has generated one. Answered as `200` with an
 *    empty document rather than `404`: in a local-first tool, nothing generated
 *    yet is an ordinary state. It is also the ABSENCE of a stored row, never a
 *    stored value.
 *  - `running` — a generation is in flight. The rest of this document is the
 *    previously stored brief, if there is one.
 *  - `done` — a stored brief, whatever its `status`.
 */
export const BriefGenerationState = z.enum(['never_generated', 'running', 'done']);
export type BriefGenerationState = z.infer<typeof BriefGenerationState>;

/**
 * Response of `GET /pulls/:id/brief` — the single brief a pull request has.
 *
 * One brief per pull request, shared across the workspace and replaced whole by a
 * generation: there is no history, no per-user and no per-branch variant, so a
 * regeneration replaces what a colleague was reading.
 */
export const PrRiskBrief = z.object({
  pr_id: z.string(),
  /**
   * What the change does, in the reviewer's own terms. Null when no model call
   * produced one, and also when the one it produced only restated the title —
   * see `restates_title`.
   */
  what: z.string().nullable(),
  /** Why it is being made. Null when no model call produced one. */
  why: z.string().nullable(),
  /**
   * The whole pull request's risk level. Null only when no brief was written;
   * a brief with no surviving risks stores `low`, which is a claim rather than
   * an absence.
   */
  risk_level: RiskLevel.nullable(),
  /**
   * Where this change is most likely to hurt, reusing `Risk` from ./brief.js.
   *
   * `Risk.kind` is an open string HERE while the model is constrained to a closed
   * set at generation time — so a model that invents a sixth kind is stored
   * faithfully and the card falls back to a neutral icon, rather than the whole
   * brief failing validation. Every `file_refs` entry has been checked against the
   * input's changed-file list or the blast map's referenced files before it
   * reaches this field; invented paths are dropped, not stored, and a risk whose
   * every reference was dropped is dropped with them. A risk citing no path at all
   * is kept — "the auth surface is touched" is a legitimate whole-pull-request
   * observation.
   */
  risks: z.array(Risk),
  /** Empty on a degraded brief: a review-focus row is advice plus a reason, and the reason is the part only a model writes. */
  review_focus: z.array(ReviewFocusItem),
  diff_stats: BriefDiffStats,
  status: BriefStatus,
  reason: BriefReason.nullable(),
  /** One entry per input the generation was offered, whatever became of it. */
  sources: z.array(BriefSource),
  /**
   * Head commit this brief was generated against. Null when none has been
   * generated, which is also why the card links out to files only when it is set:
   * a link pinned to a branch would point at code the brief never saw.
   */
  head_sha: z.string().nullable(),
  /**
   * The cache key this brief was generated against — a digest over the nine values
   * the pull request's state is made of, not the head SHA alone. `head_sha` is
   * written by the pull-request LIST route while the description and the changed
   * files are written only by the DETAIL route, so a SHA-keyed brief caches a
   * title-only answer forever (`server/INSIGHTS.md`, 2026-08-11, measured at 15 of
   * 21 rows). Null when no brief has been generated.
   */
  cache_key: z.string().nullable(),
  /**
   * True when the key computed from the pull request's current state differs from
   * `cache_key`. Computed on read; nothing is regenerated and nothing is written.
   */
  stale: z.boolean(),
  generation_state: BriefGenerationState,
  /** ISO timestamp the stored brief was written. Null when none has been. */
  generated_at: z.string().nullable(),
  /** Provider that answered. Null when no model call was made. */
  provider: z.string().nullable(),
  /** Model identifier the generation used. Null when no model call was made. */
  model: z.string().nullable(),
  /** Provider round-trips the generation cost: at most one, and never a repair reprompt. */
  attempts: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** Null means no price is known for the model, which is NOT the same as a free call (`0`). */
  cost_usd: z.number().nullable(),
  /** Failure message when the generation degraded; null otherwise. */
  error: z.string().nullable(),
});
export type PrRiskBrief = z.infer<typeof PrRiskBrief>;

/**
 * Body of `POST /pulls/:id/brief/generate`. `force` rebuilds even when the
 * computed cache key still equals the stored one.
 *
 * The same shape and the same meaning as `DeriveIntentPayload` (./intent.js), and
 * `force` is the only way to pick up what the key cannot see — a linked issue's
 * edited body, or a document edited without changing its size. A caller that means
 * to rebuild must SEND it: a mutation that omits an optional flag is a silently
 * successful no-op, which is exactly how the intent card's Re-derive button
 * shipped (`client/INSIGHTS.md`, 2026-08-11).
 */
export const GenerateBriefPayload = z.object({
  force: z.boolean().optional(),
});
export type GenerateBriefPayload = z.infer<typeof GenerateBriefPayload>;
