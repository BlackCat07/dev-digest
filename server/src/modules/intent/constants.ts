/** Constants for the Intent Layer classifier (L03). */
import type { IntentSourceKind } from '@devdigest/shared';

// --- Model dialogue ---------------------------------------------------------

/**
 * Feature-model id this classifier resolves its provider/model from.
 *
 * Deliberately NOT any agent's model: the classification is one cheap flash-class
 * call in front of the review, and it is selectable in Settings as
 * "PR Review · Intent" so a workspace can make it cheaper or better without
 * touching a single agent.
 */
export const INTENT_FEATURE_MODEL = 'review_intent' as const;

/**
 * Name of the structured-output schema, sent as the `json_schema` / tool name.
 *
 * LOAD-BEARING, exactly as `SELECTION_SCHEMA_NAME` and `EXTRACTION_SCHEMA_NAME`
 * are for the conventions extractor: `MockLLMProvider.structuredBySchema` keys
 * its fixtures on `schemaName` and FALLS BACK to the generic `structured`
 * fixture when no entry matches, instead of erroring. Renaming this silently
 * feeds every test the wrong fixture rather than failing loudly.
 */
export const INTENT_SCHEMA_NAME = 'PrIntentClassification';

/** Job kind registered on `JobRunner` for a background derivation. */
export const INTENT_JOB_KIND = 'pr-intent-derive';

/**
 * Wall-clock ceiling for the one classification call.
 *
 * The call must be bounded HERE, by an explicit race, because neither request
 * field does it: `StructuredRequest.timeoutMs` is silently ignored (the timeout
 * is fixed at 90s when the OpenAI client is constructed) and `maxRetries`
 * defaults to 2, i.e. three attempts of up to 90s each. See
 * `server/INSIGHTS.md`, 2026-08-06.
 *
 * 75s leaves room inside `JobRunner`'s FIXED 120s hard timeout for the source
 * collection either side of the call. A classifier that has not answered by then
 * is worth abandoning: the review proceeds without an intent, which is a worse
 * review and not a broken one.
 *
 * RAISED from 45s when `risk_areas` was added, on measurement rather than taste.
 * The new field roughly doubles output tokens (PR with 6 changed files: 151 → 347
 * out; PR with 100 files: 895 out), and this provider's latency for the SAME
 * derivation swings widely — one call on a 100-file PR exceeded 45s and failed,
 * the identical call moments later finished in 18s. That variance is already on
 * the record for this provider (`server/INSIGHTS.md`, 2026-08-06: per-call latency
 * swung from ~35s to over 105s across five runs of one repo and model), so 45s
 * was not a bound on the work — it was a coin flip on a slow response.
 *
 * The synchronous manual derive does make a user wait this long in the worst
 * case, which is unpleasant. It is still the right trade: a 45s FAILURE that
 * discards a completed-but-late answer costs the same wait AND leaves the card
 * wrong. The blocking REVIEW path is unaffected — it has its own, much shorter
 * `INTENT_INLINE_BUDGET_MS` (10s) and never waits on this one.
 */
export const INTENT_CALL_DEADLINE_MS = 75_000;

/**
 * Schema-repair attempts allowed. Zero — one round-trip, no reprompt.
 *
 * The deadline above and this constant are BOTH required, and neither alone
 * bounds the call: retries inside the provider are invisible to the race until
 * they have already been paid for, and a single attempt can still hang for 90s.
 */
export const INTENT_MAX_RETRIES = 0;

/**
 * After this long, a derivation still marked `running` is treated as abandoned
 * rather than in flight — the same window and the same reason as
 * `SCAN_STALE_AFTER_MS`. A process that died mid-derivation must not brick the
 * PR's intent forever, because nothing in the UI can clear that row.
 */
export const INTENT_STALE_AFTER_MS = 5 * 60_000;

// --- Source budget ----------------------------------------------------------

/**
 * How many links the classifier may dereference **per category** — issues and
 * repository documents are budgeted separately, so one derivation performs at
 * most `2 × MAX_FETCHED_LINKS` fetches, not `MAX_FETCHED_LINKS`.
 *
 * `sources.ts` applies it twice and independently (`issueRefs.slice(0, …)` and
 * `docRefs.slice(0, …)`), which is deliberate: a PR that links one ticket and
 * one spec should get both, and a per-derivation budget shared between the two
 * would let three `#n` references starve the spec that actually states the
 * design. Stated explicitly because an earlier wording of this comment said
 * "in one derivation", which read as a global cap of 3.
 *
 * Every fetch is a same-repo GitHub read or a file already on disk, so the
 * ceiling is about latency and noise rather than safety — the safety is that
 * nothing else is fetched AT ALL. Links beyond it are recorded `unfetched`.
 */
export const MAX_FETCHED_LINKS = 3;

/**
 * Most links RECORDED per category, fetched or not.
 *
 * The audit trail is stored as jsonb and rendered on a card, and a description
 * is author-controlled — a body with five hundred `#n` references would
 * otherwise write five hundred rows' worth of `unfetched` entries into one
 * column. The gap is still visible; it is just not unbounded.
 */
export const MAX_RECORDED_LINKS = 20;

/**
 * How many of a repository's pull requests ONE list read may examine when
 * looking for intents to derive in the background.
 *
 * This bounds ROWS EXAMINED, not rows enqueued, and that distinction is the
 * whole point: bounding only the enqueue count means a repository with 300 PRs
 * whose intents are all fresh pays 300 serial `getIntent` round-trips on every
 * list read and queues nothing. `GET /repos/:id/pulls` predates the Intent Layer
 * and must keep its latency profile whether the derivation trigger finds work or
 * not, so the cost is a constant handful of primary-key lookups either way.
 *
 * The window is the most RECENTLY UPDATED pull requests, which is where the
 * value is: those are the ones someone is about to open, and a PR whose head
 * moves re-enters the window as stale. The trade-off, stated plainly: a PR that
 * falls outside the window never gets its intent from this trigger — it gets one
 * from the review path or from the card's re-derive button instead.
 *
 * Deliberately the same figure as the diff-stat backfill cap in the same route:
 * it is the same shape of per-PR fan-out on one list read, and a second,
 * different number would be a second thing to keep in sync.
 */
export const INTENT_IMPORT_SCAN_LIMIT = 10;

/** Most characters one fetched source (issue body, repo doc) contributes. */
export const MAX_SOURCE_CHARS = 8_000;

/**
 * Most `@@` headers sent. A 300-file refactor produces thousands and they are
 * the most repetitive thing in the prompt; the first few hundred already say
 * what the change is shaped like.
 */
export const MAX_HUNK_HEADERS = 200;

/** Most changed-file paths listed. */
export const MAX_FILES_LISTED = 300;

/** Most characters of the PR description. Mirrors the reviewer's own cap. */
export const MAX_BODY_CHARS = 4_000;

// --- Bounds on what the model returns ---------------------------------------
//
// The structured schema cannot express any of these — array and numeric range
// keywords are not available (see `schemas.ts`) — so the prompt states them and
// this is where they are enforced. A model that ignores the prompt costs a
// truncation, not a reprompt and not a malformed row.

/** Most entries kept from `in_scope` / `out_of_scope`. */
export const MAX_SCOPE_ITEMS = 12;

/** Most `missing_context` lines stored, ours and the model's together. */
export const MAX_MISSING_CONTEXT_ENTRIES = 20;

/** Most characters of any one `missing_context` line. */
export const MAX_MISSING_CONTEXT_CHARS = 300;

/** Most characters of the intent sentence itself. */
export const MAX_INTENT_CHARS = 2_000;

// --- Confidence -------------------------------------------------------------
//
// The stored confidence is DERIVED from which sources were actually available,
// and the model's self-report may only lower it. The weights below, the two
// bounds under them and the self-report floor are the whole of that derivation;
// `confidence.ts` states the invariant they have to keep true.

/**
 * How much each kind of source contributes, counted ONCE per kind however many
 * of that kind were read.
 *
 * The description carries the most because it is the only place the author
 * states the goal in their own words; the title, the file list and the hunk
 * headers together are worth less than it, which is what makes an
 * empty-description PR land at a visibly lower figure. An `unfetched_link`
 * contributes nothing — it is a gap, and it also trips the ceiling below.
 *
 * They deliberately sum to less than 1: a classification made from paths and
 * `@@` headers with no diff bodies is never certain, and there is no published
 * evidence that it is sufficient (see the plan). A ceiling of 0.8 on the very
 * best case says so honestly rather than implying a certainty nobody measured.
 */
export const SOURCE_CONFIDENCE_WEIGHTS: Record<IntentSourceKind, number> = {
  pr_title: 0.05,
  pr_body: 0.35,
  file_list: 0.05,
  hunk_headers: 0.05,
  linked_issue: 0.15,
  repo_doc: 0.15,
  unfetched_link: 0,
};

/**
 * Floor under the derived figure.
 *
 * An intent was still produced — the classifier never refuses — so a value of
 * zero would read as "no intent", which is a different thing entirely and is
 * what `status: 'failed'` is for.
 */
export const INTENT_MIN_CONFIDENCE = 0.1;

/**
 * Ceiling once ANY source came back `unfetched`.
 *
 * Above every value reachable without a description (0.45) and below the ones
 * reachable with one, so it can never flatten the empty-description property
 * into a tie. The principle is `UNMEASURED_CONFIDENCE_CEILING`'s: an intent
 * derived over material we could not read must never sort above one derived
 * over material we could.
 *
 * It is applied to the SOURCE figure, before the self-report discount below, so
 * the cap bounds the stored value whatever the model claimed — and because the
 * discount is a multiplication it cannot lift a capped value back over the
 * ceiling either.
 */
export const INTENT_UNFETCHED_CONFIDENCE_CEILING = 0.6;

/**
 * How much of the source-derived figure survives a self-report of ZERO.
 *
 * The model's estimate is applied as a bounded discount —
 * `derived * (FLOOR + (1 - FLOOR) * selfReport)` — rather than as a competing
 * number, so it can only ever lower the stored value AND the ordering between
 * two source sets is preserved for every fixed self-report. `confidence.ts`
 * carries the full invariant and the two spellings this one replaces.
 *
 * 0.5 says the derivation is the primary signal and the self-report is a
 * modifier worth at most halving it: a flash model that says it is not confident
 * at all still had a description, a file list and hunk headers in front of it,
 * and pretending otherwise would sort that intent below one derived from a title
 * alone. It also has to stay ABOVE ~0.29, or a with-description intent could
 * fall to `INTENT_MIN_CONFIDENCE` and tie with a body-less one on the floor
 * (`0.35 * 0.5 = 0.175`, comfortably above the 0.1 floor).
 */
export const INTENT_SELF_REPORT_FLOOR = 0.5;

// --- Risk areas (L03) -------------------------------------------------------

/**
 * How many risk areas the card will show.
 *
 * Six chips is already a wall; past that the block stops being a summary and
 * starts being a second findings list, which is a different feature with its own
 * severity filter. The model is asked for the ones that matter, and this is the
 * backstop for when it ignores that.
 */
export const MAX_RISK_AREAS = 6;

/** A chip label is a noun phrase. Longer than this and it wraps to three lines. */
export const MAX_RISK_TITLE_CHARS = 80;

/** The disclosure panel is two sentences, not an essay. */
export const MAX_RISK_EXPLANATION_CHARS = 400;

/**
 * File references kept per risk, after grounding.
 *
 * A risk that genuinely spans a dozen files is a risk about the whole PR, and
 * naming three of them is as useful as naming twelve — the reader clicks through
 * to the diff either way.
 */
export const MAX_RISK_FILE_REFS = 3;
