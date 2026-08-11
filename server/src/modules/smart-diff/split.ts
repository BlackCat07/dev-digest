/**
 * The split suggestion — pure. No clock, no I/O, no `this`.
 *
 * Answers one question — "is this more than one sitting's work, and if so where
 * are the seams?" — and answers it from the roles the classifier already
 * assigned. No dependency graph, no `file_rank`, no clustering: the directory
 * tree is the repository's own statement of where its module boundaries are, and
 * "these files are one PR" is a claim about a module.
 */
import type { ProposedSplit, SmartDiff, SmartDiffRole } from '@devdigest/shared';
import {
  MAX_PROPOSED_SPLITS,
  ROLE_ORDER,
  SPLIT_BOILERPLATE_NAME,
  SPLIT_CORE_NAME_PREFIX,
  SPLIT_DIR_DEPTH,
  SPLIT_OVERFLOW_NAME,
  SPLIT_REVIEWABLE_FILES_THRESHOLD,
  SPLIT_REVIEWABLE_LINES_THRESHOLD,
  SPLIT_ROOT_KEY,
  SPLIT_WIRING_NAME,
} from './constants.js';
import { normalizePath } from './classify.js';
import { byChurnThenPathThenId } from './groups.js';
import type { ClassifiedFile } from './types.js';

/** Changed lines of one file — the unit both thresholds are measured in. */
function churn(c: ClassifiedFile): number {
  return c.file.additions + c.file.deletions;
}

/**
 * The first {@link SPLIT_DIR_DEPTH} directory segments of a path.
 *
 * Keyed on the NORMALISED path so `Src/Api` and `src/api` cannot become two
 * buckets; the human-readable name is taken from the original path of the first
 * file in the bucket (see `nameFor`), so the case a repository actually uses is
 * what gets displayed.
 */
function dirKey(path: string): string {
  const segments = normalizePath(path).split('/');
  segments.pop(); // the basename
  if (segments.length === 0) return SPLIT_ROOT_KEY;
  return segments.slice(0, SPLIT_DIR_DEPTH).join('/');
}

/** The same segments, in the casing the repository wrote them. */
function dirLabel(path: string): string {
  const segments = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').split('/');
  segments.pop();
  if (segments.length === 0) return SPLIT_ROOT_KEY;
  return segments.slice(0, SPLIT_DIR_DEPTH).join('/');
}

/**
 * Is this PR more than one sitting's work, and where would it divide?
 *
 * **`too_big` is evaluated on `core` + `wiring` only, and that is the whole point
 * of the feature.** A 5 000-line `pnpm-lock.yaml` diff is not a review burden; if
 * boilerplate counted toward "too big", the classifier would be doing no work and
 * every dependency bump would be told to split itself. The visible consequence is
 * worth stating plainly rather than hiding: the banner can read "This PR is large
 * (5 240 changed lines)" while the proposed splits account for 380 of them,
 * because `total_lines` is the PR's real size and the thresholds are the
 * reviewer's real workload.
 *
 * `total_lines` sums EVERY file for exactly that reason — it has to equal the
 * figure the PR header already shows, and a second, smaller definition of "how big
 * is this PR" would read as a bug.
 *
 * Every input file lands in exactly one split: the buckets are a partition, which
 * `test/smart-diff-split.test.ts` asserts. A suggestion that quietly dropped
 * files would be advice to ship a subset.
 */
export function buildSplitSuggestion(
  classified: readonly ClassifiedFile[],
): SmartDiff['split_suggestion'] {
  const total_lines = classified.reduce((sum, c) => sum + churn(c), 0);

  const reviewable = classified.filter((c) => c.role === 'core' || c.role === 'wiring');
  const reviewableLines = reviewable.reduce((sum, c) => sum + churn(c), 0);

  const too_big =
    reviewableLines > SPLIT_REVIEWABLE_LINES_THRESHOLD ||
    reviewable.length > SPLIT_REVIEWABLE_FILES_THRESHOLD;

  // Nothing to propose. Not an empty suggestion — no suggestion.
  if (!too_big) return { too_big: false, total_lines, proposed_splits: [] };

  // Core divides by directory, because that is where a reviewer could plausibly
  // cut. Wiring and boilerplate each collapse to ONE bucket: splitting the
  // mechanical remainder by directory produces buckets nobody would open.
  const buckets = new Map<string, { name: string; role: SmartDiffRole; files: ClassifiedFile[] }>();
  for (const c of classified) {
    const key =
      c.role === 'core'
        ? `core:${dirKey(c.file.path)}`
        : c.role === 'wiring'
          ? SPLIT_WIRING_NAME
          : SPLIT_BOILERPLATE_NAME;
    let bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, (bucket = {
        name:
          c.role === 'core' ? `${SPLIT_CORE_NAME_PREFIX}${dirLabel(c.file.path)}` : key,
        role: c.role,
        files: [],
      }));
    }
    bucket.files.push(c);
  }

  /**
   * ROLE first, then size, then name — a total order, so a shuffled input cannot
   * reorder the advice.
   *
   * Role has to lead, and sorting on size alone was wrong in a way only a test
   * caught: a 940-line lock diff outranks a 300-line `src/api` change, so the
   * advice for a too-big PR opened with "split out the lock file" — the exact
   * inversion this whole feature exists to prevent. The proposed splits are read
   * in the same order as the groups above them, and for the same reason.
   */
  const ordered = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      lines: bucket.files.reduce((sum, c) => sum + churn(c), 0),
    }))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        b.lines - a.lines ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

  const kept = ordered.slice(0, MAX_PROPOSED_SPLITS);
  const overflow = ordered.slice(MAX_PROPOSED_SPLITS);
  if (overflow.length > 0) {
    // The last slot becomes the remainder rather than being dropped, so the
    // partition still covers every file.
    const last = kept.pop()!;
    kept.push({
      name: SPLIT_OVERFLOW_NAME,
      // Inherited from the bucket it replaces, and unused: nothing re-sorts after
      // this point, so the remainder keeps the position it was already in.
      role: last.role,
      files: [...last.files, ...overflow.flatMap((b) => b.files)],
      lines: 0,
    });
  }

  const proposed_splits: ProposedSplit[] = kept.map((bucket) => ({
    name: bucket.name,
    files: [...bucket.files].sort(byChurnThenPathThenId).map((c) => c.file.path),
  }));

  return { too_big: true, total_lines, proposed_splits };
}
