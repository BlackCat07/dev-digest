/**
 * Onboarding Tour — the bounds of the feature, each with the reason it exists.
 *
 * Three kinds of value live here and they are deliberately not mixed up with one
 * another: what goes INTO the prompt, what may come OUT of the model, and what
 * bounds the call itself. A cap on the way in protects the bill; a cap on the way
 * out protects the screen; the call bounds protect the job runner's 120 s.
 *
 * Everything the confined walk is bounded by is also here, because
 * `src/adapters/**` may import nothing from `src/modules/**`
 * (`adapters-are-leaves`) — the adapter enforces the bounds and this feature
 * chooses them. `modules/project-context/constants.ts` states the same rule for
 * the same walk.
 */
import type { FeatureModelId, OnboardingSectionKind } from '@devdigest/shared';

// --- The five sections ------------------------------------------------------

/**
 * The five kinds, in the order every tour carries them (AC-1).
 *
 * Typed against the contract's own enum rather than as bare strings, so removing
 * or renaming a kind in `contracts/onboarding.ts` breaks this file at compile
 * time instead of silently shipping a tour with four sections.
 */
export const SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const satisfies readonly OnboardingSectionKind[];

/**
 * The deterministic title of each section.
 *
 * English as a CONSTANT, not a setting: there is no translation in this feature
 * (N12), and a title the model chose would be a sixth thing to validate. A
 * `Record` keyed on the contract's union so a new kind cannot be added without a
 * title.
 */
export const SECTION_TITLES: Readonly<Record<OnboardingSectionKind, string>> = {
  architecture: 'Architecture',
  critical_paths: 'Critical paths',
  run_locally: 'Run locally',
  reading_path: 'Reading path',
  first_tasks: 'First tasks',
};

// --- Into the prompt --------------------------------------------------------
// The token ceiling is the one that binds; the item counts only keep any single
// block from swallowing it. A file count is two orders of magnitude away from a
// token count, which is the lesson the conventions extractor's own constants record.

/** Most ranked paths offered to the model as the reading-path candidate set. */
export const MAX_PROMPT_PATHS = 200;

/** Most per-file endpoint/cron rows offered to the architecture section. */
export const MAX_ENDPOINT_FACTS = 40;

/** Most declared commands offered to the run-locally section. */
export const MAX_DECLARED_COMMANDS = 60;

/**
 * Ceiling on the whole prompt.
 *
 * The repo map is deliberately NOT given a constant of its own: it is requested
 * with no `tokenBudget` argument, which takes the facade's own
 * `DEFAULT_REPO_MAP_TOKEN_BUDGET` (1 500) — the only budget the pipeline actually
 * renders and caches, so any other number is a guaranteed cache miss and a
 * degraded map.
 */
export const MAX_PROMPT_TOKENS = 12_000;

// --- Out of the model -------------------------------------------------------
// Enforced where the tour is assembled, never as a Zod range keyword: a numeric
// range in a model-facing schema has already broken a structured call on
// Anthropic-via-OpenRouter (`reviewer-core/INSIGHTS.md`, 2026-08-07). Excess is
// discarded WHOLE — half a row is worse than no row (AC-30).

/** Most rows the critical-paths section stores. */
export const MAX_CRITICAL_ROWS = 8;

/** Most entries the reading-path section stores. */
export const MAX_READING_ENTRIES = 10;

/** Most tasks the first-tasks section stores. */
export const MAX_FIRST_TASKS = 6;

/** Most links any one section stores. */
export const MAX_LINKS_PER_SECTION = 4;

/** Most characters of markdown any one section body stores. */
export const MAX_BODY_CHARS = 4000;

// --- The one model call -----------------------------------------------------

/**
 * Wall-clock bound on the structured request (AC-11), enforced by a race.
 *
 * It is NOT `StructuredRequest.timeoutMs`: that field is silently ignored, the
 * timeout being fixed when the OpenAI client is constructed
 * (`server/INSIGHTS.md`, 2026-08-06). 75 s leaves 45 s of `JobRunner`'s fixed
 * 120 s for fact collection and persistence.
 */
export const TOUR_CALL_DEADLINE_MS = 75_000;

/**
 * Provider retries allowed on the structured request — one, i.e. at most two
 * round-trips (AC-10).
 *
 * The provider's own `maxRetries` defaults to **2**, which is three round-trips,
 * so this must be passed explicitly. It bounds a different quantity from
 * {@link TOUR_CALL_DEADLINE_MS} and neither alone bounds anything: the deadline
 * bounds wall-clock, this bounds spend. The second round-trip is
 * `parseWithRepair`'s reprompt.
 */
export const TOUR_MAX_RETRIES = 1;

/**
 * A row still `running` after this long has no worker behind it (EC-18).
 *
 * Without a staleness window a process that died mid-generation blocks every
 * future generation of that repository forever, with no cure a user of the screen
 * has — the shape that bricked a conventions scan (`server/INSIGHTS.md`,
 * 2026-08-06). Same five minutes as `SCAN_STALE_AFTER_MS`, and for the same
 * reason: comfortably past the job runner's 120 s hard timeout.
 */
export const TOUR_STALE_AFTER_MS = 5 * 60_000;

// --- The command walk -------------------------------------------------------

/**
 * Directory names the command walk never descends into.
 *
 * Written out here rather than imported from the repo-intel module's constants
 * for two reasons. Importing a sibling module's internal is a
 * `no-cross-module-internals` violation and `import type` does not exempt it
 * (`server/INSIGHTS.md`, 2026-08-14, measured 22 -> 24 warnings). And that list
 * is eight names, not nine: it does not carry `.pnpm-store`, which a real demo
 * repository committed — thousands of files, each with a `package.json`, every
 * one of which would otherwise be read as a declared command source.
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
 * Hard ceiling on directory entries the command walk visits.
 *
 * A second defence behind {@link EXCLUDED_DIR_NAMES}, which only stops the caches
 * we know the names of. Lower than Project Context's 20 000 because this walk
 * looks for a handful of files at known names rather than for every document in
 * the repository.
 */
export const MAX_COMMAND_SOURCE_ENTRIES = 10_000;

/**
 * Most command-source files the walk reports. A monorepo declaring more
 * `package.json` files than this is already past the point where a run-locally
 * section can be read (EC-7).
 */
export const MAX_COMMAND_SOURCES = 100;

/**
 * A command source larger than this is skipped rather than read.
 *
 * The walk reports `size` without opening the file, so this is checked before a
 * byte is read: a 40 MB lockfile-shaped `docker-compose.yml` cannot be pulled
 * into memory to be scanned for a service name.
 */
export const MAX_COMMAND_SOURCE_BYTES = 256 * 1024;

/**
 * Most lines scanned in any one command source.
 *
 * The `Makefile` and compose scans are line-anchored, so this is what bounds them
 * on a hostile file that fits inside {@link MAX_COMMAND_SOURCE_BYTES} but is one
 * enormous target list.
 */
export const MAX_COMMAND_SOURCE_LINES = 5_000;

// --- Names other code keys on ----------------------------------------------

/**
 * The feature-model registry entry this feature resolves (AC-14).
 *
 * Typed as `FeatureModelId` so a typo is a compile error rather than a silent
 * fallback to the registry default at runtime.
 */
export const ONBOARDING_FEATURE_MODEL: FeatureModelId = 'onboarding';

/** The `JobRunner` kind a generation is enqueued under. */
export const ONBOARDING_JOB_KIND = 'onboarding-generate';

/**
 * The name of the model-facing draft schema.
 *
 * Load-bearing rather than descriptive: `MockLLMProvider.structuredBySchema` keys
 * its fixtures on `req.schemaName`, so a value that does not match the schema's
 * own name makes every test fall back to the generic fixture instead of erroring
 * (`server/INSIGHTS.md`, 2026-08-06, on the same trap in `conventions`).
 */
export const ONBOARDING_SCHEMA_NAME = 'OnboardingDraft';

/**
 * The language the tour is written in, filled into the prompt template's
 * `{{language}}` (N12).
 *
 * A constant rather than an optional, because `renderTemplate` replaces an
 * unmatched placeholder with the EMPTY STRING — so leaving it unset does not
 * leave the placeholder visible, it asks the model to write in nothing.
 */
export const TOUR_LANGUAGE = 'English';
