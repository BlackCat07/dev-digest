/**
 * Prior PRs — which other pull requests already touched the files this one changes.
 *
 * A NEW FILE rather than a field on `PrBlastRadius` (./blast.js), and the reason is
 * a property of that map worth keeping true: it is derived entirely from the
 * codebase index, at no cost, with no history read. This answer comes from the
 * opposite place — `pr_files` of OTHER pull requests — so it is a second document
 * with its own route, its own states and its own coverage story. The UI renders
 * both in one card; the API does not conflate them.
 *
 * The one thing this contract exists to prevent is the same inference ./blast.js
 * guards against, in a form that bites harder here. `pr_files` is written ONLY by
 * `GET /pulls/:id`, so a repository whose pull requests nobody has opened in the
 * studio has nothing to compare against — and an empty list would read as "no prior
 * pull request touched this code", which is a strong and possibly false claim. Hence
 * `status`, `reason` and `coverage`: the response says how much of the repository's
 * history it was actually able to look at.
 */
import { z } from 'zod';

/**
 * How much of the repository's pull-request history the answer covers.
 *
 *  - `ok`       — every pull request in the repository has its file list imported,
 *                 so an empty list is a real finding: nothing else touched these
 *                 files.
 *  - `partial`  — some pull requests have no imported file list. What is listed is
 *                 real; what is missing proves nothing.
 *  - `degraded` — nothing could be compared at all. The list is empty because no
 *                 comparison happened, not because no prior work exists.
 */
export const PriorPrsStatus = z.enum(['ok', 'partial', 'degraded']);
export type PriorPrsStatus = z.infer<typeof PriorPrsStatus>;

/**
 * Why the status is not `ok`. Null when it is.
 *
 *  - `no_changed_files`        — THIS pull request has no `pr_files` rows, so there
 *                                is no set of paths to compare. Open it once in the
 *                                studio (`GET /pulls/:id` is that table's only
 *                                writer) and the answer becomes computable.
 *  - `no_file_lists`           — other pull requests exist, and not one of them has
 *                                an imported file list.
 *  - `incomplete_file_lists`   — some of them do and some do not.
 */
export const PriorPrsReason = z.enum([
  'no_changed_files',
  'no_file_lists',
  'incomplete_file_lists',
]);
export type PriorPrsReason = z.infer<typeof PriorPrsReason>;

/**
 * One earlier pull request that changed at least one of the same files.
 *
 * `author` is carried because the reviewer's next action is usually a question
 * rather than a click, and this names who to ask. `shared_files` is the evidence
 * for the row — the overlap itself, not a similarity score — capped, with
 * `shared_file_count` reporting the size before the cap.
 */
export const PriorPr = z.object({
  id: z.string(),
  /** GitHub pull request number, which is also how the studio addresses it. */
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  /** ISO. Null when the import never recorded one. */
  updated_at: z.string().nullable(),
  opened_at: z.string().nullable(),
  /** The overlapping paths, capped; ordered as the changed-file list orders them. */
  shared_files: z.array(z.string()),
  /** Size of the overlap BEFORE the cap, so a short list is never read as the whole. */
  shared_file_count: z.number().int(),
});
export type PriorPr = z.infer<typeof PriorPr>;

/** What the answer was computed over — the denominator behind `status`. */
export const PriorPrsCoverage = z.object({
  /** Pull requests in this repository whose file list has been imported. */
  with_file_lists: z.number().int(),
  /** Pull requests in this repository, imported file list or not. */
  total: z.number().int(),
});
export type PriorPrsCoverage = z.infer<typeof PriorPrsCoverage>;

/**
 * Response of `GET /pulls/:id/prior-prs`.
 *
 * Read-only and derived on every request: no row of its own, no cache, no freshness
 * rule. `total` is the number of matching pull requests before `prs` was capped, so
 * "5" above a list of five is a coincidence rather than a guarantee — `truncated`
 * is what says the list was cut.
 */
export const PrPriorPrs = z.object({
  pr_id: z.string(),
  /** Newest first. See `total` / `truncated` for what is not shown. */
  prs: z.array(PriorPr),
  total: z.number().int(),
  truncated: z.boolean(),
  coverage: PriorPrsCoverage,
  status: PriorPrsStatus,
  reason: PriorPrsReason.nullable(),
});
export type PrPriorPrs = z.infer<typeof PrPriorPrs>;
