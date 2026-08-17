/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /**
   * The file that changed symbol is declared in — the other half of its identity.
   *
   * A name alone does not identify a changed symbol: one PR can change
   * `createTask` in both `repo.ts` and `service.ts`, and attributing by name gives
   * BOTH rows the same callers and counts every caller twice. Measured on a real PR:
   * 10 distinct callers reported as 20.
   */
  viaFile: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

/**
 * One file reached by walking the import graph BACKWARDS from a changed file,
 * with the facts the index recorded about it.
 *
 * `depth` is the number of reverse-import hops (1 = imports a changed file
 * directly), bounded by `BFS_DEPTH`. It is kept because a direct importer is much
 * stronger evidence of impact than a second-hop one, and collapsing the two would
 * throw that away.
 */
export interface BlastReachedFile {
  file: string;
  depth: number;
  /** The changed file this one was reached from (nearest, by depth). */
  viaFile: string;
  endpoints: string[];
  crons: string[];
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /**
   * Files reachable by REVERSE import edges from the changed files, up to
   * `BFS_DEPTH` hops, each with its endpoints/crons. This is the graph-direction
   * half of the feature and is strictly wider than `factsByFile`, which only ever
   * covers files holding a resolved *symbol* caller: a module can re-export or
   * mount a changed file without naming any of its symbols, and that still puts
   * its routes in the blast radius.
   *
   * Present on the persistent path only — the ripgrep fallback has no import graph.
   */
  reachedFiles?: BlastReachedFile[];
  /**
   * Endpoints and crons declared BY the changed files themselves.
   *
   * Separate from `reachedFiles` because a changed file is not downstream of itself
   * and must never be listed as its own dependent — but its own routes are the most
   * direct impact a diff can have, and the reverse walk structurally cannot report
   * them (it excludes the changed files from the walk, correctly). Measured on a real
   * PR that edited a `routes.ts`: every endpoint that file declares was missing from
   * the map while endpoints two hops away were present.
   */
  changedFileFacts?: Array<{ file: string; endpoints: string[]; crons: string[] }>;
  /**
   * Total resolved callers per changed symbol BEFORE the per-symbol cap, so a
   * consumer can say "14 callers" while listing the top 20 of them.
   *
   * A LIST of `{symbol, file, total}` rather than a record keyed by some composite
   * string: a changed symbol is identified by its name AND its declaring file, and
   * encoding that pair into a map key would force every consumer to reproduce this
   * module's key format exactly. A consumer that got the format subtly wrong would
   * not fail — it would silently fall back to the post-cap length and under-report
   * the count. Explicit fields cannot drift that way.
   */
  callerCounts?: Array<{ symbol: string; file: string; total: number }>;
  /**
   * The index's own coverage, passed through so a consumer can tell a truthful
   * "nothing calls this" from "the index only covers part of this repository".
   * Absent on the fallback path, where nothing was read from an index at all.
   */
  indexStatus?: IndexStatus;
  /** Commit the index was built at, for pinning file:line links. */
  indexedSha?: string;
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}
