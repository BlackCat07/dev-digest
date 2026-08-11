/**
 * The role classifier — pure. No clock, no I/O, no `this`.
 *
 * Assigns each changed file one of `core` / `wiring` / `boilerplate` from its
 * PATH alone. Nothing else is available and nothing else is wanted: a path is
 * present the instant a PR is imported, so the grouping works before any review
 * has run and costs nothing to compute. The patch is never read here — the diff
 * body would make this a content classifier, which is a different feature with a
 * different cost.
 *
 * Deliberately NOT using `repo-intel`'s `file_rank` percentile, which would be
 * the obvious "importance" signal: it needs an indexed clone, and the demo repo
 * has none, so the primary input would be empty on the only repository a fresh
 * install has. See `server/specs/smart-diff.md`.
 */
import type { SmartDiffRole } from '@devdigest/shared';
import { DEFAULT_ROLE, LOCK_FILE_PATTERN, ROLE_BY_PATH } from './constants.js';

/**
 * A path in the one form every pattern and every join is written against.
 *
 * Exported because the findings join needs the SAME normalisation on both sides —
 * a finding citing `./src/config.ts` has to meet `src/config.ts` from `pr_files`,
 * and two independent normalisations would drift.
 *
 * Windows separators are folded, a leading `./` or `/` is dropped, and the result
 * is lowercased so the pattern table needs no case variants. Lowercasing is safe
 * because every pattern matches structure (directory names, extensions,
 * well-known basenames), never a user-chosen identifier — but note it means the
 * classifier cannot distinguish `README.md` from `readme.md`, which is a
 * distinction nothing here wants to make.
 */
export function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/**
 * The role of one changed file. Total: never throws, always returns.
 *
 * The lock-file check is a SEPARATE STATEMENT above the loop, not the first row
 * of `ROLE_BY_PATH`. That is what makes "a lock file is always boilerplate"
 * structurally true rather than a property of list order — as a row it would hold
 * only until someone inserted a broader pattern above it, and the failure would
 * be invisible (a lock file quietly appearing in `core` breaks no test that only
 * checks the other roles).
 */
export function classifyPath(rawPath: string): SmartDiffRole {
  const path = normalizePath(rawPath);

  if (LOCK_FILE_PATTERN.test(path)) return 'boilerplate';

  for (const [pattern, role] of ROLE_BY_PATH) {
    if (pattern.test(path)) return role;
  }

  // Unrecognised ⇒ the substance of the change. See DEFAULT_ROLE for why this
  // direction is the safe one.
  return DEFAULT_ROLE;
}
