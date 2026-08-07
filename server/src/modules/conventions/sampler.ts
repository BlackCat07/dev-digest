import type { ConventionBudgetCap } from '@devdigest/shared';
import { resolveInRoot, type ReadSource } from './verifier.js';
import { MAX_FILE_BYTES, MAX_SAMPLE_FILES, MAX_SAMPLE_TOKENS } from './constants.js';

/**
 * Which files a scan actually looks at.
 *
 * The ranking is NOT done here. `RepoIntel.getConventionSamples(repoId, n)`
 * already returns top-N paths by `file_rank` with tests, configs, migrations and
 * `.d.ts` filtered out, and it reads `file_rank` — so it can only ever return
 * files the indexer indexed, which is why a committed package cache like
 * `.pnpm-store` needs no exclusion of its own here. This module is what happens
 * to that ranked list afterwards: narrow it to the subtrees the user asked for,
 * spread it across the codebase instead of letting one directory win, and stop
 * at the budget.
 *
 * Every function here is pure except {@link collectSample}, whose reader and
 * token counter are injected.
 */

export interface SampledFile {
  path: string;
  source: string;
  tokens: number;
}

export interface SampleResult {
  files: SampledFile[];
  /** Which ceiling stopped the selection, or null when everything fit. */
  cappedBy: ConventionBudgetCap | null;
  /** Files skipped for exceeding {@link MAX_FILE_BYTES}. */
  skippedTooLarge: number;
  /** Files whose read failed — deleted since indexing, unreadable, binary. */
  skippedUnreadable: number;
}

export interface SampleOptions {
  /** Repo-relative prefixes to keep. Empty or omitted = the whole repo. */
  paths?: string[];
  /** Lower the file ceiling; can never raise it above {@link MAX_SAMPLE_FILES}. */
  maxFiles?: number;
  /** Lower the token ceiling; can never raise it above {@link MAX_SAMPLE_TOKENS}. */
  maxTokens?: number;
}

/**
 * Keep only paths under one of `prefixes`.
 *
 * Prefixes are matched on segment boundaries, so `src/mod` does not select
 * `src/modules/` — a prefix that silently widens is worse than one that
 * matches nothing, because the user sees a bill for files they excluded.
 */
export function filterBySubtree(paths: string[], prefixes?: string[]): string[] {
  if (!prefixes || prefixes.length === 0) return paths;
  const normalized = prefixes
    .map((p) => p.replace(/^\.?\/+/, '').replace(/\/+$/, ''))
    .filter((p) => p.length > 0);
  if (normalized.length === 0) return paths;
  return paths.filter((path) =>
    normalized.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );
}

/**
 * The group a file is stratified into: its first two path segments.
 *
 * One segment is useless in the layout this tool mostly meets — every file in a
 * server is under `src/`, so one group would hold everything and stratifying
 * would be a no-op. Two segments separate `src/modules` from `src/adapters` from
 * `src/platform`, which is the distinction that produces layer-specific rules
 * instead of one averaged mush.
 */
export function groupKey(path: string): string {
  const segments = path.split('/');
  if (segments.length <= 1) return '.';
  return segments.slice(0, Math.min(2, segments.length - 1)).join('/');
}

/**
 * Spread a rank-ordered list across its groups, keeping rank order inside each.
 *
 * Straight rank order is dominated by whichever directory happens to hold the
 * most-imported files, and a sample of 120 files from one directory teaches the
 * model that directory's habits and calls them the repo's. Round-robin over
 * groups keeps the highest-ranked file of every layer in the sample even when
 * the cap is small, while still preferring high-rank files within a layer.
 */
export function stratify(paths: string[], limit: number): string[] {
  if (limit <= 0) return [];
  if (paths.length <= limit) return [...paths];

  // Insertion order = rank order, so groups come out ordered by their best file.
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = groupKey(path);
    const bucket = groups.get(key);
    if (bucket) bucket.push(path);
    else groups.set(key, [path]);
  }

  const buckets = [...groups.values()];
  const out: string[] = [];
  let round = 0;
  while (out.length < limit) {
    let tookAny = false;
    for (const bucket of buckets) {
      if (round >= bucket.length) continue;
      out.push(bucket[round]!);
      tookAny = true;
      if (out.length >= limit) break;
    }
    if (!tookAny) break;
    round += 1;
  }
  return out;
}

/**
 * Read the selected files, stopping at the token ceiling.
 *
 * The file ceiling is applied first because it bounds how much is read at all;
 * the token ceiling then trims what was read. Both are reported through
 * `cappedBy` so the screen can say the sample was capped rather than implying
 * it covered the repo — a scan that silently looked at a third of the code and
 * reported "conventions in <repo>" is the failure mode this exists to prevent.
 */
export async function collectSample(
  root: string,
  rankedPaths: string[],
  read: ReadSource,
  countTokens: (text: string) => number,
  options: SampleOptions = {},
): Promise<SampleResult> {
  const fileLimit = Math.min(options.maxFiles ?? MAX_SAMPLE_FILES, MAX_SAMPLE_FILES);
  const tokenLimit = Math.min(options.maxTokens ?? MAX_SAMPLE_TOKENS, MAX_SAMPLE_TOKENS);

  const inScope = filterBySubtree(rankedPaths, options.paths);
  const cappedByFiles = inScope.length > fileLimit;
  const selected = stratify(inScope, fileLimit);

  const files: SampledFile[] = [];
  let used = 0;
  let skippedTooLarge = 0;
  let skippedUnreadable = 0;
  let cappedByTokens = false;

  for (const path of selected) {
    const absolutePath = resolveInRoot(root, path);
    if (!absolutePath) {
      skippedUnreadable += 1;
      continue;
    }
    const source = await read(absolutePath);
    if (source === null || source.includes('\0')) {
      skippedUnreadable += 1;
      continue;
    }
    if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) {
      skippedTooLarge += 1;
      continue;
    }

    const tokens = countTokens(source);
    if (used + tokens > tokenLimit) {
      // One oversized file must not end the scan while smaller ones would still
      // fit, so keep going rather than breaking out of the loop.
      cappedByTokens = true;
      continue;
    }
    used += tokens;
    files.push({ path, source, tokens });
  }

  return {
    files,
    // Tokens is the ceiling that costs money, so it is the one worth naming when
    // both bind.
    cappedBy: cappedByTokens ? 'tokens' : cappedByFiles ? 'files' : null,
    skippedTooLarge,
    skippedUnreadable,
  };
}
