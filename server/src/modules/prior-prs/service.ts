import type {
  PriorPr,
  PriorPrsCoverage,
  PriorPrsReason,
  PriorPrsStatus,
  PrPriorPrs,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_PRIOR_PRS, MAX_SHARED_FILES } from './constants.js';
import type { PriorPrsDeps, PriorPrsOverlapRow } from './types.js';

/**
 * L04 — Prior PRs. Answers "who else has been in these files?" for one PR.
 *
 * The history half of the Blast Radius card, and a deliberately separate service
 * from `BlastService`, because it answers the question from the opposite direction.
 * Blast Radius reads the CODEBASE INDEX and looks forward — what could this change
 * reach. This reads `pr_files` of other pull requests and looks backward — what has
 * already been changed here, and by whom. Keeping them apart is what lets the impact
 * map keep saying, without qualification, that it is derived from the index alone.
 *
 * Three properties, each a constraint:
 *
 *  1. **No model, no code analysis, no clone.** One port, one history query. Nothing
 *     here is generated text and nothing here parses a repository.
 *  2. **It never writes.** No cache row, no derived record, no freshness rule.
 *  3. **An empty list is never silently empty.** `pr_files` is written ONLY by
 *     `GET /pulls/:id`, so a workspace whose pull requests nobody has opened has
 *     nothing to compare against — and "no prior pull request touched this code" is
 *     a claim strong enough that it must not be made by accident. `status`,
 *     `reason` and `coverage` carry the difference between a finding and a gap.
 */
export class PriorPrsService {
  constructor(private deps: PriorPrsDeps) {}

  /**
   * The earlier pull requests overlapping this one's changed files.
   *
   * Throws `NotFoundError` only, and only for a PR outside the caller's workspace.
   * That lookup IS the authorization check and is therefore the FIRST await:
   * `pr_files` carries no `workspace_id` of its own, so every read after it is
   * scoped by the `repoId` this one returned. Everything else answers 200 — a PR
   * with no imported files, a repository with one pull request and a repository
   * nobody has opened are all ordinary states with a correct, non-error answer.
   */
  async build(workspaceId: string, prId: string): Promise<PrPriorPrs> {
    const pull = await this.deps.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, counted] = await Promise.all([
      this.deps.reviewRepo.getPrFiles(prId),
      this.deps.reviewRepo.countPullCoverage(pull.repoId),
    ]);
    const coverage: PriorPrsCoverage = {
      with_file_lists: counted.withFileLists,
      total: counted.total,
    };

    const changedFiles = [...new Set(files.map((f) => f.path))].sort();

    // Same refusal `BlastService.build` makes, for the same reason: this module does
    // not fetch the file list from GitHub to fill the gap. `GET /pulls/:id` is that
    // table's only writer by design, and a second writer is precisely how the Intent
    // Layer came to classify pull requests from their title alone
    // (`server/INSIGHTS.md`, 2026-08-11).
    if (changedFiles.length === 0) {
      return empty(prId, coverage, 'degraded', 'no_changed_files');
    }

    const overlaps = await this.deps.reviewRepo.listPriorPrOverlaps(
      pull.repoId,
      prId,
      changedFiles,
    );
    const grouped = group(overlaps).sort(compareNewestFirst);
    const { status, reason } = statusOf(coverage);

    return {
      pr_id: prId,
      prs: grouped.slice(0, MAX_PRIOR_PRS).map(toPriorPr),
      total: grouped.length,
      truncated: grouped.length > MAX_PRIOR_PRS,
      coverage,
      status,
      reason,
    };
  }
}

/** One pull request with every path of the overlap, before the row is capped. */
interface Grouped {
  row: PriorPrsOverlapRow;
  paths: string[];
}

/**
 * (pull request, path) pairs → one entry per pull request.
 *
 * The paths are sorted so a row's evidence reads the same way twice, and so the
 * `MAX_SHARED_FILES` cap always keeps the SAME five of them rather than whichever
 * five the join happened to emit first.
 */
function group(rows: readonly PriorPrsOverlapRow[]): Grouped[] {
  const byPr = new Map<string, Grouped>();
  for (const row of rows) {
    const existing = byPr.get(row.id);
    if (existing) existing.paths.push(row.path);
    else byPr.set(row.id, { row, paths: [row.path] });
  }
  for (const entry of byPr.values()) entry.paths.sort();
  return [...byPr.values()];
}

/**
 * Newest first, and a TOTAL order.
 *
 * Recency is the primary key because that is what "prior" is being asked for — the
 * last person in this code, not the biggest overlap. The tiebreakers are not
 * decoration: `updated_at` is nullable (the list import may never have recorded
 * one), ties are ordinary, and a comparator with no tiebreaker leaves the order to
 * Postgres's physical row order, which shifts the moment a row is updated
 * (`server/INSIGHTS.md`, 2026-08-06). `number` is unique per repository
 * (`pr_repo_number_uq`), so it closes the order.
 */
function compareNewestFirst(a: Grouped, b: Grouped): number {
  const at = timeOf(a.row);
  const bt = timeOf(b.row);
  if (at !== bt) return bt - at;
  return b.row.number - a.row.number;
}

/** A row's clock: last update, else when it was opened, else "oldest possible". */
function timeOf(row: PriorPrsOverlapRow): number {
  return row.updatedAt?.getTime() ?? row.openedAt?.getTime() ?? 0;
}

function toPriorPr({ row, paths }: Grouped): PriorPr {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    updated_at: row.updatedAt?.toISOString() ?? null,
    opened_at: row.openedAt?.toISOString() ?? null,
    shared_files: paths.slice(0, MAX_SHARED_FILES),
    shared_file_count: paths.length,
  };
}

/**
 * How much of the repository's history the answer actually covers.
 *
 * Computed from the coverage figures rather than from the result, because the
 * result cannot distinguish the two empty cases. Both counts INCLUDE the pull
 * request being viewed — it is one of the repository's pull requests and it has a
 * file list, or `build` would have returned before reaching here — so both are
 * reduced by one to describe the pull requests actually searched.
 */
function statusOf(coverage: PriorPrsCoverage): {
  status: PriorPrsStatus;
  reason: PriorPrsReason | null;
} {
  const others = Math.max(0, coverage.total - 1);
  const searched = Math.max(0, coverage.with_file_lists - 1);

  // A repository with one pull request has no prior work, and that is a fact rather
  // than a gap — the only empty answer this feature is allowed to state plainly.
  if (others === 0) return { status: 'ok', reason: null };
  if (searched === 0) return { status: 'degraded', reason: 'no_file_lists' };
  if (searched < others) return { status: 'partial', reason: 'incomplete_file_lists' };
  return { status: 'ok', reason: null };
}

function empty(
  prId: string,
  coverage: PriorPrsCoverage,
  status: PriorPrsStatus,
  reason: PriorPrsReason | null,
): PrPriorPrs {
  return { pr_id: prId, prs: [], total: 0, truncated: false, coverage, status, reason };
}
