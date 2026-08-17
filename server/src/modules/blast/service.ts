import type {
  BlastCounts,
  BlastDownstream,
  BlastEndpoint,
  BlastReason,
  BlastStatus,
  ChangedSymbol,
  PrBlastRadius,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type {
  BlastDeps,
  IndexBlastFacts,
  IndexDegradedReason,
} from './types.js';

/**
 * L04 — Blast Radius. Answers "what else could this diff touch?" for one PR.
 *
 * Four properties define this service, and each is a constraint rather than a
 * simplification:
 *
 *  1. **It never calls a model.** `BlastDeps` has exactly two ports — the review
 *     repository and one index read — so there is no LLM, no GitHub, no git and no
 *     job queue for a future edit to reach for by accident. Every node and every
 *     edge on screen is a row the indexer wrote; nothing here is generated text.
 *  2. **It never analyses the repository at request time.** No AST parse, no import
 *     graph build, no clone access. `repoIntel.getBlastRadius` reads `symbols`,
 *     `references`, `file_edges`, `file_rank` and `file_facts` out of Postgres —
 *     work already done at clone/fetch time (`modules/repo-intel/README.md`).
 *  3. **It never writes.** No cache table, no derived row, no freshness rule, and
 *     therefore none of the staleness problems the Intent Layer had to solve.
 *  4. **It never reports a gap as a fact.** An empty map always arrives with the
 *     `status`/`reason` that says why it is empty. This is the whole difference
 *     between a blast radius and a misleading one: "no callers found" and "nothing
 *     was analysed" render identically if the response cannot tell them apart.
 */
export class BlastService {
  constructor(private deps: BlastDeps) {}

  /**
   * The impact map for one PR.
   *
   * Throws `NotFoundError` only, and only when the PR is not in this workspace.
   * That lookup IS the authorization check, for the reason `SmartDiffService.build`
   * gives: `pr_files` carries no `workspace_id` of its own, and neither do the
   * index tables — they hang off the already-scoped `pull_requests` and `repos` —
   * so a PR id from another workspace must 404 here rather than fall through to an
   * unscoped read. It is therefore the FIRST await.
   *
   * Everything after it answers 200. A PR with no changed files, a repo with no
   * index and a symbol nobody calls are all ordinary states of a local-first tool,
   * and each has a correct answer that is not an error.
   */
  async build(workspaceId: string, prId: string): Promise<PrBlastRadius> {
    const pull = await this.deps.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.deps.reviewRepo.getPrFiles(prId);
    const changedFiles = [...new Set(files.map((f) => f.path))].sort();

    // A PR whose detail route has never been opened has no `pr_files` rows, and
    // this module does NOT fetch them from GitHub to fill the gap: `GET /pulls/:id`
    // is the only writer of that table by design, and a second writer is precisely
    // how the Intent Layer ended up classifying PRs from their title alone
    // (`server/INSIGHTS.md`, 2026-08-11). Saying so beats analysing nothing and
    // calling the result an empty impact map.
    if (changedFiles.length === 0) {
      return emptyMap(prId, changedFiles, 'degraded', 'no_changed_files', null);
    }

    const result = await this.deps.repoIntel.getBlastRadius(pull.repoId, changedFiles);
    return shape(prId, changedFiles, result);
  }
}

/**
 * The facade's degraded vocabulary → this API's.
 *
 * `no_data` is the facade's catch-all for "nothing usable was read", which from a
 * reviewer's side is specifically a missing index — the actionable form, since the
 * fix is a re-index rather than a mystery. Every other member maps across
 * unchanged; the two unions are deliberately kept separate so the facade can grow a
 * reason without silently changing what an HTTP consumer is told.
 */
function toReason(reason: IndexDegradedReason | undefined): BlastReason {
  switch (reason) {
    case 'flag_off':
      return 'flag_off';
    case 'index_failed':
      return 'index_failed';
    case 'index_partial':
      return 'index_partial';
    case 'repo_too_large':
      return 'repo_too_large';
    default:
      return 'index_missing';
  }
}

function emptyMap(
  prId: string,
  changedFiles: string[],
  status: BlastStatus,
  reason: BlastReason | null,
  indexedSha: string | null,
): PrBlastRadius {
  return {
    pr_id: prId,
    changed_files: changedFiles,
    changed_symbols: [],
    downstream: [],
    impacted: [],
    counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    status,
    reason,
    indexed_sha: indexedSha,
  };
}

/**
 * `BlastResult` (index rows) → `PrBlastRadius` (the wire shape).
 *
 * The reshaping that matters is the GROUPING: the facade returns one flat caller
 * list, and the design reads as one collapsible row per changed symbol. Callers
 * keep the facade's order within their group — importance-ranked and already capped
 * per symbol — because that order is the feature's editorial judgement about what
 * to read first.
 */
function shape(prId: string, changedFiles: string[], r: IndexBlastFacts): PrBlastRadius {
  const changedSymbols: ChangedSymbol[] = r.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  type IndexCaller = IndexBlastFacts['callers'][number];
  // A changed symbol is (name, declaring file), never the name alone: one PR can
  // change `createTask` in both `repo.ts` and `service.ts`, and grouping by name gave
  // BOTH rows the same callers and counted every caller twice. This key is local to
  // this function — the facade sends explicit `{symbol, file}` pairs precisely so
  // that no shared key format has to be kept in step across the two modules.
  const key = (symbol: string, file: string) => `${symbol}\u0000${file}`;

  const callersBySymbol = new Map<string, IndexCaller[]>();
  for (const c of r.callers) {
    const k = key(c.viaSymbol, c.viaFile);
    const arr = callersBySymbol.get(k);
    if (arr) arr.push(c);
    else callersBySymbol.set(k, [c]);
  }

  const totalBySymbol = new Map<string, number>();
  for (const entry of r.callerCounts ?? []) {
    totalBySymbol.set(key(entry.symbol, entry.file), entry.total);
  }

  const downstream: BlastDownstream[] = [];
  for (const sym of r.changedSymbols) {
    const k = key(sym.name, sym.file);
    const callers = callersBySymbol.get(k) ?? [];
    if (callers.length === 0) continue; // no downstream: it stays in changed_symbols only

    const impacted = impactedFor(sym.file, callers.map((c) => c.file), r);
    const total = totalBySymbol.get(k) ?? callers.length;
    downstream.push({
      symbol: sym.name,
      file: sym.file,
      kind: sym.kind,
      callers: callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      caller_count: total,
      truncated: total > callers.length,
      endpoints_affected: labels(impacted, 'endpoint'),
      crons_affected: labels(impacted, 'cron'),
      impacted,
    });
  }

  // Most-impacted symbol first, then a total order: the design's tree is read
  // top-down, and `changedSymbols` arrives in whatever order the symbol rows were
  // scanned. Name breaks the tie because `(name, file)` is the dedup key upstream.
  downstream.sort(
    (a, b) =>
      b.caller_count - a.caller_count ||
      b.impacted.length - a.impacted.length ||
      a.symbol.localeCompare(b.symbol) ||
      a.file.localeCompare(b.file),
  );

  const impacted = mapLevelImpact(r, downstream);

  return {
    pr_id: prId,
    changed_files: changedFiles,
    changed_symbols: changedSymbols,
    downstream,
    impacted,
    counts: count(changedSymbols, downstream, impacted),
    status: statusOf(r),
    reason: statusOf(r) === 'ok' ? null : toReason(r.reason ?? indexReason(r)),
    indexed_sha: r.indexedSha ?? null,
  };
}

/**
 * Every endpoint and cron the change could reach, from all three directions at once.
 *
 * Per-symbol attribution alone under-reports, and a real PR showed both ways it does.
 * That PR edited `agents/helpers.ts` AND `agents/routes.ts`; the routes file is a
 * changed file, so it is correctly excluded from its own downstream, and its endpoints
 * — the ones the diff touches most directly — appeared nowhere. Meanwhile endpoints
 * reached from `routes.ts` were attributed to no symbol, because the symbols all live
 * in the other changed file.
 *
 * So the union is taken over: the changed files' own facts (`depth: 0`), everything
 * the reverse walk reached, and everything already attributed to a symbol. Deduped on
 * label+kind+file keeping the shallowest depth, and sorted shallowest first.
 */
function mapLevelImpact(r: IndexBlastFacts, downstream: BlastDownstream[]): BlastEndpoint[] {
  const best = new Map<string, BlastEndpoint>();
  const add = (e: BlastEndpoint) => {
    if (isTestPath(e.file)) return;
    const key = `${e.kind}|${e.label}|${e.file}`;
    const prev = best.get(key);
    if (!prev || e.depth < prev.depth) best.set(key, e);
  };

  for (const own of r.changedFileFacts ?? []) {
    for (const label of own.endpoints)
      add({ label, kind: 'endpoint', file: own.file, depth: 0 });
    for (const label of own.crons) add({ label, kind: 'cron', file: own.file, depth: 0 });
  }
  for (const reached of r.reachedFiles ?? []) {
    for (const label of reached.endpoints)
      add({ label, kind: 'endpoint', file: reached.file, depth: reached.depth });
    for (const label of reached.crons)
      add({ label, kind: 'cron', file: reached.file, depth: reached.depth });
  }
  for (const d of downstream) for (const e of d.impacted) add(e);

  return [...best.values()].sort(
    (a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  );
}

/**
 * Endpoints and crons attributable to one changed symbol, from two directions.
 *
 * Both are needed and neither subsumes the other. `factsByFile` covers the files
 * that hold a resolved *symbol* caller — the strongest evidence, so depth 1.
 * `reachedFiles` covers the reverse import walk from the symbol's own file, which
 * catches the case symbol callers miss entirely: a router that mounts or re-exports
 * the changed module without naming any symbol in it.
 *
 * Deduped on label+kind+file, keeping the SHALLOWEST depth, so an endpoint found
 * both ways is reported once at its strongest attribution.
 */
function impactedFor(symbolFile: string, callerFiles: string[], r: IndexBlastFacts): BlastEndpoint[] {
  const best = new Map<string, BlastEndpoint>();
  const add = (e: BlastEndpoint) => {
    if (isTestPath(e.file)) return; // see isTestPath
    const key = `${e.kind}|${e.label}|${e.file}`;
    const prev = best.get(key);
    if (!prev || e.depth < prev.depth) best.set(key, e);
  };

  for (const file of new Set(callerFiles)) {
    const facts = r.factsByFile?.[file];
    if (!facts) continue;
    for (const label of facts.endpoints) add({ label, kind: 'endpoint', file, depth: 1 });
    for (const label of facts.crons) add({ label, kind: 'cron', file, depth: 1 });
  }

  for (const reached of r.reachedFiles ?? []) {
    if (reached.viaFile !== symbolFile) continue;
    for (const label of reached.endpoints)
      add({ label, kind: 'endpoint', file: reached.file, depth: reached.depth });
    for (const label of reached.crons)
      add({ label, kind: 'cron', file: reached.file, depth: reached.depth });
  }

  return [...best.values()].sort(
    (a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  );
}

/**
 * Whether a path is a test file, and therefore not a production HTTP surface.
 *
 * `extractEndpoints` cannot tell "declares this route" from "calls this route" —
 * both are `x.get('/path')` — so an integration test that exercises an API records
 * that API in its own `file_facts`. Measured on a real PR: `GET /agents/${agentId}/versions`
 * was reported as an impacted endpoint, sourced from `agents-versions.it.test.ts`.
 *
 * An endpoint in this map means "a live surface this change could break", and a test
 * is not one — it is a consumer that will simply re-run. Filtered HERE rather than in
 * the indexer, because the fact itself is true and other features may legitimately
 * want it; what is wrong is presenting it to a reviewer as a route at risk. The
 * patterns mirror `repo-intel`'s own `JUNK_PATH_PATTERNS`, which excludes the same
 * files from its rank-driven samples.
 */
function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('__tests__/') ||
    lower.includes('__mocks__/')
  );
}

function labels(impacted: BlastEndpoint[], kind: BlastEndpoint['kind']): string[] {
  return [...new Set(impacted.filter((e) => e.kind === kind).map((e) => e.label))];
}

/**
 * The stat row, computed once here so the four figures cannot drift from the tree
 * they sit above.
 *
 * `callers` sums the PRE-CAP counts, so it can legitimately exceed the number of
 * caller rows a client can render — "14 callers" over a list showing the top few is
 * the honest reading, not an off-by-something. Endpoints and crons are counted
 * DISTINCT by label across the whole map: one route reached through three different
 * symbols is one endpoint at risk, not three.
 */
function count(
  changedSymbols: ChangedSymbol[],
  downstream: BlastDownstream[],
  impacted: BlastEndpoint[],
): BlastCounts {
  let callers = 0;
  for (const d of downstream) callers += d.caller_count;
  // From the MAP-level union, not from `downstream`: an endpoint the changed file
  // declares itself belongs in this figure and is attributed to no symbol.
  const endpoints = new Set(impacted.filter((e) => e.kind === 'endpoint').map((e) => e.label));
  const crons = new Set(impacted.filter((e) => e.kind === 'cron').map((e) => e.label));
  return {
    symbols: changedSymbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}

/**
 * ok / partial / degraded from what the index could actually support.
 *
 * `degraded` on the facade result means the persistent index was not usable at all
 * and the answer came from the best-effort fallback (or from nothing) — so the
 * arrays prove nothing either way. `partial` means the index is real but covers only
 * some of the repository: callers may be missing, and an empty map still cannot be
 * read as "no impact". Only a `full` index earns `ok`.
 */
function statusOf(r: IndexBlastFacts): BlastStatus {
  if (r.degraded) return 'degraded';
  if (r.indexStatus === 'partial') return 'partial';
  if (r.indexStatus === 'full') return 'ok';
  // No index status at all on a non-degraded result should not happen; treat the
  // unknown as partial rather than asserting completeness we cannot demonstrate.
  return r.indexStatus == null ? 'partial' : 'degraded';
}

/** The reason for a non-`ok` status the facade did not itself label. */
function indexReason(r: IndexBlastFacts): IndexDegradedReason {
  return r.indexStatus === 'partial' ? 'index_partial' : 'no_data';
}
