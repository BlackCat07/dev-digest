/**
 * Ports and row shapes for the Prior PRs module (L04).
 *
 * Types only — no runtime code — so nothing here can join an import cycle, and the
 * module's whole dependency surface is one file. Same shape and same reasoning as
 * `modules/blast/types.ts`, including the part that matters most: this module owns
 * NO repository. `pull_requests` and `pr_files` belong to the review domain's data
 * layer and are reached through `container.reviewRepo`, which satisfies the port
 * below STRUCTURALLY — so nothing here imports `src/db/`, and nothing imports a
 * sibling module (a types-only import of one is still a real
 * `no-cross-module-internals` violation; `server/INSIGHTS.md`, 2026-08-14).
 *
 * One port, and the absences are the point: no LLM, no GitHub, no git, no job
 * queue and no index reader. This feature is a single history query, so "it calls
 * no model and analyses no code" is a property of the types rather than a promise
 * in a comment.
 */

/** The pull request row, narrowed to what this feature reads. */
export interface PriorPrsPullRow {
  id: string;
  /** The repository whose history is searched — prior work is a per-repo question. */
  repoId: string;
}

/** One changed file, as much of `pr_files` as this module reads. */
export interface PriorPrsFile {
  path: string;
}

/** One (earlier pull request, shared path) pair, before grouping. */
export interface PriorPrsOverlapRow {
  id: string;
  number: number;
  title: string;
  author: string;
  updatedAt: Date | null;
  openedAt: Date | null;
  path: string;
}

/**
 * The persistence this module reads, stated as a port.
 *
 * `countPullCoverage` is not an optimisation and cannot be dropped: without it the
 * service can produce an empty list but cannot say whether that means "nothing else
 * touched these files" or "no other pull request has an imported file list", and
 * those two render identically while meaning opposite things.
 */
export interface PriorPrsStore {
  getPull(workspaceId: string, prId: string): Promise<PriorPrsPullRow | undefined>;
  getPrFiles(prId: string): Promise<readonly PriorPrsFile[]>;
  listPriorPrOverlaps(
    repoId: string,
    prId: string,
    paths: readonly string[],
  ): Promise<readonly PriorPrsOverlapRow[]>;
  countPullCoverage(repoId: string): Promise<{ total: number; withFileLists: number }>;
}

/**
 * Everything this module needs from the outside world.
 *
 * A structural interface rather than `Container`, for the reason `BlastDeps` and
 * `IntentDeps` both give: `platform/container.ts` names this module, so naming
 * `Container` here would close a `no-circular` cycle. The composition root still
 * passes itself straight in.
 */
export interface PriorPrsDeps {
  readonly reviewRepo: PriorPrsStore;
}
