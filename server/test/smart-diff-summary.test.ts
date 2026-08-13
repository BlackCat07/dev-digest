import { describe, it, expect } from 'vitest';
import { pseudocodeSummary } from '../src/modules/smart-diff/summary.js';
import {
  MAX_SUMMARY_CHARS,
  MAX_SUMMARY_SYMBOLS,
} from '../src/modules/smart-diff/constants.js';

/**
 * L03b — the per-file summary.
 *
 * The property under test is that it QUOTES. Every symbol it returns must be
 * findable in the patch it was given, because that is what lets a field named
 * `pseudocode_summary` exist in a feature whose acceptance criterion is that no
 * model is called. A test that only checked "returns a non-empty string" would
 * pass against something that generated prose.
 *
 * The second property is that "nothing to say" is `null` and never `''` — an empty
 * string renders a blank "What this does:" row, which claims the feature ran and
 * found the change meaningless.
 */

function hunk(tail: string): string {
  return `@@ -1,2 +1,3 @@ ${tail}\n+  const x = 1;\n`;
}

describe('pseudocodeSummary — quoting', () => {
  it.each([
    ['export async function rateLimit(req: Req, res: Res) {', 'rateLimit'],
    ['function bucketKey(req) {', 'bucketKey'],
    ['export const config = {', 'config'],
    ['class RateLimiter {', 'RateLimiter'],
    ['def bucket_key(self):', 'bucket_key'],
    ['func (s *Server) Handle(w http.ResponseWriter) {', 'Handle'],
    ['export interface SmartDiffStore {', 'SmartDiffStore'],
    ['  describe("smart diff", () => {', 'describe'],
  ])('takes the declared name out of %j', (tail, expected) => {
    expect(pseudocodeSummary(hunk(tail))).toBe(expected);
  });

  it('lists several hunks in patch order', () => {
    const patch = [
      '@@ -8,2 +8,5 @@ function bucketKey(',
      '+  return req.ip;',
      '@@ -24,6 +24,12 @@ export async function rateLimit(',
      '+  const key = bucketKey(req);',
    ].join('\n');
    expect(pseudocodeSummary(patch)).toBe('bucketKey, rateLimit');
  });

  it('mentions a symbol once however many hunks touch it', () => {
    const patch = [hunk('export function rateLimit('), hunk('export function rateLimit(')].join('');
    expect(pseudocodeSummary(patch)).toBe('rateLimit');
  });

  it('every symbol it returns really appears in the patch', () => {
    const patch = [hunk('function alpha('), hunk('class Beta {')].join('');
    const out = pseudocodeSummary(patch)!;
    for (const symbol of out.split(', ')) expect(patch).toContain(symbol);
  });
});

describe('pseudocodeSummary — nothing to say', () => {
  it.each([
    ['no patch at all', null],
    ['an undefined patch', undefined],
    ['an empty patch', ''],
  ])('returns null for %s', (_label, patch) => {
    expect(pseudocodeSummary(patch)).toBeNull();
  });

  it('returns null for a patch whose headers carry no tail', () => {
    // Git omits the tail when the hunk is not inside a named construct.
    expect(pseudocodeSummary('@@ -1,2 +1,3 @@\n+  "lockfileVersion": 3,\n')).toBeNull();
  });

  it('returns null when the tail names nothing, rather than quoting a keyword', () => {
    // `export default async function (` ends in a keyword; "function" is worse
    // than silence because it looks like real output.
    expect(pseudocodeSummary(hunk('export default async function ('))).toBeNull();
    expect(pseudocodeSummary(hunk('}'))).toBeNull();
    expect(pseudocodeSummary(hunk('};'))).toBeNull();
  });

  it('returns null for a patch with no headers at all', () => {
    expect(pseudocodeSummary('+  just an added line\n-  and a removed one\n')).toBeNull();
  });

  /**
   * Git writes a `@@` tail for a MARKDOWN file too, and there it is a heading or a
   * sentence. Quoting a word out of it — `## Available Skills` → "Skills" — is worse
   * than saying nothing, because the row presents it as a symbol the change touched.
   * Found by running the route against a real 696-file GitHub PR; the earlier version
   * passed every test here and returned prose words on real data.
   */
  it.each([
    ' ## Available Skills',
    ' # Some Heading With Words',
    ' Reusable AI skills that provide specialized knowledge and workflows',
    ' See the table below for details.',
    ' ### Why this matters',
  ])('returns null for the prose tail %j, rather than a word out of it', (tail) => {
    expect(pseudocodeSummary(`@@ -1,2 +1,3 @@${tail}\n+  x`)).toBeNull();
  });

  it('still reads a declaration that has no argument list', () => {
    // The punctuation is what separates these from the prose above.
    expect(pseudocodeSummary(hunk('export const config = {'))).toBe('config');
    expect(pseudocodeSummary(hunk('class RateLimiter {'))).toBe('RateLimiter');
    expect(pseudocodeSummary(hunk('export interface SmartDiffStore {'))).toBe('SmartDiffStore');
  });

  it('never returns an empty string', () => {
    for (const patch of [null, '', '@@ -1 +1 @@\n', hunk('}'), 'no headers']) {
      const out = pseudocodeSummary(patch);
      expect(out === null || out.length > 0).toBe(true);
    }
  });
});

describe('pseudocodeSummary — bounds', () => {
  it(`quotes at most ${MAX_SUMMARY_SYMBOLS} symbols`, () => {
    const patch = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']
      .map((n) => hunk(`function ${n}(`))
      .join('');
    expect(pseudocodeSummary(patch)!.split(', ')).toHaveLength(MAX_SUMMARY_SYMBOLS);
  });

  it('stays within the character ceiling by dropping whole symbols', () => {
    const long = 'aVeryLongExportedSymbolNameIndeed'.repeat(2);
    const patch = [1, 2, 3, 4].map((i) => hunk(`function ${long}${i}(`)).join('');
    const out = pseudocodeSummary(patch)!;
    expect(out.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    // Whole symbols, so nothing is truncated mid-identifier.
    for (const symbol of out.split(', ')) expect(patch).toContain(symbol);
  });

  it('truncates when a single symbol is longer than the whole budget', () => {
    const out = pseudocodeSummary(hunk(`function ${'x'.repeat(MAX_SUMMARY_CHARS + 40)}(`))!;
    expect(out).toHaveLength(MAX_SUMMARY_CHARS);
  });

  it('handles a patch stored with CRLF endings', () => {
    expect(pseudocodeSummary('@@ -1,2 +1,3 @@ function bucketKey(\r\n+  x\r\n')).toBe('bucketKey');
  });
});
