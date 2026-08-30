/**
 * Every magic number and fixed string this module owns.
 *
 * What is NOT here is as deliberate as what is: the artifact name, the result
 * file name, the branch, the pull-request title and the four generated paths all
 * live in `@devdigest/shared`'s `contracts/ci-runtime.ts`, because the generator
 * writes them and a runner deployed in someone else's repository reads them back.
 * A second copy here would let one side move without the other, which is the one
 * failure the type system cannot catch.
 */

/**
 * The `pull_request` activity types the generated workflow may subscribe to.
 *
 * A closed set rather than a filter over free text: `triggers` arrives from a
 * request body typed `z.array(z.string())`, and the workflow it lands in runs
 * with a repository token. The intersection is taken against THIS list, so a
 * value nobody here vetted cannot reach the YAML (AC-10), and the comment-driven
 * events AC-11 forbids are absent by construction rather than by a deny-list.
 */
export const ALLOWED_TRIGGER_TYPES = ['opened', 'synchronize', 'reopened'] as const;
export type AllowedTriggerType = (typeof ALLOWED_TRIGGER_TYPES)[number];

/** Commit message of the single commit an export writes onto the export branch. */
export const CI_COMMIT_MESSAGE = 'chore: add DevDigest CI review';

/**
 * Body of the pull request the export opens. Plain prose on purpose: the person
 * reviewing it is being asked to accept a workflow that will run with their
 * repository's token, and the file list is what they should be reading.
 */
export const CI_EXPORT_PR_BODY = [
  'DevDigest exported a CI reviewer into this repository.',
  '',
  'This pull request adds a GitHub Actions workflow, one agent manifest, the',
  'agent’s skill files and a self-contained runner. The workflow requests only',
  '`contents: read` and `pull-requests: write`, runs on `pull_request` events from',
  'this repository only, and needs an `OPENROUTER_API_KEY` repository secret to do',
  'anything at all.',
].join('\n');

/**
 * Total byte budget for one generated bundle, over every file's contents.
 *
 * The runner bundle is effectively the whole of it. Exceeding it fails the export
 * with a named error rather than committing megabytes into a repository DevDigest
 * does not maintain.
 */
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

/** Installations read per refresh cycle, so one workspace cannot exhaust a rate limit. */
export const REFRESH_INSTALLATION_CAP = 30;

/** Minimum gap between two reads of the same installation, in milliseconds. */
export const REFRESH_THROTTLE_MS = 60_000;

/** Workflow runs asked for per installation on one refresh cycle. */
export const REFRESH_RUNS_PER_INSTALLATION = 20;

/** Default page size of the CI Runs list. */
export const RUNS_PAGE_SIZE = 50;

/** Hard ceiling on that page size, so a caller cannot ask for the whole table. */
export const RUNS_PAGE_MAX = 200;

/**
 * GitHub's own lifecycle value for a finished workflow run. Anything else is a
 * run still in flight, which is recorded as `running` and re-read next cycle
 * rather than downloaded — there is no artifact to fetch yet.
 */
export const RUN_STATUS_COMPLETED = 'completed';
