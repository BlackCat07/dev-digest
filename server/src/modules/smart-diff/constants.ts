/**
 * Constants for Smart Diff (L03b) — every pattern and every threshold the
 * feature has, in one file.
 *
 * They live here rather than next to their use for the reason the lesson brief
 * asks for it: a role assignment is a judgement about someone else's repository,
 * and a reviewer who disagrees with one should be able to find and change it
 * without reading the classifier. Each constant carries the reason for its value.
 */
import type { SmartDiffRole } from '@devdigest/shared';

// --- The asymmetric-cost rule -----------------------------------------------

/**
 * Role assigned to a path no pattern recognises.
 *
 * `core`, and this is the single most important decision in the module. The two
 * mistakes do NOT cost the same:
 *
 *  - A false `core` costs the reviewer one extra expanded file. Mildly annoying.
 *  - A false `boilerplate` **hides a change**: the group starts collapsed, so a
 *    file nobody classified correctly is a file nobody reads.
 *
 * So an unrecognised path is treated as the substance of the change until a
 * pattern proves otherwise, and every entry in {@link ROLE_BY_PATH} is therefore
 * a claim of certainty rather than a guess. When adding a pattern, ask whether
 * you would stake a missed bug on it.
 */
export const DEFAULT_ROLE: SmartDiffRole = 'core';

/**
 * The order groups are returned in, and the whole point of the feature: the
 * substance first, the mechanical last.
 *
 * `buildGroups` iterates THIS array rather than the insertion order of a `Map`,
 * so the output order cannot drift with the order files happen to arrive in.
 */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

// --- Lock files -------------------------------------------------------------

/**
 * Dependency lock files, by basename.
 *
 * A standalone list — not just rows in {@link ROLE_BY_PATH} — because
 * "a lock file is ALWAYS boilerplate" is an acceptance criterion, and a criterion
 * that is universal over a set needs the set to be nameable. `classifyPath`
 * checks {@link LOCK_FILE_PATTERN} in a statement ABOVE the pattern table, so no
 * future row can be inserted in front of it, and
 * `test/smart-diff-classify.test.ts` iterates this same array — so a name added
 * here is covered by the test automatically instead of needing a second,
 * drifting copy.
 *
 * Matched against a lowercased path, hence `gemfile.lock` rather than
 * `Gemfile.lock`.
 */
export const LOCK_FILE_NAMES: readonly string[] = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'deno.lock',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'go.sum',
  'packages.lock.json',
  'paket.lock',
  'mix.lock',
  'pubspec.lock',
  'flake.lock',
  'conan.lock',
  'podfile.lock',
  'package.resolved',
  'gradle.lockfile',
];

/**
 * {@link LOCK_FILE_NAMES} as one anchored basename pattern.
 *
 * DERIVED rather than written out, which is the opposite of the house habit of
 * literal regexes — justified here because the test and the classifier must
 * provably agree on the same set. `.` and friends are escaped, so
 * `package.resolved` cannot match `packageXresolved`.
 */
export const LOCK_FILE_PATTERN = new RegExp(
  `(^|/)(${LOCK_FILE_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
);

// --- The role table ---------------------------------------------------------

/**
 * Path patterns that decide a role, FIRST MATCH WINS.
 *
 * Same shape as `modules/intent/risks.ts`'s `KIND_BY_PATH`, and applied against
 * a path that `classifyPath` has already normalised and LOWERCASED — which is
 * why `dockerfile`, `makefile` and `license` need no case variants.
 *
 * The block order is load-bearing, so it is documented per block rather than per
 * row. All boilerplate blocks precede all wiring blocks, which is what stops
 * `dist/main.js` reading as an entry point.
 */
export const ROLE_BY_PATH: ReadonlyArray<readonly [RegExp, SmartDiffRole]> = [
  // 1. Build output, vendored and generated trees.
  //
  // First, because it is the only block where a path is CERTAINLY not authored
  // by hand — the strongest evidence the table has, and it must outrank the
  // wiring rules below (`dist/main.js`, `build/index.js`). `migrations/` is here
  // because migration SQL is generated in this repo too (root `CLAUDE.md` lists
  // it do-not-touch, and `repo-intel` already treats it as junk); the cost is
  // that a hand-written migration elsewhere lands in the collapsed group.
  [/(^|\/)(dist|build|out|coverage|node_modules|vendor|target|\.next|\.turbo|\.svelte-kit|__pycache__)\//, 'boilerplate'],
  [/(^|\/)(generated|__generated__)\//, 'boilerplate'],
  [/(^|\/)migrations?\//, 'boilerplate'],
  [/\.(gen|generated)\.[a-z0-9]+$/, 'boilerplate'],
  [/\.pb\.(go|ts|js)$|_pb2?\.py$/, 'boilerplate'],
  [/\.min\.(js|css)$/, 'boilerplate'],
  [/\.(js|css)\.map$/, 'boilerplate'],
  [/\.d\.ts$/, 'boilerplate'],

  // 2. Snapshots, tests and fixtures. The brief lists tests under boilerplate
  //    explicitly: a reviewer reads the test to check the change, not to find
  //    the bug. `.d.ts` sits in block 1 instead of here because it is generated
  //    output rather than a test.
  [/(^|\/)__snapshots__\//, 'boilerplate'],
  [/\.snap$/, 'boilerplate'],
  [/(^|\/)(test|tests|__tests__|__mocks__|e2e|cypress|playwright|fixtures|__fixtures__|testdata)\//, 'boilerplate'],
  [/\.(test|spec)\.[a-z0-9]+$/, 'boilerplate'],

  // 3. Package manifests. Grouped with their lock files rather than with config,
  //    because a manifest diff is a version list and splitting the two across
  //    groups is arbitrary. Accepted cost: a dependency bump is review-worthy
  //    and is now one click away instead of zero.
  [/(^|\/)(package\.json|composer\.json|gemfile|cargo\.toml|go\.mod|requirements\.txt|pipfile|pyproject\.toml|pubspec\.yaml|pom\.xml|build\.gradle(\.kts)?)$/, 'boilerplate'],

  // 4. Prose. Not business logic. Note the label is a READING-ORDER bucket, not
  //    a claim of worthlessness — a `docs` role would need a fourth member of a
  //    frozen contract enum, so it cannot be modelled today.
  [/\.(md|mdx|txt|rst|adoc)$/, 'boilerplate'],
  [/(^|\/)(license|licence|notice|changelog|codeowners|authors)(\.[a-z]+)?$/, 'boilerplate'],

  // 5. Entry points and barrels — before configuration, so `src/api/index.ts`
  //    and `src/server.ts` land here whatever directory they sit in.
  [/(^|\/)(index|main|mod)\.[a-z0-9]+$/, 'wiring'],
  [/(^|\/)(app|server|bootstrap|entry|wsgi|asgi|__init__)\.[a-z0-9]+$/, 'wiring'],

  // 6. Configuration. Deliberately does NOT include `constants.*`: a constants
  //    file in this codebase holds thresholds a reviewer must read, and under
  //    the asymmetric-cost rule an arguable case stays `core`.
  //
  //    The by-extension catch-all is LAST inside the block on purpose, so
  //    `.github/workflows/ci.yml` is attributed by its directory rather than by
  //    being a `.yml`.
  [/(^|\/)(config|configuration|settings|env)\.[a-z0-9]+$/, 'wiring'],
  [/(^|\/)(config|\.github|\.circleci|\.husky|k8s|helm|deploy|infra|terraform)\//, 'wiring'],
  [/\.config\.[a-z0-9]+$/, 'wiring'],
  [/(^|\/)(tsconfig|jsconfig)([.-][a-z0-9.]+)?\.json$/, 'wiring'],
  [/(^|\/)(dockerfile|docker-compose(\.[a-z0-9]+)?\.ya?ml|makefile|procfile|justfile|rakefile)$/, 'wiring'],
  [/(^|\/)\.env(\..+)?$/, 'wiring'],
  [/(^|\/)\.[a-z0-9-]+(rc|ignore|config)(\.[a-z0-9]+)?$/, 'wiring'],
  [/\.(ya?ml|toml|ini|cfg|conf|properties|json5?)$/, 'wiring'],
];

// --- Findings overlay -------------------------------------------------------

/**
 * Most `finding_lines` entries returned for one file.
 *
 * A bound is needed because the count is not bounded by the review's own limits:
 * `reviewer-core`'s `FULL_FILE_KINDS` findings (`secret_leak`, `lethal_trifecta`,
 * `phantom`, `hook`) bypass line grounding entirely, so one of them can carry a
 * whole-file range legitimately. 50 is far above any real per-file finding count
 * and small enough that the array cannot dominate the response.
 */
export const MAX_FINDING_LINES_PER_FILE = 50;

// --- Split suggestion ------------------------------------------------------

/**
 * Changed lines of core+wiring past which one sitting stops being enough.
 *
 * Measured against nothing in this repo — it is the long-standing 200–400
 * lines-per-review guidance, taken at its UPPER end so only PRs past *every*
 * version of that advice are flagged. A suggestion that fires on a routine PR is
 * noise, and noise here is expensive: the banner sits above the diff a reviewer
 * came to read.
 */
export const SPLIT_REVIEWABLE_LINES_THRESHOLD = 400;

/**
 * Core+wiring files past which the reviewer is navigating rather than reading.
 *
 * A second, independent trigger because line count alone misses the shape that
 * actually hurts: forty two-line edits across forty files is a smaller diff than
 * one 400-line function and a much worse review.
 */
export const SPLIT_REVIEWABLE_FILES_THRESHOLD = 15;

/**
 * Path segments that name a core split — `src/api/public/x.ts` → `src/api`.
 *
 * Two, following `modules/conventions/sampler.ts`'s `groupKey` and for the same
 * reason: one segment collapses everything under `src/`, three splits siblings
 * that belong together. The directory is the partition because it is the only
 * grouping a reader can act on — "these files are one PR" is a claim about a
 * module, and the tree is the repository's own statement of where modules are.
 */
export const SPLIT_DIR_DEPTH = 2;

/** Key used for a file that sits at the repository root, which has no directory. */
export const SPLIT_ROOT_KEY = '(root)';

/**
 * Most splits proposed before the remainder is folded into one bucket.
 *
 * Five, because a suggestion to break one PR into more than five is not advice a
 * reviewer can act on — past that the honest recommendation is "start over", and
 * this feature is not entitled to say so.
 */
export const MAX_PROPOSED_SPLITS = 5;

/**
 * Names of the non-core splits, rendered VERBATIM by the client.
 *
 * Not translated, and deliberately: `ProposedSplit.name` is a `z.string()` in a
 * frozen contract with no key in `messages/en/`, so the server is the only place
 * this text can come from. Kept short because the client renders it as a list
 * item, and carrying no file count because the client derives that from
 * `files.length`.
 */
export const SPLIT_CORE_NAME_PREFIX = 'Core: ';
export const SPLIT_WIRING_NAME = 'Wiring & config';
export const SPLIT_BOILERPLATE_NAME = 'Generated, tests & lock files';
export const SPLIT_OVERFLOW_NAME = 'Remaining changes';

// --- Pseudocode summary ----------------------------------------------------

/**
 * Most symbols quoted into one file's summary.
 *
 * Four fits on one line at the width the card renders, and a longer list stops
 * being a summary. The symbols are the first four in patch order rather than a
 * ranked selection — ranking would need to read the diff body, which this
 * feature never does.
 */
export const MAX_SUMMARY_SYMBOLS = 4;

/** Hard character ceiling on a summary, so one pathological header cannot wrap the card. */
export const MAX_SUMMARY_CHARS = 120;

/** Separator between quoted symbols. */
export const SUMMARY_SEPARATOR = ', ';
