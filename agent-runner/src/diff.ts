import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';
import {
  CI_AGENTS_DIR,
  CI_RUNNER_PATH,
  CI_SKILLS_DIR,
  CI_WORKFLOW_PATH,
} from '@devdigest/shared';

/** A changed file as returned by GitHub's `pulls/{n}/files` (path + hunk patch). */
export interface ChangedFile {
  path: string;
  /** Unified-diff hunks for this file; absent for binary / too-large files. */
  patch?: string | null;
}

/**
 * The directory the export writes its own files into, derived from the runner's
 * exported path rather than written out again — `.devdigest`. Deriving it is the
 * point: the three `CI_*` paths below all live under it, and if one of them ever
 * moves, this follows instead of silently keeping a stale literal.
 */
const CI_BUNDLE_DIR = CI_RUNNER_PATH.slice(0, CI_RUNNER_PATH.lastIndexOf('/'));

/**
 * Files DevDigest itself installed, which the review must not read as somebody's
 * change: the manifests, the skill bodies, the runner bundle and the generated
 * workflow. A pull request that only touches those is not a code change and
 * produces no review at all.
 */
export function isDevDigestOwnedPath(path: string): boolean {
  return (
    path === CI_WORKFLOW_PATH ||
    path === CI_RUNNER_PATH ||
    path.startsWith(`${CI_BUNDLE_DIR}/`) ||
    path.startsWith(`${CI_AGENTS_DIR}/`) ||
    path.startsWith(`${CI_SKILLS_DIR}/`)
  );
}

/** Drop DevDigest's own generated files before the engine ever sees the diff. */
export function excludeDevDigestFiles(files: ChangedFile[]): {
  reviewable: ChangedFile[];
  excluded: string[];
} {
  const reviewable: ChangedFile[] = [];
  const excluded: string[] = [];
  for (const f of files) {
    if (isDevDigestOwnedPath(f.path)) excluded.push(f.path);
    else reviewable.push(f);
  }
  return { reviewable, excluded };
}

/**
 * Reconstruct a single UnifiedDiff from GitHub's `files` patches (the runner's
 * diff source — no clone needed). Files without a `patch` (binary / truncated by
 * the API) are reported in `skipped` so the caller can surface them — a silent
 * skip would read as "clean" when grounding later drops anything citing them.
 */
export function filesToUnifiedDiff(files: ChangedFile[]): { diff: UnifiedDiff; skipped: string[] } {
  const parts: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (!f.patch) {
      skipped.push(f.path);
      continue;
    }
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return { diff: parseUnifiedDiff(parts.join('\n')), skipped };
}

/**
 * Minimal unified-diff parser (vendored from the server's git adapter — pure,
 * "copy & own"). The runner owns diff acquisition: it reconstructs a unified
 * diff from the GitHub file patches, then parses it here into the UnifiedDiff
 * shape the grounding gate needs (file:line must intersect a hunk's new-side
 * line numbers).
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  const lines = raw.split('\n');

  let current: UnifiedDiff['files'][number] | null = null;
  let hunk: DiffHunk | null = null;
  let newLineCursor = 0;

  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      flushFile();
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!current) current = { path: '', additions: 0, deletions: 0, hunks: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hh = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hh) {
      flushHunk();
      const newStart = Number(hh[3]);
      const newLines = hh[4] ? Number(hh[4]) : 1;
      hunk = {
        file: current?.path ?? '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] ? Number(hh[2]) : 1,
        newStart,
        newLines,
        newLineNumbers: [],
      };
      newLineCursor = newStart;
      continue;
    }
    if (!current || !hunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions++;
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions++;
    } else {
      hunk.newLineNumbers.push(newLineCursor);
      newLineCursor++;
    }
  }
  flushFile();

  return { raw, files: files.filter((f) => f.path) };
}
