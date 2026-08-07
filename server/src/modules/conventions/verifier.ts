import { isAbsolute, resolve, sep } from 'node:path';
import type { ConventionEvidence, ConventionEvidenceMatch } from '@devdigest/shared';
import {
  EVIDENCE_LINE_WINDOW,
  MAX_VERIFY_FILE_BYTES,
  MIN_SNIPPET_CHARS,
} from './constants.js';

/**
 * The evidence gate — the reason this feature is worth shipping.
 *
 * A model asked to find house rules will produce plausible ones whether or not
 * they exist, and it will cite a file and a line for each because it was asked
 * to. This module goes and looks. A citation survives only if the file is really
 * in the clone and the snippet is really in the file; everything else is dropped
 * and counted, never shown with a broken link.
 *
 * It is the same bargain `reviewer-core/src/grounding.ts` makes for findings —
 * cite a real line or be dropped — applied to the other direction of the
 * product. The difference is that grounding checks against a diff it already
 * holds in memory, while this reads the clone, so path safety is this module's
 * problem and not that one's.
 *
 * **Line numbers are corrected, not just validated.** A model reading a file
 * routinely reports a line a few off, and code moves between the scan and the
 * click. Both cases resolve to the line the snippet is actually on, which is
 * what makes the "open on GitHub" deep-link land in the right place instead of
 * a few lines above it.
 *
 * No fs access happens here directly: the reader is injected, so every rule in
 * this file is unit-testable without a clone on disk.
 */

/** What the model claimed, before anyone checked it. */
export interface EvidenceClaim {
  path: string;
  start_line: number;
  snippet: string;
}

/** Reads a file's text, or resolves null when it cannot be read. */
export type ReadSource = (absolutePath: string) => Promise<string | null>;

export interface VerifyResult {
  /** Citations that survived, with real line numbers and the file's own text. */
  evidence: ConventionEvidence[];
  /** Claims that pointed at nothing. Surfaced as `scan.dropped_unverified`. */
  dropped: number;
}

/** Collapse runs of whitespace and trim, so re-indentation is not a mismatch. */
export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Drop a leading line number a model copied along with the code.
 *
 * The extraction prompt numbers every line (`12\tconst x = 1;`) because a model
 * asked to cite a line it had to count gets it wrong most of the time. The cost
 * of that help is that the numbers come back inside snippets, and a needle of
 * `12 const x = 1;` matches nothing. Only the two shapes we actually produce or
 * see — `12\t` and `12: ` — are stripped, so a real line of source that happens
 * to begin with a digit survives.
 *
 * Applied to the SNIPPET only. File lines are the source of truth and are never
 * rewritten.
 */
export function stripLineNumber(line: string): string {
  return line.replace(/^\s*\d+(?:\t|:\s)/, '');
}

/**
 * A snippet reduced to the normalised, non-blank lines that must be matched.
 *
 * Blank lines are dropped rather than matched: models add and remove them freely
 * when re-typing a snippet, and requiring them would fail citations that are
 * otherwise perfect.
 */
export function toNeedle(snippet: string): string[] {
  return snippet
    .split('\n')
    .map((line) => normalizeLine(stripLineNumber(line)))
    .filter((line) => line.length > 0);
}

/**
 * True when a needle is too generic to prove anything.
 *
 * Two ways to be trivial: too short overall, or made entirely of punctuation.
 * `}` and `});` are real lines in a real file, and a nearest-match search would
 * happily "verify" them against any file at all.
 */
export function isTrivialNeedle(needle: string[]): boolean {
  const joined = needle.join('');
  if (joined.length < MIN_SNIPPET_CHARS) return true;
  return !/[A-Za-z0-9]/.test(joined);
}

/**
 * Resolve a repo-relative path against the clone root, or null if it escapes.
 *
 * The path comes from a model, which makes it untrusted input to a filesystem
 * read — `../../.ssh/id_rsa` is a plausible thing for a confused model to emit
 * and an obvious thing for a malicious skill body to induce. Absolute paths and
 * the root itself are rejected too; only a real file strictly inside the clone
 * is addressable.
 */
export function resolveInRoot(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  if (isAbsolute(relativePath)) return null;
  const base = resolve(root);
  const absolutePath = resolve(base, relativePath);
  if (absolutePath === base) return null;
  if (!absolutePath.startsWith(base + sep)) return null;
  return absolutePath;
}

export interface Located {
  startLine: number;
  endLine: number;
  match: ConventionEvidenceMatch;
}

/**
 * Find `snippet` in `fileLines` and return where it ACTUALLY is.
 *
 * The needle must appear as a contiguous run of the file's non-blank lines —
 * contiguous so that a "snippet" assembled from three unrelated corners of a
 * file cannot pass, non-blank so that a dropped empty line does not fail an
 * otherwise exact citation.
 *
 * When a snippet occurs more than once, the occurrence nearest the claimed line
 * wins. That is what makes the exact/shifted/moved label meaningful: a repeated
 * one-liner resolves to the copy the model was actually looking at, rather than
 * to whichever copy happens to come first in the file.
 */
export function locateSnippet(
  fileLines: string[],
  snippet: string,
  claimedStartLine: number,
): Located | null {
  const needle = toNeedle(snippet);
  if (needle.length === 0 || isTrivialNeedle(needle)) return null;

  // Non-blank lines only, each remembering the 1-based line it came from.
  const dense: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < fileLines.length; i += 1) {
    const text = normalizeLine(fileLines[i] ?? '');
    if (text.length > 0) dense.push({ line: i + 1, text });
  }
  if (dense.length < needle.length) return null;

  let best: { startLine: number; endLine: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i + needle.length <= dense.length; i += 1) {
    let matched = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (dense[i + k]!.text !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    const startLine = dense[i]!.line;
    const distance = Math.abs(startLine - claimedStartLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { startLine, endLine: dense[i + needle.length - 1]!.line };
    }
  }

  if (!best) return null;
  const match: ConventionEvidenceMatch =
    bestDistance === 0 ? 'exact' : bestDistance <= EVIDENCE_LINE_WINDOW ? 'shifted' : 'moved';
  return { ...best, match };
}

/**
 * Verify one claim against the clone.
 *
 * The returned snippet is sliced out of the FILE, not copied from the claim: the
 * whole point is to show the reader what is in their repo, and a model that
 * re-typed the code slightly would otherwise have its version quoted back as if
 * it were the source.
 */
export async function verifyClaim(
  root: string,
  claim: EvidenceClaim,
  read: ReadSource,
): Promise<ConventionEvidence | null> {
  const absolutePath = resolveInRoot(root, claim.path);
  if (!absolutePath) return null;

  const source = await read(absolutePath);
  if (source === null) return null;
  // A NUL byte means this is not source we can cite lines from, whatever the
  // extension claims.
  if (source.includes('\0')) return null;
  if (Buffer.byteLength(source, 'utf8') > MAX_VERIFY_FILE_BYTES) return null;

  const fileLines = source.split('\n');
  const located = locateSnippet(fileLines, claim.snippet, claim.start_line);
  if (!located) return null;

  return {
    path: claim.path,
    start_line: located.startLine,
    end_line: located.endLine,
    snippet: fileLines.slice(located.startLine - 1, located.endLine).join('\n'),
    match: located.match,
  };
}

/**
 * Verify every claim behind one candidate.
 *
 * Duplicates collapse on (path, corrected start line): a model asked for
 * evidence often cites the same place twice in slightly different words, and
 * three copies of one citation must not read as three independent proofs.
 *
 * A candidate whose `evidence` comes back empty has nothing behind it and is
 * dropped by the caller — that is the rule the whole feature rests on.
 */
export async function verifyClaims(
  root: string,
  claims: EvidenceClaim[],
  read: ReadSource,
): Promise<VerifyResult> {
  const evidence: ConventionEvidence[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const claim of claims) {
    const verified = await verifyClaim(root, claim, read);
    if (!verified) {
      dropped += 1;
      continue;
    }
    const key = `${verified.path}:${verified.start_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push(verified);
  }

  return { evidence, dropped };
}
