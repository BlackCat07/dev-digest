/**
 * Project Context — the bounds of the feature, each with the reason it exists.
 *
 * Every value here is a PARAMETER passed outward to `adapters/git/confined-doc.ts`
 * rather than something the adapter reads for itself: `src/adapters/**` must
 * import nothing from `src/modules/**` (`adapters-are-leaves`), so the caps and
 * the excluded-directory set belong to the caller and live in this file.
 */

/**
 * The roots searched when the workspace has configured none (AC-2).
 *
 * Trailing slashes are the spelling the response reports back, because the empty
 * state names them to the reader ("we looked in specs/, docs/ and insights/").
 * The walk normalizes them, so `specs`, `./specs` and `/specs` all mean the same
 * directory — a workspace setting will contain every spelling eventually.
 */
export const DEFAULT_CONTEXT_ROOTS = ['specs/', 'docs/', 'insights/'] as const;

/**
 * Directory names the walk never descends into (AC-7).
 *
 * Written out here rather than imported from `modules/repo-intel/constants.ts`
 * for two reasons. Importing a sibling module's internal is a
 * `no-cross-module-internals` violation that `import type` does not exempt
 * (`server/INSIGHTS.md`, 2026-08-14). And that list is eight names, not nine: it
 * does not carry `.pnpm-store`, which is the one entry this feature cannot do
 * without — a real demo repository committed a `.pnpm-store` of thousands of
 * files and a single walk of it consumed a whole time budget (EC-2).
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
 * Most documents one list answers with (AC-6). The pre-cap `total` is reported
 * beside it, so a full page is never mistaken for the whole set.
 */
export const MAX_DOCUMENTS = 500;

/**
 * Hard ceiling on directory entries the walk visits.
 *
 * A second defence behind {@link EXCLUDED_DIR_NAMES}: the excluded list only
 * stops the caches we know the names of, and this one bounds the request against
 * the cache we do not. Spending it makes the answer `partial` rather than `ok`,
 * because a list cut short by the budget is a floor, not a count.
 */
export const MAX_DIRECTORY_ENTRIES = 20_000;

/**
 * Largest single document read in full, in bytes.
 *
 * The largest `.md` measured on a real clone of this repository is ~47 KB
 * (EC-4), so this is roughly five times the observed worst case — big enough
 * that no genuine document trips it, small enough that a binary blob given a
 * `.md` name (EC-13) cannot be pulled into a prompt.
 */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

/**
 * Project-context tokens one run may carry in total (AC-23).
 *
 * About twice the largest single document, which leaves room for the diff and
 * the rest of the prompt. Applied SKIP-AND-CONTINUE, never stop-at-first: one
 * oversized document early in the effective order must not silently discard
 * every smaller one behind it.
 */
export const RUN_TOKEN_BUDGET = 24_000;

/**
 * The workspace settings key holding the search roots.
 *
 * It rides the `passthrough()` on the `Settings` contract rather than being a
 * `SettingsKnown` field, so it arrives untyped and is `safeParse`d at the read —
 * see `ProjectContextService.resolveRoots`.
 */
export const CONTEXT_ROOTS_SETTING_KEY = 'context_roots';

/**
 * Per-route limit for the document list, layered under the global
 * `max: 120, timeWindow: '1 minute'` registered in `app.ts`.
 *
 * Tighter than the global one because this route walks a filesystem while the
 * others read rows: it is the only endpoint in this module whose cost is set by
 * the repository's size rather than by ours.
 */
export const LIST_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;
