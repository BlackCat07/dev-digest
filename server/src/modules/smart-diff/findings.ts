/**
 * The findings overlay — pure. No clock, no I/O, no `this`.
 *
 * Turns "every review this PR has ever had" into "which lines of which file a
 * reviewer should look at". Two steps, deliberately separate: choosing WHICH
 * reviews count, then mapping their findings onto the PR's current files.
 */
import { MAX_FINDING_LINES_PER_FILE } from './constants.js';
import { normalizePath } from './classify.js';
import type { SmartDiffFindingRow, SmartDiffReviewRow } from './types.js';

/** The `kind` of a `reviews` row that carries per-line findings. */
const REVIEW_KIND = 'review';

/** Prefix on the fallback grouping key, so a row id can never collide with an agent id. */
const ROW_KEY_PREFIX = 'row:';

/**
 * Findings of the newest review PER AGENT — the union, not the single newest row.
 *
 * This is the one non-obvious decision in the module. A review fans out over the
 * workspace's agents and `runOneAgent` writes one `reviews` row **per agent**, so
 * `reviewsForPull(prId)[0]` is not "the latest review" — it is whichever agent
 * happened to finish last. Taking it would show the security agent's badges and
 * silently hide the performance agent's. That exact mistake shipped once already,
 * for the PR list's score and cost columns (`server/INSIGHTS.md`, 2026-08-03),
 * where it reported one agent's $0.00064 of a real $0.0051.
 *
 * Reducing per agent instead gives the semantics the rest of the app already
 * has: re-running one agent REPLACES its badges rather than doubling them.
 *
 * Two details that are not defensive coding:
 *
 *  - `kind` is filtered HERE. `reviewsForPull` does not filter it, and the PR
 *    list does — the two consumers drift the first time anything writes a
 *    `kind: 'summary'` row (`server/INSIGHTS.md`, 2026-08-03).
 *  - The grouping key falls back to the ROW id when `agentId` is null.
 *    `reviews.agent_id` carries neither an FK nor `notNull`, and the SEEDED
 *    review has it as null — so keying on the raw value collapses every
 *    agent-less row into one bucket and drops all but one. On a fresh install
 *    that means the demo shows no badges at all.
 *
 * `rows` MUST already be newest-first. `reviewsForPull` orders
 * `desc(createdAt)`; this function does no sorting and cannot detect a caller
 * that passed an unsorted list. Same contract, and same reason, as
 * `modules/pulls/latest.ts`'s `groupLatestPerAgent` — which is not reused here
 * because it buckets by `prId` first (it serves a list of PRs) and importing
 * another module's internals would trip `no-cross-module-internals`.
 */
export function latestFindingsPerAgent(
  rows: readonly { review: SmartDiffReviewRow; findings: readonly SmartDiffFindingRow[] }[],
): SmartDiffFindingRow[] {
  const seen = new Set<string>();
  const out: SmartDiffFindingRow[] = [];

  for (const { review, findings } of rows) {
    if (review.kind !== REVIEW_KIND) continue;
    const key = review.agentId ?? `${ROW_KEY_PREFIX}${review.id}`;
    // Newest-first input ⇒ the first row seen for an agent is that agent's
    // latest, and every later one is superseded.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...findings);
  }

  return out;
}

/**
 * `path → finding_lines`, keyed on the normalised path.
 *
 * One entry per finding at its **start line**, not the expanded
 * `start_line..end_line` range. The range would make the number meaningless: the
 * seeded WARNING on lines 45–52 is ONE finding, and expanding it renders
 * "8 finding-lines"; a `FULL_FILE_KINDS` finding bypasses line grounding
 * altogether and would contribute hundreds. The client's two uses are a count and
 * a scroll target, and the scroll target is the start line.
 *
 * `knownPaths` is the evidence set, the same shape as `groundRiskAreas`'s: a
 * finding whose file is not among the PR's current files is DROPPED rather than
 * turned into a synthetic entry. It is expected drift, not a fault — findings were
 * grounded against the diff of the run that produced them, while `pr_files` is
 * fully replaced by `GET /pulls/:id` at whatever the head is now — and inventing
 * a file with zero additions to hang it on would show a phantom row.
 *
 * Matching is EXACT after normalisation. No prefix or suffix matching: a finding
 * on `api/users.ts` must not attach itself to `src/api/users.ts`, which is
 * exactly what a `endsWith` convenience would do.
 */
export function findingLinesByPath(
  findings: readonly SmartDiffFindingRow[],
  knownPaths: readonly string[],
): { byPath: Map<string, number[]>; unmatched: number } {
  const allowed = new Set(knownPaths.map(normalizePath));
  const lines = new Map<string, Set<number>>();
  let unmatched = 0;

  for (const finding of findings) {
    const path = normalizePath(finding.file);
    if (!allowed.has(path)) {
      unmatched += 1;
      continue;
    }
    // A whole-file finding can report line 0; there is no line 0 to scroll to,
    // and a badge that jumps nowhere is worse than one fewer badge.
    if (!Number.isInteger(finding.startLine) || finding.startLine < 1) continue;

    let set = lines.get(path);
    if (!set) lines.set(path, (set = new Set<number>()));
    set.add(finding.startLine);
  }

  const byPath = new Map<string, number[]>();
  for (const [path, set] of lines) {
    byPath.set(
      path,
      [...set].sort((a, b) => a - b).slice(0, MAX_FINDING_LINES_PER_FILE),
    );
  }
  return { byPath, unmatched };
}
