/**
 * PR Brief (Why + Risk) — every figure the spec fixes, each with its source.
 *
 * Four kinds of value live here and they are deliberately kept apart, the way
 * `modules/onboarding/constants.ts` keeps them apart: what the model input is
 * allowed to CARRY, what bounds the one CALL, what may come OUT of the model,
 * and the names other code keys on. A cap on the way in protects the bill; a cap
 * on the way out protects the screen; the call bounds protect the job runner's
 * fixed 120 s.
 *
 * This file imports NOTHING but types from `@devdigest/shared`. No `drizzle-orm`,
 * nothing from the database layer, no sibling module: the module's only file
 * allowed to touch persistence is `repository.ts`, and a numbers file that
 * reached for a table would be invisible to `depcruise` — its two db rules scope
 * their `from` to `routes.ts` and a fixed filename list carrying neither this
 * file nor `types.ts`, so the check is a grep in this task's Done-condition
 * rather than a graph rule.
 */
import type { BriefSourceKind, FeatureModelId } from '@devdigest/shared';

// --- Names other code keys on ----------------------------------------------

/**
 * The feature-model registry entry a generation resolves its provider+model from
 * (AC-21), falling back to the registry default when the workspace has chosen
 * nothing.
 *
 * Typed as `FeatureModelId` rather than left a bare string so a typo is a
 * compile error here instead of a silent fallback to the default at runtime —
 * the shape `ONBOARDING_FEATURE_MODEL` and `INTENT_FEATURE_MODEL` both use.
 */
export const BRIEF_FEATURE_MODEL: FeatureModelId = 'risk_brief';

/** The `JobRunner` kind a background generation is enqueued under. */
export const BRIEF_JOB_KIND = 'pr-brief-generate';

/**
 * Name of the model-facing draft schema, sent as the `json_schema` / tool name.
 *
 * LOAD-BEARING rather than descriptive: `MockLLMProvider.structuredBySchema`
 * keys its fixtures on `req.schemaName` and FALLS BACK to the generic
 * `structured` fixture when no entry matches instead of erroring, so a value
 * that does not match the schema's own name feeds every test the wrong fixture
 * without failing (`server/INSIGHTS.md`, 2026-08-06, on the same trap in the
 * conventions extractor).
 */
export const BRIEF_SCHEMA_NAME = 'PrBriefDraft';

/**
 * The ninth value in the cache key (AC-2): which brief FORMAT a stored brief was
 * written in.
 *
 * Bumping it invalidates every stored brief in one step, which is the only way
 * to make a change to the prompt, the schema or the grounding rules visible to a
 * cache keyed on the pull request's state — none of the other eight values move
 * when this codebase changes. Bump it whenever a stored brief written by the
 * previous code would be wrong rather than merely older.
 */
export const BRIEF_FORMAT_VERSION = 1;

// --- The one model call -----------------------------------------------------

/**
 * Wall-clock ceiling on the one structured call (AC-20), enforced by an explicit
 * race and NOT by `StructuredRequest.timeoutMs`.
 *
 * That field is silently ignored — the timeout is fixed when the OpenAI client
 * is constructed — so a per-request timeout looks like it bounds a call and does
 * not (`server/INSIGHTS.md`, 2026-08-06). 75 s is the intent classifier's figure
 * (`INTENT_CALL_DEADLINE_MS`) and leaves 45 s of `JobRunner`'s fixed 120 s for
 * the assembly either side of the call.
 */
export const BRIEF_CALL_DEADLINE_MS = 75_000;

/**
 * Provider retries allowed on the structured call: none, i.e. at most ONE
 * round-trip (AC-19).
 *
 * Must be passed explicitly, because the provider's own `maxRetries` defaults to
 * **2** — three round-trips of up to 90 s each. It bounds a different quantity
 * from {@link BRIEF_CALL_DEADLINE_MS} and neither alone bounds anything: the
 * deadline bounds wall-clock, this bounds spend, and retries inside the provider
 * are invisible to the race until they have already been paid for. Mirrors
 * `INTENT_MAX_RETRIES`, which is zero for the same reason: a brief that fails is
 * survivable, and a repair reprompt would contradict "at most one round-trip".
 */
export const BRIEF_MAX_RETRIES = 0;

/**
 * After this long, a generation still marked `running` is treated as abandoned
 * and a new one is allowed (AC-9).
 *
 * The same five minutes as `INTENT_STALE_AFTER_MS` and `SCAN_STALE_AFTER_MS`,
 * and for the same reason: comfortably past the job runner's 120 s hard timeout,
 * so a process that died mid-generation cannot brick the card forever — nothing
 * on the screen can clear that row, and a conventions scan was bricked exactly
 * this way before it had a window (`server/INSIGHTS.md`, 2026-08-06).
 *
 * It is applied inside the claim's own `WHERE`, never as a read followed by a
 * write — see this module's `BriefStore.claimRunning`.
 */
export const BRIEF_STALE_AFTER_MS = 5 * 60_000;

// --- Into the model input ---------------------------------------------------
// The token ceiling is the one that binds. The item and character caps keep any
// single block from swallowing it, and a file count is two orders of magnitude
// away from a token count — the lesson the conventions extractor's constants
// record.

/**
 * Ceiling on the whole input, measured as `sum of ceil(characters / 4)` over the
 * system and user messages exactly as sent (AC-12, AC-13).
 *
 * The repository's existing `approxTokens` rule, so this feature's figure and
 * Project Context's are comparable rather than merely similarly named. Lower
 * than the onboarding tour's 12 000 because this input carries no repository map
 * and, deliberately, no diff hunk body at all — the budget rests on that
 * absence.
 *
 * Over budget, WHOLE sources are dropped in {@link SHED_ORDER} until it fits;
 * {@link CORE_SOURCES} are never dropped, and if the core alone overruns, no
 * call is made (AC-14, AC-15, AC-16).
 */
export const MAX_PROMPT_TOKENS = 8_000;

/**
 * Most changed-file paths the input carries (AC-17), applied AFTER the role
 * ordering and never before it.
 *
 * Passed as an argument to `capFileList` rather than read from there, so
 * `file-roles.ts` stays free of the spec's numbers. Capping an unordered list
 * spends the budget on whatever `pr_files` returned, which on a large pull
 * request is dominated by generated and vendored files (OQ-7).
 */
export const MAX_PROMPT_PATHS = 200;

/**
 * Most characters of the pull request's description the input carries.
 *
 * The intent classifier's figure, deliberately: two features reading the same
 * material at the same depth cannot disagree about what the author said.
 */
export const MAX_BODY_CHARS = 4_000;

/**
 * Most characters any ONE fetched source contributes — the linked issue's body,
 * one repository document. Also the intent classifier's figure, for the same
 * reason.
 */
export const MAX_SOURCE_CHARS = 8_000;

/**
 * Most prior pull requests the input names, newest first.
 *
 * Five overlapping pull requests already say "this area moves often"; the sixth
 * adds paths and no signal. `pr_files` is sparse on every real workspace — 10 of
 * 14 pull requests carried rows in a measured one — so this cap is rarely the
 * binding constraint (`server/INSIGHTS.md`, 2026-08-15).
 */
export const MAX_PRIOR_PRS = 5;

// --- Out of the model -------------------------------------------------------
// Enforced in `grounding.ts`, never as a Zod range keyword: a numeric range in a
// model-facing schema has already broken a structured call on
// Anthropic-via-OpenRouter (`reviewer-core/INSIGHTS.md`, 2026-08-07). Everything
// over a cap is discarded WHOLE — half a risk is worse than no risk (EC-16).

/**
 * Most risks a stored brief carries.
 *
 * The intent layer's `MAX_RISK_AREAS`, and the same argument: six rows is
 * already a wall, and past that the block stops being a summary and starts being
 * a second findings list — which is a different feature with its own severity
 * filter.
 */
export const MAX_RISKS = 6;

/**
 * File references kept per risk, after grounding.
 *
 * A risk that genuinely spans a dozen files is a risk about the whole pull
 * request, and naming three of them is as useful as naming twelve — the reader
 * clicks through either way.
 */
export const MAX_RISK_FILE_REFS = 3;

/** A risk title is a noun phrase; longer than this and it wraps to three lines. */
export const MAX_RISK_TITLE_CHARS = 80;

/** A risk explanation is two sentences, not an essay. */
export const MAX_RISK_EXPLANATION_CHARS = 400;

/**
 * Most review-focus rows a stored brief carries.
 *
 * Matched to {@link MAX_RISKS} on purpose: the two lists are read together, and
 * a card whose "look here first" list is longer than its risk list has stopped
 * prioritising anything.
 */
export const MAX_REVIEW_FOCUS = 6;

/** The `what` is one statement above the fold, not a summary of the diff. */
export const MAX_WHAT_CHARS = 280;

/** The `why` may carry the ticket's reasoning, so it gets a little more room. */
export const MAX_WHY_CHARS = 400;

/** One line of advice per review-focus row; the row is a link, not a paragraph. */
export const MAX_FOCUS_REASON_CHARS = 200;

// --- The budget ladder ------------------------------------------------------

/**
 * The order optional sources are dropped in when the input is over budget
 * (AC-14), most droppable first.
 *
 * Repository documents go first because they are the largest and the least
 * specific to THIS change; the description goes last because it is the only
 * place the author states the goal in their own words. Each drop is recorded as a
 * `BriefSource` with status `dropped_over_budget` and a reason (AC-33), so a
 * deliberately shorter prompt never reads as a broken one.
 *
 * Dropped WHOLE, never trimmed: half a blast map reads to the model as a
 * complete one and is worse than its absence.
 *
 * Typed against `BriefSourceKind` so a kind renamed in the contract breaks this
 * file at compile time instead of silently shedding nothing.
 */
export const SHED_ORDER = [
  'repo_doc',
  'prior_prs',
  'linked_issue',
  'blast',
  'pr_body',
] as const satisfies readonly BriefSourceKind[];

/**
 * The sources that are never dropped, whatever the budget says (AC-15).
 *
 * Not a preference: grounding is DEFINED against the changed-file list, so a
 * call made without it cannot produce a checkable answer, and the title and the
 * intent record are what make the answer about this pull request rather than
 * about a diff in general. If the core alone overruns, the assembly reports that
 * and no call is made — nothing is charged for an answer that could not have
 * been grounded (AC-16).
 *
 * Together with {@link SHED_ORDER} this covers every member of
 * `BriefSourceKind`, and the two lists are disjoint. That is asserted where the
 * shedding happens rather than trusted here, because a kind added to the
 * contract and to neither list would silently become undroppable.
 */
export const CORE_SOURCES = [
  'pr_title',
  'file_list',
  'intent',
] as const satisfies readonly BriefSourceKind[];

// --- The document walk ------------------------------------------------------
//
// The effective document set is chosen by Project Context; what this module does
// with it is size the paths for the cache key and read the ones that fit. Both
// go through the confined reader, whose bounds are CALLER-owned because
// `src/adapters/**` may import nothing from `src/modules/**` — the adapter
// enforces the bounds and the feature chooses them, exactly as
// `modules/project-context/constants.ts` and `modules/onboarding/constants.ts`
// state for the same walk. The `roots` of a walk are not here: they are the
// directories the effective set's own paths live in, so there is nothing to fix
// in advance.

/**
 * Directory names the walk never descends into.
 *
 * Written out here rather than imported from a sibling module's constants:
 * importing one is a `no-cross-module-internals` violation that `import type`
 * does not exempt (`server/INSIGHTS.md`, 2026-08-14, measured at 22 warnings
 * going to 24). `.pnpm-store` is the entry that cannot be dropped — a real demo
 * repository committed one of thousands of files, and a single walk of it
 * consumed a whole time budget.
 */
export const EXCLUDED_DIR_NAMES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
  '.pnpm-store',
] as const;

/**
 * Hard ceiling on directory entries one walk visits.
 *
 * The second defence behind {@link EXCLUDED_DIR_NAMES}, which only stops the
 * caches whose names are known. Spending it makes the document set's sizes a
 * floor rather than a count, which is why a path the walk did not report
 * contributes size `0` and an `unfetched` source entry instead of being silently
 * omitted from the key.
 */
export const MAX_DIRECTORY_ENTRIES = 20_000;

/**
 * Most documents one walk reports. Project Context's figure, over the same set.
 */
export const MAX_LISTED_DOCS = 500;

/**
 * Largest single document read in full, in bytes.
 *
 * The walk reports `size` without opening the file, so this is checked before a
 * byte is read: a binary blob given a `.md` name cannot be pulled into a prompt.
 * Project Context's figure, roughly five times the largest `.md` measured on a
 * real clone of this repository.
 */
export const MAX_DOCUMENT_BYTES = 256 * 1024;
