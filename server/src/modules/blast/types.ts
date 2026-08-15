/**
 * Ports and row shapes for the Blast Radius module (L04).
 *
 * Types only — no runtime code — so nothing here can participate in an import
 * cycle and the whole module's dependency surface is readable in one file.
 * Follows `modules/smart-diff/types.ts`, which states the same rationale.
 *
 * Nothing here imports `modules/repo-intel/` either, and that is the second half of
 * the same rule: importing a sibling module's `types.ts` is a real
 * `no-cross-module-internals` violation (measured — it added two warnings to the
 * `depcruise` gate before this file was made self-contained). So the shape of the
 * index read is DECLARED here, by the consumer, and `RepoIntelService`'s
 * `BlastResult` satisfies it structurally with no `implements` clause — the pattern
 * `server/INSIGHTS.md` (2026-08-10) records for `RepoDocReader`. `test/blast-service.test.ts`
 * imports the real `BlastResult` and passes it in, which is what proves the two
 * shapes still line up.
 */

/** One changed file, as much of `pr_files` as this module reads. */
export interface BlastPrFile {
  path: string;
}

/**
 * The pull request row, narrowed to the three fields the map needs.
 *
 * `repoId` is what the whole feature hangs off — the index is per repository, not
 * per pull request — and resolving it through the workspace-scoped `getPull` is
 * what keeps the subsequent index reads tenant-safe even though `symbols`,
 * `references` and `file_edges` carry no `workspace_id` of their own.
 */
export interface BlastPullRow {
  id: string;
  repoId: string;
  headSha: string;
}

/**
 * The persistence this module reads, stated as a port.
 *
 * Implemented by `ReviewRepository` structurally: this module names no Drizzle row
 * type, imports nothing from `src/db/` and owns NO repository of its own.
 * `pr_files` belongs to the review domain's data layer, and two repositories over
 * one table is the failure onion layering exists to prevent — the same reasoning
 * `SmartDiffStore` records.
 */
export interface BlastStore {
  getPull(workspaceId: string, prId: string): Promise<BlastPullRow | undefined>;
  getPrFiles(prId: string): Promise<readonly BlastPrFile[]>;
}

/** How much of the repository the index actually covers. */
export type IndexCoverage = 'full' | 'partial' | 'degraded' | 'failed';

/** Why the index could not answer fully, in the facade's own vocabulary. */
export type IndexDegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

/**
 * The index facts this module reads — the consumer's view of `BlastResult`.
 *
 * Every field is optional except the three the facade guarantees on every path
 * (including its degraded one), which is what lets the service treat a fallback
 * result and a fully-indexed one through the same code without a cast.
 */
export interface IndexBlastFacts {
  changedSymbols: ReadonlyArray<{ file: string; name: string; kind: string }>;
  callers: ReadonlyArray<{
    file: string;
    symbol: string;
    viaSymbol: string;
    /** The changed symbol's declaring file — the other half of its identity. */
    viaFile: string;
    line: number;
    rank: number;
  }>;
  impactedEndpoints: readonly string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  reachedFiles?: ReadonlyArray<{
    file: string;
    depth: number;
    viaFile: string;
    endpoints: string[];
    crons: string[];
  }>;
  changedFileFacts?: ReadonlyArray<{ file: string; endpoints: string[]; crons: string[] }>;
  /** Pre-cap totals per changed symbol, identified by name AND declaring file. */
  callerCounts?: ReadonlyArray<{ symbol: string; file: string; total: number }>;
  indexStatus?: IndexCoverage;
  indexedSha?: string;
  degraded?: boolean;
  reason?: IndexDegradedReason;
}

/**
 * The one read this module makes against the codebase index.
 *
 * Narrowed to a single method rather than taking the whole `RepoIntel` facade, for
 * the reason `server/INSIGHTS.md` (2026-08-10) gives about `resolveFeatureModel`:
 * a wide parameter drags its callers into an import cycle with the DI root. It also
 * states the feature's boundary — everything on screen comes from the index, and
 * this module has no way to compute a fact of its own.
 */
export interface BlastIndexReader {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<IndexBlastFacts>;
}

/**
 * Everything Blast Radius needs from the outside world — two ports, and the
 * absences are the point.
 *
 * There is **no LLM port here**, no GitHub, no git, no clone reader and no job
 * queue. The module is structurally incapable of making a model request, which is
 * why the route is a plain synchronous read with no job, no cache table and no
 * cost — and why "the main path calls no model" is a property of the types rather
 * than a promise in a comment. `test/blast-service.test.ts` pins it with a `Proxy`
 * that throws on any key other than these two.
 *
 * A structural interface rather than `Container` for the reason `SmartDiffDeps` and
 * `IntentDeps` both give: `platform/container.ts` names this module, so naming
 * `Container` here would close a `no-circular` cycle. The composition root still
 * passes itself straight in.
 */
export interface BlastDeps {
  readonly reviewRepo: BlastStore;
  readonly repoIntel: BlastIndexReader;
}
