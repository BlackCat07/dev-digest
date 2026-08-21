/**
 * RepoIntelService — T1.1 facade skeleton.
 *
 * Every method returns a DEGRADED-but-valid result (see types.ts header). The
 * only methods that do real work in T1 are:
 *   - `getBlastRadius`: best-effort port of blast/service.ts logic, mapped
 *     into the `BlastResult` shape (and always tagged `degraded: true,
 *     reason: 'no_data'`, because T1 has no persistent index yet).
 *   - `getIndexState`: queries `repo_index_state` if the table exists (T2+),
 *     otherwise synthesises a degraded row so callers never throw.
 *
 * Everything else returns `[]` (array methods) or a degraded object literal
 * (object methods). T1.2 wires the astgrep adapter into
 * `getUnresolvedReferences` and (via T1.3) `getCallerSignatures`. T2 fills in
 * the rank-driven methods. T3 unlocks `getCriticalPaths` etc.
 *
 * The constructor takes ONLY a Container. No astgrep / depgraph / tokenizer
 * deps are imported here — those land later and plug into this same shell.
 */
import type { CodeSymbol, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { extractEndpoints } from '../../adapters/codeindex/extract.js';
import {
  parseImports,
  parseInvocationHeads,
  parseSymbols,
  langForFile,
} from '../../adapters/astgrep/index.js';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { RepoIntelRepository, type FullSymbolRow } from './repository.js';
import type {
  BlastCallerRow,
  BlastChangedSymbol,
  BlastReachedFile,
  BlastResult,
  FileFactsRow,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  SignatureRow,
  SymbolRow,
} from './types.js';
import {
  BFS_DEPTH,
  DEFAULT_REPO_MAP_TOKEN_BUDGET,
  INDEX_JOB_KIND,
  INDEXER_VERSION,
  MAX_CALLERS_PER_SYMBOL,
  REFRESH_JOB_KIND,
  RESYNC_JOB_KIND,
  SUPPORTED_EXT,
} from './constants.js';
import { runFullIndex, type IndexPayload } from './pipeline/full.js';
import { runIncremental } from './pipeline/incremental.js';

/**
 * GLOBALS allowlist — common JS/TS builtins + runtime that appear as bare
 * invocations and are NOT phantoms. Tune for PRECISION (false-positive cost
 * > false-negative cost). Anything we miss here can be added
 * later; everything we include here is widely-used baseline.
 *
 * Kept module-scoped (not re-built per call) so the `.has(name)` lookup stays
 * O(1) on the hot path. The list intentionally errs on the inclusive side for
 * standard globals — better to under-flag than to spam reviewers with noise.
 */
const PHANTOM_GLOBALS_ALLOWLIST: ReadonlySet<string> = new Set([
  // Console / process / runtime
  'console', 'process', 'globalThis', 'require', 'module', 'exports',
  '__dirname', '__filename',
  // Math/JSON
  'Math', 'JSON',
  // Core ctors
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Promise',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Proxy', 'Reflect',
  'BigInt',
  // Timers / microtask
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone',
  // Web/Fetch standard
  'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'AbortController', 'AbortSignal', 'Headers', 'Request', 'Response',
  'FormData', 'Blob', 'File', 'FileReader',
  // Node
  'Buffer',
  // Browser globals
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'performance', 'crypto', 'location', 'history',
  // Numeric coercion / URI
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Misc keywords-that-parse-as-identifiers
  'super', 'this', 'arguments', 'undefined', 'NaN', 'Infinity',
  // Test/runtime affordances (vitest/jest globals; harmless to allow)
  'describe', 'it', 'test', 'expect', 'beforeAll', 'beforeEach',
  'afterAll', 'afterEach', 'vi', 'jest',
]);

export class RepoIntelService implements RepoIntel {
  private readonly repo: RepoIntelRepository;

  constructor(private container: Container) {
    this.repo = new RepoIntelRepository(container.db);
  }

  // -------------------------------------------------------------------------
  // Indexing — T2.2 worker. The job handlers (registered via
  // registerIndexJobHandlers below) are the ASYNC entry; these methods are
  // SYNC-from-the-handler (they ARE the handler body). HTTP/Repo callers go
  // through `container.jobs.enqueue(INDEX_JOB_KIND, ...)` so the clone job
  // closes promptly and the index runs in the background.
  // -------------------------------------------------------------------------

  /**
   * Run a full index of the repo INLINE (no enqueue). The job handler for
   * INDEX_JOB_KIND delegates to this, and tests / explicit calls can also
   * use it. The CI runner needs the synchronous variant — long-running CI
   * jobs already have their own time budget and don't want a second queue.
   */
  async indexRepo(repoId: string): Promise<IndexResult> {
    return runFullIndex(this.container, this.repo, { repoId });
  }

  /**
   * Run an incremental refresh INLINE. Same enqueue/inline split as indexRepo.
   * If the persisted state is missing or its `indexerVersion` is stale, this
   * delegates to `runFullIndex` internally.
   */
  async refreshIndex(repoId: string): Promise<IndexResult> {
    return runIncremental(this.container, this.repo, { repoId });
  }

  /**
   * Manual "re-analyze": advance the clone to `origin/<defaultBranch>` (so the
   * index reflects the latest code), then run an incremental refresh. The
   * incremental pass falls back to a full reindex internally when the diff base
   * is unreachable or the indexer version moved, so this is always
   * correct — never a destructive re-clone. Degrades (never throws) when the
   * repo isn't cloned yet or the fetch fails.
   */
  async resyncRepo(repoId: string): Promise<IndexResult> {
    const startedAt = Date.now();
    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) {
      return { status: 'degraded', filesIndexed: 0, filesSkipped: 0, durationMs: Date.now() - startedAt, reason: 'no_clone' };
    }
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    try {
      await this.container.git.sync(ref, repo.defaultBranch);
    } catch (err) {
      return {
        status: 'degraded',
        filesIndexed: 0,
        filesSkipped: 0,
        durationMs: Date.now() - startedAt,
        reason: `sync_failed:${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return runIncremental(this.container, this.repo, { repoId });
  }

  /**
   * Register the INDEX_JOB_KIND + REFRESH_JOB_KIND handlers on the JobRunner.
   * Mirrors `RepoService.registerCloneJobHandler` so the registration is an
   * explicit one-shot at app startup (`repoIntel/routes.ts` invokes this).
   *
   * The handlers swallow the IndexResult on purpose — JobRunner expects
   * `Promise<void>`. Status/progress is observable via `repo_index_state`.
   */
  registerIndexJobHandlers(): void {
    this.container.jobs.register(INDEX_JOB_KIND, async (payload) => {
      await this.indexRepo((payload as IndexPayload).repoId);
    });
    this.container.jobs.register(REFRESH_JOB_KIND, async (payload) => {
      await this.refreshIndex((payload as IndexPayload).repoId);
    });
    this.container.jobs.register(RESYNC_JOB_KIND, async (payload) => {
      await this.resyncRepo((payload as IndexPayload).repoId);
    });
  }

  /**
   * ALWAYS works. If `repo_index_state` exists and has a row, returns it.
   * Otherwise synthesises a degraded row so callers can branch on `degraded`
   * without ever hitting a thrown error.
   */
  async getIndexState(repoId: string): Promise<IndexState> {
    const persisted = await this.repo.tryGetIndexState(repoId);
    if (persisted) return persisted;
    return {
      repoId,
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      reason: 'no_data',
      lastIndexedSha: '',
      indexerVersion: INDEXER_VERSION,
      updatedAt: new Date(0),
      degraded: true,
      degradedReason: 'no_data',
    };
  }

  // -------------------------------------------------------------------------
  // Reads.
  // -------------------------------------------------------------------------

  /**
   * Best-effort blast over `container.codeIndex` — a faithful port of
   * blast/service.ts mapped into the facade's `BlastResult` shape, then
   * tagged `degraded: true` so consumers can branch.
   *
   * Why "always degraded" in T1: there's no persistent rank/decl_file yet, so
   * every caller gets `rank: 0` and HTTP impact is detected by re-reading the
   * clone (not the index). T2 promotes this path to the persistent layer.
   */
  async getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult> {
    // T3: serve from the persistent index when it's built. Falls through to the
    // ripgrep best-effort below when the flag is off / index is absent.
    if (this.container.config.repoIntelEnabled && changedFiles.length > 0) {
      const persistent = await this.tryPersistentBlast(repoId, changedFiles);
      if (persistent) return persistent;
    }

    const empty: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };

    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath || changedFiles.length === 0) return empty;

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const changedSet = new Set(changedFiles);

    let allSymbols: CodeSymbol[];
    try {
      allSymbols = await this.container.codeIndex.symbols(ref);
    } catch {
      return empty;
    }

    // changed symbols = declared in any changed file (dedup by name+file).
    const changedSymbols: BlastChangedSymbol[] = [];
    const seen = new Set<string>();
    for (const s of allSymbols) {
      if (!changedSet.has(s.path)) continue;
      const key = `${s.name}:${s.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changedSymbols.push({ file: s.path, name: s.name, kind: s.kind });
    }

    const callerRows: BlastCallerRow[] = [];
    const endpoints = new Set<string>();
    const callerSeen = new Set<string>();

    for (const sym of changedSymbols) {
      let refs;
      try {
        refs = await this.container.codeIndex.references(ref, sym.name);
      } catch {
        continue;
      }
      const callerFiles = new Set<string>();
      for (const r of refs) {
        if (r.fromPath === sym.file) continue; // skip the decl's own file
        const callerName = enclosingSymbolName(allSymbols, r.fromPath, r.line);
        const key = `${r.fromPath}|${callerName}|${sym.name}`;
        if (callerSeen.has(key)) continue;
        callerSeen.add(key);
        callerRows.push({
          file: r.fromPath,
          symbol: callerName,
          viaSymbol: sym.name,
          viaFile: sym.file,
          line: r.line,
          rank: 0, // ripgrep/degraded path has no persistent rank
        });
        callerFiles.add(r.fromPath);
      }

      // Detect HTTP routes reachable from any caller file (best-effort, just
      // like the legacy blast service).
      for (const file of callerFiles) {
        const content = await readClone(repo.clonePath, file);
        if (!content) continue;
        for (const e of extractEndpoints(content)) endpoints.add(e);
      }
    }

    // Same total order and same per-symbol cap as the persistent path. The rank is
    // uniformly 0 here, so without the tiebreakers this list would be in raw scan
    // order — see `compareCallers`.
    callerRows.sort(compareCallers);
    const fallbackCounts: Array<{ symbol: string; file: string; total: number }> = [];
    const fallbackCapped: BlastCallerRow[] = [];
    const fallbackGroups = new Map<string, BlastCallerRow[]>();
    for (const c of callerRows) {
      const key = symbolKey(c.viaSymbol, c.viaFile);
      const arr = fallbackGroups.get(key);
      if (arr) arr.push(c);
      else fallbackGroups.set(key, [c]);
    }
    for (const rows of fallbackGroups.values()) {
      const head = rows[0];
      if (head === undefined) continue;
      fallbackCounts.push({ symbol: head.viaSymbol, file: head.viaFile, total: rows.length });
      fallbackCapped.push(...rows.slice(0, MAX_CALLERS_PER_SYMBOL));
    }

    return {
      changedSymbols,
      callers: fallbackCapped,
      impactedEndpoints: [...endpoints].sort(),
      callerCounts: fallbackCounts,
      degraded: true,
      reason: 'no_data',
    };
  }

  /**
   * Persistent-index blast (T3): reads symbols / resolved references / file_rank
   * / file_facts straight from Postgres — NO clone parsing on the hot path.
   * Returns `null` when the index isn't usable (caller falls back to ripgrep).
   *
   * Callers are PRECISE: only references whose `decl_file` resolved to a changed
   * file count. That favours precision over recall — an ambiguous
   * (NULL decl_file) reference is not asserted as a caller.
   */
  private async tryPersistentBlast(
    repoId: string,
    changedFiles: string[],
  ): Promise<BlastResult | null> {
    const state = await this.repo.tryGetIndexState(repoId);
    if (!state || (state.status !== 'full' && state.status !== 'partial')) return null;

    // Changed symbols = declared in a changed file. Skip the qualified
    // `Class.method` dual-emit (the bare form already covers the name).
    const declRows = await this.repo.getSymbolRows(repoId, changedFiles);
    const changedSymbols: BlastChangedSymbol[] = [];
    const nameSet = new Set<string>();
    const seenSym = new Set<string>();
    for (const s of declRows) {
      if (s.name.includes('.')) continue;
      const key = `${s.name}:${s.path}`;
      if (!seenSym.has(key)) {
        seenSym.add(key);
        changedSymbols.push({ file: s.path, name: s.name, kind: s.kind });
      }
      nameSet.add(s.name);
    }
    if (nameSet.size === 0) {
      // No symbol was DECLARED in the changed files — a docs-only or config-only PR,
      // or files the indexer does not cover. There is still a graph answer to give:
      // something may import those files even though they export no symbol this
      // index knows, so the reverse walk runs here too rather than being skipped.
      //
      // `indexStatus` and `indexedSha` must travel with this return. Leaving them off
      // made a fully-indexed repository answer `partial / index_missing` — measured
      // on a real PR — because the consumer cannot distinguish "the facade told me
      // nothing about coverage" from "coverage is incomplete", and correctly refuses
      // to claim completeness it was not given.
      const reachedFiles = await this.reverseImpact(repoId, changedFiles);
      const changedFileFacts = await this.ownFacts(repoId, changedFiles);
      const endpoints = new Set<string>();
      for (const r of reachedFiles) for (const e of r.endpoints) endpoints.add(e);
      for (const f of changedFileFacts) for (const e of f.endpoints) endpoints.add(e);
      return {
        changedSymbols,
        callers: [],
        impactedEndpoints: [...endpoints].sort(),
        reachedFiles,
        changedFileFacts,
        callerCounts: [],
        indexStatus: state.status,
        indexedSha: state.lastIndexedSha,
        degraded: false,
      };
    }

    // Resolved cross-file callers.
    const callerRows = await this.repo.getResolvedCallers(repoId, changedFiles, [...nameSet]);
    const callerFiles = [...new Set(callerRows.map((c) => c.fromPath))];

    // Enclosing caller symbol from the callers' persistent symbol rows.
    const callerSymRows = await this.repo.getSymbolRows(repoId, callerFiles);
    const symsByFile = new Map<string, FullSymbolRow[]>();
    for (const s of callerSymRows) {
      const arr = symsByFile.get(s.path);
      if (arr) arr.push(s);
      else symsByFile.set(s.path, [s]);
    }

    const callers: BlastCallerRow[] = [];
    const seenCaller = new Set<string>();
    for (const c of callerRows) {
      const enclosing =
        enclosingFromRows(symsByFile.get(c.fromPath) ?? [], c.line) ??
        c.fromPath.split('/').pop() ??
        c.fromPath;
      // The dedup key carries the DECL FILE too: the same caller legitimately
      // appears once per changed symbol it reaches, and two changed files may
      // declare the same name.
      const viaFile = c.declFile ?? '';
      const key = `${c.fromPath}|${enclosing}|${c.toSymbol}|${viaFile}`;
      if (seenCaller.has(key)) continue;
      seenCaller.add(key);
      callers.push({
        file: c.fromPath,
        symbol: enclosing,
        viaSymbol: c.toSymbol,
        viaFile,
        line: c.line,
        rank: c.rank,
      });
    }
    callers.sort(compareCallers);

    // Cap PER SYMBOL, not across the whole list.
    //
    // `MAX_CALLERS_PER_SYMBOL` says per symbol and a single `slice` on the merged
    // list does not implement that: one popular helper with 40 callers would
    // consume the entire budget and every other changed symbol in the same PR
    // would render as "no callers" — a false negative that reads exactly like a
    // true one. Grouping first also means the count is honest, because
    // `callerCountBySymbol` is taken BEFORE the cap.
    const grouped = new Map<string, BlastCallerRow[]>();
    for (const c of callers) {
      const key = symbolKey(c.viaSymbol, c.viaFile);
      const arr = grouped.get(key);
      if (arr) arr.push(c);
      else grouped.set(key, [c]);
    }
    const callerCounts: Array<{ symbol: string; file: string; total: number }> = [];
    const capped: BlastCallerRow[] = [];
    for (const rows of grouped.values()) {
      const head = rows[0];
      if (head === undefined) continue;
      callerCounts.push({ symbol: head.viaSymbol, file: head.viaFile, total: rows.length });
      capped.push(...rows.slice(0, MAX_CALLERS_PER_SYMBOL));
    }

    // Precomputed facts per caller file (endpoints + crons), so consumers can
    // attribute them to the changed symbol whose callers live in that file.
    const facts = await this.repo.getFileFacts(repoId, callerFiles);
    const endpoints = new Set<string>();
    const factsByFile: Record<string, { endpoints: string[]; crons: string[] }> = {};
    for (const f of facts) {
      factsByFile[f.filePath] = { endpoints: f.endpoints, crons: f.crons };
      for (const e of f.endpoints) endpoints.add(e);
    }

    // The graph half: walk import edges BACKWARDS from the changed files and take
    // the facts of everything reached. Symbol callers alone under-report, because
    // a router can mount a changed module without naming a single one of its
    // symbols.
    const reachedFiles = await this.reverseImpact(repoId, changedFiles);
    for (const r of reachedFiles) for (const e of r.endpoints) endpoints.add(e);

    // The changed files' OWN routes — the most direct impact there is, and the one
    // the walk above cannot see because it excludes them by design.
    const changedFileFacts = await this.ownFacts(repoId, changedFiles);
    for (const f of changedFileFacts) for (const e of f.endpoints) endpoints.add(e);

    return {
      changedSymbols,
      callers: capped,
      impactedEndpoints: [...endpoints].sort(),
      factsByFile,
      reachedFiles,
      changedFileFacts,
      callerCounts,
      indexStatus: state.status,
      indexedSha: state.lastIndexedSha,
      degraded: false,
    };
  }

  /**
   * The endpoints and crons the changed files declare themselves.
   *
   * A plain `file_facts` read, kept as its own method so the two callers cannot
   * disagree about it. Only files that actually have facts come back.
   */
  private async ownFacts(
    repoId: string,
    changedFiles: string[],
  ): Promise<Array<{ file: string; endpoints: string[]; crons: string[] }>> {
    const facts = await this.repo.getFileFacts(repoId, changedFiles);
    return facts
      .filter((f) => f.endpoints.length > 0 || f.crons.length > 0)
      .map((f) => ({ file: f.filePath, endpoints: f.endpoints, crons: f.crons }))
      .sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * Files that (transitively) import any changed file, up to `BFS_DEPTH` hops,
   * with the endpoints/crons the index recorded for each.
   *
   * Direction: `getImporters` filters on `to_file` and selects `from_file`, so each
   * hop answers "who imports this" — never "what does this import". Getting that
   * backwards is the one mistake that makes the whole feature confidently wrong, and
   * it would still return a plausible-looking list, which is why it is asserted
   * directly in the tests.
   *
   * Breadth-first and bounded twice over: `BFS_DEPTH` hops, and a `seen` set so a
   * cyclic import graph terminates. Pure reads — one indexed query per hop, no
   * clone access and no parsing.
   */
  private async reverseImpact(
    repoId: string,
    changedFiles: string[],
  ): Promise<BlastReachedFile[]> {
    const out: BlastReachedFile[] = [];
    // Changed files are their own origin and must never be reported as their own
    // downstream, so they seed `seen` as well as the frontier.
    const seen = new Set(changedFiles);
    // Nearest origin per reached file: BFS order guarantees the first arrival is
    // the shallowest, so this is written once and never overwritten.
    let frontier = changedFiles.map((f) => ({ file: f, origin: f }));

    for (let depth = 1; depth <= BFS_DEPTH; depth += 1) {
      if (frontier.length === 0) break;
      const edges = await this.repo.getImporters(
        repoId,
        frontier.map((f) => f.file),
      );
      const originOf = new Map(frontier.map((f) => [f.file, f.origin]));
      const next: Array<{ file: string; origin: string }> = [];
      for (const e of edges) {
        if (seen.has(e.fromFile)) continue;
        seen.add(e.fromFile);
        const origin = originOf.get(e.toFile) ?? e.toFile;
        next.push({ file: e.fromFile, origin });
        out.push({ file: e.fromFile, depth, viaFile: origin, endpoints: [], crons: [] });
      }
      frontier = next;
    }

    if (out.length === 0) return out;
    const facts = await this.repo.getFileFacts(
      repoId,
      out.map((r) => r.file),
    );
    const byPath = new Map(facts.map((f) => [f.filePath, f]));
    for (const r of out) {
      const f = byPath.get(r.file);
      if (!f) continue;
      r.endpoints = f.endpoints;
      r.crons = f.crons;
    }
    // Shallowest first, then a total order so the list is stable across reads.
    out.sort(
      (a, b) => a.depth - b.depth || a.file.localeCompare(b.file) || a.viaFile.localeCompare(b.viaFile),
    );
    return out;
  }

  /**
   * Serve the cached repo-map for the repo's last-indexed SHA. The map is only
   * rendered by the pipeline at `DEFAULT_REPO_MAP_TOKEN_BUDGET`; other budgets
   * (or an unindexed / partial-without-rank repo) miss and degrade cleanly.
   */
  async getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult> {
    const degraded: RepoMapResult = {
      text: '',
      tokens: 0,
      cached: false,
      degraded: true,
      reason: 'no_data',
    };
    if (!this.container.config.repoIntelEnabled) {
      return { ...degraded, reason: 'flag_off' };
    }
    const state = await this.repo.tryGetIndexState(repoId);
    if (!state || !state.lastIndexedSha) return degraded;
    const budget = tokenBudget ?? DEFAULT_REPO_MAP_TOKEN_BUDGET;
    const hit = await this.repo.getRepoMapCache(repoId, state.lastIndexedSha, budget);
    if (!hit) return degraded;
    return { text: hit.mapText, tokens: hit.tokenCount, cached: true };
  }

  /** Percentile per path from `file_rank` (smart-diff / run-executor "top-N%"). */
  async getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (paths.length === 0) return [];
    return this.repo.getFileRankFor(repoId, paths);
  }

  /**
   * Precomputed endpoint/cron facts per file, for onboarding's architecture
   * section.
   *
   * A thin delegate on purpose. It is here rather than in the consuming module
   * because `modules/onboarding` may not import `repo-intel/repository.ts` —
   * `no-cross-module-internals`, and `import type` does not exempt it
   * (`server/INSIGHTS.md`, 2026-08-14, measured 22 -> 24 warnings). Same two
   * guards as `getFileRank`: `[]` when the layer is off and `[]` for an empty
   * request. That empty array is the facade's documented degraded contract
   * (types.ts header) — the status stays observable through `getIndexState`.
   */
  async getFileFacts(repoId: string, paths: string[]): Promise<FileFactsRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (paths.length === 0) return [];
    return this.repo.getFileFacts(repoId, paths);
  }

  /** Persistent symbol read-model (T2 columns) for the given files. */
  async getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (paths.length === 0) return [];
    const rows = await this.repo.getSymbolRows(repoId, paths);
    return rows.map((r) => ({
      file: r.path,
      name: r.name,
      kind: r.kind,
      exported: r.exported,
      startLine: r.line ?? 0,
      endLine: r.endLine ?? r.line ?? 0,
      signature: r.signature,
    }));
  }

  /**
   * T1.3 — diff-scoped, best-effort callers-in-prompt fuel.
   *
   * For each symbol declared in a changed file (astgrep parseSymbols), find
   * cross-file callers via the EXISTING ripgrep-backed `container.codeIndex.
   * references()` (the same path blast already trusts), then label each caller
   * with its enclosing symbol + signature (astgrep parseSymbols of the caller
   * file). rank=0 until T3 wires file_rank.
   *
   * Skips type/interface symbols (no call sites). Returns at most `limit` rows,
   * deduped by (file, symbol, viaSymbol). Degraded gate: flag off, missing
   * clone, or empty input → `[]`.
   */
  async getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit: number = MAX_CALLERS_PER_SYMBOL,
  ): Promise<SignatureRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (changedFiles.length === 0) return [];

    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return [];

    // 1. Symbols declared in changed files. Filter to symbols that can BE
    //    called (function / method / class). Type/interface aliases have no
    //    call sites, so chasing references for them just wastes work.
    const declaredSymbols = new Map<string, { file: string; kind: string }>();
    for (const file of changedFiles) {
      if (!langForFile(file)) continue;
      const source = await readClone(repo.clonePath, file);
      if (source == null) continue;
      try {
        for (const s of parseSymbols(file, source)) {
          if (s.kind !== 'function' && s.kind !== 'method' && s.kind !== 'class') continue;
          // Dual-emit (Class.method + method): only store the bare name; the
          // qualified form would double-count callers.
          if (s.name.includes('.')) continue;
          if (!declaredSymbols.has(s.name)) {
            declaredSymbols.set(s.name, { file, kind: s.kind });
          }
        }
      } catch {
        // skip unparseable files — diff-scoped, never throw
      }
    }
    if (declaredSymbols.size === 0) return [];

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const out: SignatureRow[] = [];
    const seen = new Set<string>();
    // Cache caller-file astgrep parses so we don't re-parse the same file per
    // referenced symbol.
    const callerSymbolsByFile = new Map<string, ReturnType<typeof parseSymbols>>();

    for (const [symbolName, decl] of declaredSymbols) {
      if (out.length >= limit) break;
      let refs;
      try {
        refs = await this.container.codeIndex.references(ref, symbolName);
      } catch {
        continue;
      }
      for (const r of refs) {
        if (out.length >= limit) break;
        if (r.fromPath === decl.file) continue; // skip self-references

        // Parse the caller file once; reuse for further symbols in this loop.
        let callerSyms = callerSymbolsByFile.get(r.fromPath);
        if (callerSyms === undefined) {
          if (!langForFile(r.fromPath)) {
            callerSymbolsByFile.set(r.fromPath, []);
            callerSyms = [];
          } else {
            const callerSrc = await readClone(repo.clonePath, r.fromPath);
            if (callerSrc == null) {
              callerSymbolsByFile.set(r.fromPath, []);
              callerSyms = [];
            } else {
              try {
                callerSyms = parseSymbols(r.fromPath, callerSrc);
              } catch {
                callerSyms = [];
              }
              callerSymbolsByFile.set(r.fromPath, callerSyms);
            }
          }
        }

        // Pick the enclosing top-level symbol (largest line ≤ ref.line, no
        // qualified names — match blast/helpers.ts callerName behavior).
        const enclosing = (callerSyms ?? [])
          .filter((s) => s.line <= r.line && !s.name.includes('.'))
          .sort((a, b) => b.line - a.line)[0];
        if (!enclosing) continue; // no enclosing symbol → no signature to emit
        const signature = enclosing.signature;
        if (!signature) continue;

        const dedupKey = `${r.fromPath}|${enclosing.name}|${symbolName}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        out.push({
          file: r.fromPath,
          symbol: enclosing.name,
          signature,
          rank: 0, // enriched from file_rank below (T3)
        });
      }
    }

    // T3: enrich each caller with its file's rank percentile so the prompt can
    // lead with the most important callers. No-op when no index exists yet.
    if (out.length > 0) {
      const files = [...new Set(out.map((o) => o.file))];
      const ranks = await this.repo.getFileRankFor(repoId, files);
      if (ranks.length > 0) {
        const byFile = new Map(ranks.map((r) => [r.path, r.percentile]));
        for (const o of out) o.rank = byFile.get(o.file) ?? 0;
        out.sort((a, b) => b.rank - a.rank);
      }
    }

    return out;
  }

  /**
   * T1.3 — diff-scoped phantom-API gate fuel.
   *
   * For each changed file: collect bare invocation heads (astgrep
   * parseInvocationHeads). A head is PHANTOM iff it is NOT declared in this
   * file, NOT imported in this file, NOT a JS/TS keyword, and NOT a known
   * runtime/builtin global. `declFile` is intentionally `null` in T1 — Tier 1
   * is ephemeral (no persistent decl_file column; that lands in T2).
   *
   * Degraded gate: flag off, missing clone, or no parseable files → `[]`.
   * NEVER throws — per-file parse errors are swallowed.
   */
  async getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (files.length === 0) return [];

    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return [];

    const out: RefRow[] = [];

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!(SUPPORTED_EXT as readonly string[]).includes(ext)) continue;

      const source = await readClone(repo.clonePath, file);
      if (source == null) continue;

      let declared: ReturnType<typeof parseSymbols>;
      let imports: ReturnType<typeof parseImports>;
      let heads: ReturnType<typeof parseInvocationHeads>;
      try {
        declared = parseSymbols(file, source);
        imports = parseImports(file, source);
        heads = parseInvocationHeads(file, source);
      } catch {
        // Tree-sitter is lenient but a napi-level failure shouldn't blow up
        // the whole gate. Skip the file (= "no phantoms here" — conservative).
        continue;
      }

      // Build the "declared-or-imported" name set. parseSymbols already emits
      // both qualified (`Class.method`) and bare (`method`) forms, so a method
      // declared anywhere in the file is resolvable as the bare invocation.
      const knownNames = new Set<string>();
      for (const s of declared) knownNames.add(s.name);
      for (const i of imports) knownNames.add(i.name);

      for (const head of heads) {
        if (knownNames.has(head.name)) continue;
        if (PHANTOM_GLOBALS_ALLOWLIST.has(head.name)) continue;
        out.push({
          refFile: file,
          refLine: head.line,
          symbolName: head.name,
          declFile: null, // T1: ephemeral
        });
      }
    }

    return out;
  }

  /** Top-N files by rank, minus tests/configs/migrations — conventions sample. */
  async getConventionSamples(repoId: string, n: number): Promise<string[]> {
    return this.getTopFilesByRank(repoId, n);
  }

  /**
   * Top-N file paths by rank DESC, dropping tests/configs/migrations and any
   * caller-supplied `exclude` substrings. Over-fetches by 10× before filtering
   * so the post-filter still yields N where possible.
   */
  async getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (n <= 0) return [];
    const exclude = opts?.exclude ?? [];
    const rows = await this.repo.getRankedPaths(repoId, Math.max(n * 10, 100));
    const out: string[] = [];
    for (const r of rows) {
      if (isJunkPath(r.path)) continue;
      if (exclude.some((e) => r.path.includes(e))) continue;
      out.push(r.path);
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * Dependency chains from the highest-ranked files (onboarding reading-path).
   * For each of the top roots, greedily follow the highest-ranked import target
   * up to BFS_DEPTH hops. Pure read over `file_edges` + `file_rank`.
   */
  async getCriticalPaths(repoId: string): Promise<string[][]> {
    if (!this.container.config.repoIntelEnabled) return [];
    const edges = await this.repo.getEdges(repoId);
    if (edges.length === 0) return [];

    const ranked = await this.repo.getRankedPaths(repoId, 100_000);
    const rankOf = new Map(ranked.map((r) => [r.path, r.rank]));

    // Adjacency importer → imported.
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const arr = adj.get(e.fromFile);
      if (arr) arr.push(e.toFile);
      else adj.set(e.fromFile, [e.toFile]);
    }

    const roots = ranked.slice(0, CRITICAL_PATH_ROOTS).map((r) => r.path);
    const paths: string[][] = [];
    const seenPaths = new Set<string>();
    for (const root of roots) {
      const chain = [root];
      const inChain = new Set(chain);
      let cur = root;
      for (let depth = 0; depth < BFS_DEPTH; depth += 1) {
        const next = (adj.get(cur) ?? [])
          .filter((t) => !inChain.has(t))
          .sort((a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0))[0];
        if (!next) break;
        chain.push(next);
        inChain.add(next);
        cur = next;
      }
      if (chain.length < 2) continue;
      const key = chain.join('>');
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      paths.push(chain);
    }
    return paths;
  }
}

/** How many top-ranked files seed `getCriticalPaths` dependency chains. */
const CRITICAL_PATH_ROOTS = 5;

/**
 * Path kinds excluded from rank-driven file samples (conventions/onboarding):
 * tests, configs, declaration files, migrations, generated dirs. Substring
 * match on the repo-relative path (kept deliberately simple + deterministic).
 */
const JUNK_PATH_PATTERNS = [
  '.test.',
  '.spec.',
  '.d.ts',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/migrations/',
  '/__fixtures__/',
  '.config.',
  'vitest.',
  'jest.',
  'eslint',
  'prettier',
] as const;

function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATH_PATTERNS.some((p) => lower.includes(p));
}

/**
 * A changed symbol's identity: its NAME and the file it is declared in.
 *
 * One PR can change `createTask` in both `repo.ts` and `service.ts`; keying caller
 * groups on the name alone gave both rows the same callers and counted every caller
 * twice (measured on a real PR: 10 reported as 20). `\u0000` cannot occur in a path
 * or an identifier, so the two halves cannot run together.
 *
 * PRIVATE on purpose. The format is this module's business — what crosses the
 * boundary is `callerCounts`, a list of explicit `{symbol, file}` pairs, so no
 * consumer has to reproduce this string.
 */
function symbolKey(name: string, file: string): string {
  return `${name}\u0000${file}`;
}

/**
 * TOTAL order over blast callers: importance first, then a deterministic tail.
 *
 * `rank DESC` alone is not enough, and the failure is the one
 * `server/INSIGHTS.md` (2026-08-06) records for `listCandidates`: ranks tie
 * constantly here — every file the indexer never ranked shares `0`, and the whole
 * ripgrep fallback path is `rank: 0` by construction — so tied rows come back in
 * whatever order the scan happened to read them. Two consequences specific to this
 * list, both worse than a wobbling UI: the per-symbol cap TRUNCATES, so ties decide
 * which callers a reviewer is shown at all, and the same request can answer
 * differently twice with no write in between.
 *
 * `file` then `line` then `viaSymbol` is provably total for these rows: the dedup
 * key upstream is `file|symbol|viaSymbol`, so no two survivors can agree on all
 * three of these plus rank.
 */
function compareCallers(a: BlastCallerRow, b: BlastCallerRow): number {
  return (
    b.rank - a.rank ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.viaSymbol.localeCompare(b.viaSymbol) ||
    a.viaFile.localeCompare(b.viaFile)
  );
}

/** Enclosing top-level (bare-name) symbol for a line, from persistent rows. */
function enclosingFromRows(rows: FullSymbolRow[], line: number): string | null {
  const hit = rows
    .filter((s) => !s.name.includes('.') && (s.line ?? 0) <= line)
    .sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0];
  return hit?.name ?? null;
}

// ---------------------------------------------------------------------------
// helpers — local to T1, replaced when blast/onboarding migrate to the facade.
// ---------------------------------------------------------------------------

/**
 * Best-effort: name the enclosing top-level symbol of a reference line. Mirrors
 * blast/helpers.ts callerName so we get the same caller labels.
 */
function enclosingSymbolName(
  allSymbols: CodeSymbol[],
  fromPath: string,
  line: number,
): string {
  const inFile = allSymbols
    .filter((s) => s.path === fromPath && s.line <= line && !s.name.includes('.'))
    .sort((a, b) => b.line - a.line);
  return inFile[0]?.name ?? fromPath.split('/').pop() ?? fromPath;
}

async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}
