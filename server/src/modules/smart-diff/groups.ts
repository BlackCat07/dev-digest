/**
 * Assembling the ordered groups — pure. No clock, no I/O, no `this`.
 */
import type { SmartDiffGroup } from '@devdigest/shared';
import { ROLE_ORDER } from './constants.js';
import { normalizePath } from './classify.js';
import { pseudocodeSummary } from './summary.js';
import type { ClassifiedFile } from './types.js';

/**
 * Total order WITHIN a group: biggest churn first, then two tiebreakers.
 *
 * The tiebreakers are not decoration. `getPrFiles` issues no `ORDER BY`, so the
 * rows arrive in whatever physical order the scan produced — and a list the client
 * renders in order needs a TOTAL order or rows move on their own. That failure has
 * already been reported here once as if it were a deliberate feature
 * (`server/INSIGHTS.md`, 2026-08-06: accepting a convention UPDATEd its row,
 * Postgres wrote the tuple elsewhere in the heap, and the card slid down its tie
 * group). Churn ties constantly — every `+1 -0` file is tied — so `path` is
 * needed, and `pr_files` has no unique index on `(pr_id, path)`, so `id` is the
 * last resort that makes the order provably total.
 *
 * It is also worth saying what this order is NOT: findings do not enter it. The
 * brief requires the grouping to work before any review has run, and re-sorting
 * when a review lands would make the list rearrange itself under the reader.
 */
export function byChurnThenPathThenId(a: ClassifiedFile, b: ClassifiedFile): number {
  const churn =
    b.file.additions + b.file.deletions - (a.file.additions + a.file.deletions);
  if (churn !== 0) return churn;
  if (a.file.path !== b.file.path) return a.file.path < b.file.path ? -1 : 1;
  return a.file.id < b.file.id ? -1 : a.file.id > b.file.id ? 1 : 0;
}

/**
 * The contract's `groups`, in reading order, with the findings overlay attached.
 *
 * Groups follow `ROLE_ORDER` rather than the order roles first appear, and an
 * empty role is OMITTED — a "Boilerplate · 0 files" header is a heading with
 * nothing under it, and the client renders a count per group.
 *
 * `path` is emitted VERBATIM, never normalised: the client joins this response
 * against `pr.files` to get the patch text, and a lowercased path would fail to
 * match on any case-sensitive filesystem. Normalisation is for looking findings
 * up, and stops there.
 */
export function buildGroups(
  classified: readonly ClassifiedFile[],
  findingLines: ReadonlyMap<string, number[]>,
): SmartDiffGroup[] {
  const groups: SmartDiffGroup[] = [];

  for (const role of ROLE_ORDER) {
    const members = classified.filter((c) => c.role === role).sort(byChurnThenPathThenId);
    if (members.length === 0) continue;

    groups.push({
      role,
      files: members.map(({ file }) => ({
        path: file.path,
        pseudocode_summary: pseudocodeSummary(file.patch),
        additions: file.additions,
        deletions: file.deletions,
        finding_lines: findingLines.get(normalizePath(file.path)) ?? [],
      })),
    });
  }

  return groups;
}
