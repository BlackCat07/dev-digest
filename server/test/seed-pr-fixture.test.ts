import { describe, it, expect } from 'vitest';
import { SEED_PR_FILES, SEED_PR_TOTALS } from '../src/db/seed.js';
import { classifyPath } from '../src/modules/smart-diff/classify.js';
import { pseudocodeSummary } from '../src/modules/smart-diff/summary.js';

/**
 * L03b — the demo PR fixture, checked for internal consistency.
 *
 * Hermetic: this reads the constants, never the database. It exists because the
 * fixture makes claims about itself that nothing else verifies, and the previous
 * version of it was wrong in exactly that way — `pull_requests` said
 * `additions: 247, deletions: 38, filesCount: 9` over four rows summing to
 * `126 / 8`, and no test, gate or screen noticed for months.
 *
 * The cases below are the properties a future edit to `SEED_PR_PATCHES` must
 * preserve. They are cheap and they fail loudly, which is the point: a fixture is
 * the one place where "it looks about right" is how wrong data survives.
 */

/** Line numbers the seeded findings sit on — see the note in `seed.ts`. */
const FINDING_ANCHORS = [
  { path: 'src/config.ts', line: 12 },
  { path: 'src/api/users.ts', line: 45 },
];

/** New-side line numbers a unified patch renders, mirroring the client's parser. */
function newSideLines(patch: string): number[] {
  const lines: number[] = [];
  let newNo = 0;
  for (const raw of patch.split('\n')) {
    const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      newNo = Number(header[1]);
      continue;
    }
    if (raw.startsWith('-')) continue;
    lines.push(newNo);
    newNo += 1;
  }
  return lines;
}

describe('the seeded PR fixture', () => {
  it('reports a size that matches its own files', () => {
    expect(SEED_PR_TOTALS).toEqual({
      additions: SEED_PR_FILES.reduce((n, f) => n + f.additions, 0),
      deletions: SEED_PR_FILES.reduce((n, f) => n + f.deletions, 0),
      filesCount: SEED_PR_FILES.length,
    });
  });

  it('counts every changed line of every patch', () => {
    for (const file of SEED_PR_FILES) {
      const body = file.patch.split('\n').filter((l) => !l.startsWith('@@ '));
      expect(file.additions, file.path).toBe(body.filter((l) => l.startsWith('+')).length);
      expect(file.deletions, file.path).toBe(body.filter((l) => l.startsWith('-')).length);
    }
  });

  it('gives every file a patch, so no row renders "no diff text available"', () => {
    for (const file of SEED_PR_FILES) {
      expect(file.patch.length, file.path).toBeGreaterThan(0);
      expect(file.patch, file.path).toMatch(/^@@ /m);
    }
  });

  it('has no duplicate paths', () => {
    const paths = SEED_PR_FILES.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  /**
   * The reason this file exists at all. A findings badge scrolls to
   * `finding.start_line` on the NEW side of the patch; if that line is not
   * rendered, the click silently does nothing and the demo shows the feature
   * broken. Both seeded findings must therefore land inside a real hunk.
   */
  it.each(FINDING_ANCHORS)('renders line $line of $path, so its badge has a target', ({ path, line }) => {
    const file = SEED_PR_FILES.find((f) => f.path === path);
    expect(file, `${path} is missing from SEED_PR_PATCHES`).toBeDefined();
    expect(newSideLines(file!.patch)).toContain(line);
  });

  it('spans all three Smart Diff roles, so a fresh install demonstrates grouping', () => {
    const roles = new Set(SEED_PR_FILES.map((f) => classifyPath(f.path)));
    expect([...roles].sort()).toEqual(['boilerplate', 'core', 'wiring']);
  });

  it('contains a lock file, the one path whose role is an acceptance criterion', () => {
    const lock = SEED_PR_FILES.find((f) => f.path === 'package-lock.json');
    expect(lock).toBeDefined();
    expect(classifyPath(lock!.path)).toBe('boilerplate');
  });

  it('quotes a summary for the core files, and none for the lock file', () => {
    const summaryOf = (path: string) =>
      pseudocodeSummary(SEED_PR_FILES.find((f) => f.path === path)!.patch);
    // Two hunks with function-context tails, so the demo shows the multi-symbol case.
    expect(summaryOf('src/middleware/ratelimit.ts')).toBe('bucketKey, rateLimit');
    expect(summaryOf('src/api/users.ts')).toBe('listUsers');
    // A lock-file hunk has no enclosing construct, so there is nothing to quote.
    expect(summaryOf('package-lock.json')).toBeNull();
  });
});
