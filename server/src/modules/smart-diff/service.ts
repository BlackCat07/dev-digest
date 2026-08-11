import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { classifyPath } from './classify.js';
import { findingLinesByPath, latestFindingsPerAgent } from './findings.js';
import { buildGroups } from './groups.js';
import { buildSplitSuggestion } from './split.js';
import type { ClassifiedFile, SmartDiffDeps, SmartDiffLog } from './types.js';

/**
 * A2 — Smart Diff (L03b). Orders a PR's changed files for a reviewer.
 *
 * Three properties define this service, and each is a deliberate constraint
 * rather than a simplification:
 *
 *  1. **It never calls a model.** `SmartDiffDeps` has exactly one port — the
 *     review repository — so there is no LLM, no GitHub, no git and no job queue
 *     for a future edit to reach for by accident. Every field of the response is
 *     computed from a path, two integers and a stored patch.
 *  2. **It never writes.** No cache table, no derived row, no freshness rule, and
 *     therefore none of the staleness problems the Intent Layer had to solve. Two
 *     concurrent readers cannot disagree, because there is nothing to claim.
 *  3. **It never fetches the material it is missing.** A PR whose detail route has
 *     never been opened has no `pr_files` rows, and this route answers with empty
 *     groups rather than filling them in from GitHub. `GET /pulls/:id` is the ONLY
 *     writer of `pr_files` by design, and a second writer is precisely how the
 *     Intent Layer ended up classifying PRs from their title alone
 *     (`server/INSIGHTS.md`, 2026-08-11).
 */
export class SmartDiffService {
  constructor(private deps: SmartDiffDeps) {}

  /**
   * The reviewer-ordered view of one PR.
   *
   * Throws `NotFoundError` only, and only when the PR is not in this workspace.
   * That lookup IS the authorization check, for the same reason it is in
   * `IntentService.get`: `pr_files` and `findings` carry no `workspace_id` of
   * their own — they hang off the already-scoped `pull_requests` — so a PR id
   * belonging to another workspace must 404 here rather than fall through to an
   * unscoped read. It is therefore the FIRST await, before either data read.
   *
   * Everything after it answers 200. There is no failure mode left worth an error
   * envelope: missing files, a PR with no review, and a file with no patch are all
   * ordinary states of a local-first tool, and each has a correct empty answer.
   */
  async build(workspaceId: string, prId: string, log?: SmartDiffLog): Promise<SmartDiff> {
    const repo = this.deps.reviewRepo;

    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, reviews] = await Promise.all([
      repo.getPrFiles(prId),
      repo.reviewsForPull(prId),
    ]);

    // Once, for both consumers — see `ClassifiedFile`.
    const classified: ClassifiedFile[] = files.map((file) => ({
      file,
      role: classifyPath(file.path),
    }));

    const { byPath, unmatched } = findingLinesByPath(
      latestFindingsPerAgent(reviews),
      files.map((f) => f.path),
    );
    if (unmatched > 0) {
      log?.debug(
        { prId, unmatched },
        'smart-diff: findings cite files this PR no longer changes; dropped',
      );
    }

    return {
      groups: buildGroups(classified, byPath),
      split_suggestion: buildSplitSuggestion(classified),
    };
  }
}
