import { describe, it, expect } from 'vitest';
import { hunkHeaders } from '../src/modules/intent/hunks.js';

/**
 * L03 — `@@` headers taken from `pr_files.patch`.
 *
 * Two regressions this pins, and neither is visible in a test that only counts
 * headers:
 *
 *  1. **The trailing section heading survives.** It is the enclosing function or
 *     class name git puts after the closing `@@`, and it is the whole reason the
 *     Intent Layer reads the raw patch instead of the parsed `DiffHunk` (whose
 *     regex keeps only the four line numbers). A "simplification" to the parsed
 *     structure still returns the right NUMBER of headers.
 *  2. **No diff body line ever comes out.** This is the acceptance item — the
 *     classifier is not allowed to see `+`/`-` content — and it is enforced here,
 *     one function away from the patch text, as well as end to end in
 *     `reviews.it.test.ts`.
 */

/**
 * A patch whose added content deliberately LOOKS like a header.
 *
 * `+@@ -1,1 +1,1 @@ decoy` is an added line, not a hunk header, and a filter
 * written as `line.includes('@@')` (or one applied after stripping the leading
 * `+`) would emit it — carrying real diff content into the classifier's prompt.
 */
const PATCH = `@@ -10,3 +10,4 @@ export function upsertIntent(db: Db) {
   port: 3000,
+  stripeKey: "sk_live_xxx",
-  legacyKey: "sk_test_old",
   redisUrl: x,
@@ -80,6 +81,9 @@ class IntentService {
   const a = 1;
+@@ -1,1 +1,1 @@ decoy
-@@ -2,2 +2,2 @@ decoy
 @@ context line that begins with an at-sign`;

describe('hunkHeaders', () => {
  it('returns the @@ lines verbatim, keeping the trailing section heading', () => {
    expect(hunkHeaders(PATCH)).toEqual([
      '@@ -10,3 +10,4 @@ export function upsertIntent(db: Db) {',
      '@@ -80,6 +81,9 @@ class IntentService {',
    ]);
  });

  it('never returns a line that begins with + or -', () => {
    const bodyLines = hunkHeaders(PATCH).filter((line) => /^[+-]/.test(line));
    expect(bodyLines).toEqual([]);
    // The specific secret in the fixture: the one thing a leak would carry.
    expect(hunkHeaders(PATCH).join('\n')).not.toContain('sk_live_xxx');
  });

  it('returns nothing for a patch with no hunks', () => {
    expect(hunkHeaders('')).toEqual([]);
    expect(hunkHeaders('Binary files a/logo.png and b/logo.png differ')).toEqual([]);
  });

  it('drops the CRLF artefact rather than keeping it in the header text', () => {
    expect(hunkHeaders('@@ -1,2 +1,2 @@ fn main()\r\n+added\r\n')).toEqual([
      '@@ -1,2 +1,2 @@ fn main()',
    ]);
  });
});
