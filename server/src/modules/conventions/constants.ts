/** Constants for the conventions extractor (L02). */
import type { ConventionCategory } from '@devdigest/shared';

// --- Scan budget ------------------------------------------------------------
// Four independent ceilings; whichever binds first wins. Files alone is not
// enough of a guard — 120 barrel files and 120 route modules are two orders of
// magnitude apart in tokens — so the token ceiling is the one that actually
// protects the bill, and the file ceiling only keeps the selection call small.

/** Most files read into the extraction prompt in one scan. */
export const MAX_SAMPLE_FILES = 120;

/** Most prompt tokens across all of a scan's model calls. */
export const MAX_SAMPLE_TOKENS = 120_000;

/**
 * A sampled file bigger than this is skipped rather than truncated. At this size
 * a `.ts` file is nearly always generated or vendored, and half of one teaches
 * the model a convention that the other half contradicts.
 */
export const MAX_FILE_BYTES = 64 * 1024;

/**
 * Soft budget for a whole scan, under `JobRunner`'s 120s hard timeout — the same
 * gap `INDEX_SOFT_BUDGET_MS` leaves in repo-intel. Reaching it finishes the scan
 * as `partial` with whatever it has, instead of being killed with nothing.
 */
export const SCAN_SOFT_BUDGET_MS = 110_000;

// --- Evidence gate ----------------------------------------------------------

/**
 * How far from the line the model claimed a snippet may be found and still count
 * as the same citation rather than a coincidental match elsewhere in the file.
 * Either way the stored line numbers are the REAL ones; this only decides how
 * the match is labelled.
 */
export const EVIDENCE_LINE_WINDOW = 25;

/**
 * A snippet whose normalised text is shorter than this proves nothing: `}` and
 * `);` appear in every file, so the "nearest match" would always succeed and
 * every candidate would verify. Rejecting them is what keeps verification from
 * becoming a rubber stamp.
 */
export const MIN_SNIPPET_CHARS = 12;

/** A file larger than this is not searched for evidence at all. */
export const MAX_VERIFY_FILE_BYTES = 512 * 1024;

// --- Adherence floors -------------------------------------------------------

/**
 * A rule must hold in at least this share of the places its matcher looks, or it
 * is not a convention — it is something that happens sometimes. Applied only
 * when adherence could be measured; an unmeasurable rule is kept and flagged.
 */
export const MIN_ADHERENCE = 0.8;

/**
 * And it must have at least this many conforming occurrences. Without a floor,
 * "2 conforming, 0 violating" scores a perfect 100% off two coincidences.
 */
export const MIN_OCCURRENCES = 5;

/**
 * Ceiling on the confidence of a rule whose adherence could not be counted.
 *
 * Below every measured rule's floor, deliberately: an unchecked rule must never
 * sort above a checked one, however certain the model sounded about it.
 */
export const UNMEASURED_CONFIDENCE_CEILING = 0.6;

/**
 * How many candidates a scan measures. Each measurement is two greps over the
 * clone, so this is the only part of a scan whose cost scales with how talkative
 * the model was. The remainder are kept as unmeasured rather than dropped.
 */
export const MAX_MEASURED_CANDIDATES = 30;

/** Most candidates one category's extraction call is asked for. */
export const MAX_CANDIDATES_PER_CATEGORY = 5;

/** Most paths step 1 may choose to read in full. */
export const MAX_SELECTED_PATHS = 40;

/**
 * How many category calls may be in flight at once.
 *
 * Ten — every category together — because each call now races the scan's
 * remaining budget on its own (see `service.ts`), and under a per-call deadline
 * more concurrency is strictly better: every category gets the full remaining
 * budget to answer in, rather than waiting behind a wave that may not finish.
 *
 * The batching loop is kept anyway so this can be lowered against a provider
 * that rate-limits, without touching the pipeline. Measured on one repo and
 * model, waves of four and five both overran `JobRunner`'s 120s hard timeout on
 * a slow run and returned nothing; the per-call deadline is what fixed that,
 * not the batch size.
 */
export const EXTRACTION_CONCURRENCY = 10;

/**
 * Schema-repair attempts allowed per category call. Zero: one round-trip, no
 * reprompt.
 *
 * `LLMProvider.completeStructured` defaults to `maxRetries ?? 2`, i.e. up to
 * THREE attempts, and its per-request `timeoutMs` is not honoured — the timeout
 * is fixed when the client is constructed (90s). So a single category can take
 * three round-trips, and ten of them cannot fit in `JobRunner`'s 120s. Measured
 * here: with the default retries a batched scan of ten categories produced
 * nothing before the job timed out, while the same scan unbatched squeaked in
 * at ~110s only because the retries overlapped.
 *
 * A scan is the right place to give this up. One category returning malformed
 * JSON costs that category; the other nine are unaffected, and the next scan
 * asks again. That trade is not available to a review, which is why the engine's
 * default is the other way round.
 */
export const EXTRACTION_MAX_RETRIES = 0;

/**
 * After this long, a scan still marked `running` is treated as abandoned rather
 * than in flight.
 *
 * Without it a process that died mid-scan leaves a row that blocks every future
 * scan of that repo forever, and the only cure is editing the database — which
 * is not a thing a user of this screen can do.
 */
export const SCAN_STALE_AFTER_MS = 5 * 60_000;

// --- Model dialogue ---------------------------------------------------------
// Both names are load-bearing: `MockLLMProvider.structuredBySchema` keys its
// fixtures on `schemaName`, and `adapters/mocks.ts` already names these two
// verbatim. Renaming either silently breaks every test's fixture lookup — the
// mock falls back to its generic `structured` fixture instead of erroring.

/** Step 1 — the model picks which of the offered paths are worth reading. */
export const SELECTION_SCHEMA_NAME = 'ConventionFileSelection';

/** Step 2 — the model extracts rules from the files it picked. */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/** Feature-model id this extractor resolves its provider/model from. */
export const CONVENTIONS_FEATURE_MODEL = 'conventions' as const;

/** Job kind registered on `JobRunner` for a scan. */
export const SCAN_JOB_KIND = 'conventions-scan';

// --- Categories -------------------------------------------------------------

/**
 * Scanned in this order, one model call each.
 *
 * One call per category rather than one call for everything: asked broadly, a
 * model returns three or four generic rules and stops, because it has satisfied
 * the request. Asked "what are this repo's naming rules", it has to look.
 */
export const SCAN_CATEGORIES: readonly ConventionCategory[] = [
  'naming',
  'structure',
  'error-handling',
  'api-contract',
  'testing',
  'imports',
  'async',
  'logging',
  'typing',
  'security',
];
