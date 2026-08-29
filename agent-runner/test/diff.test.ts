import { describe, it, expect } from 'vitest';
import {
  CI_AGENTS_DIR,
  CI_RUNNER_PATH,
  CI_SKILLS_DIR,
  CI_WORKFLOW_PATH,
} from '@devdigest/shared';
import {
  excludeDevDigestFiles,
  filesToUnifiedDiff,
  isDevDigestOwnedPath,
  parseUnifiedDiff,
} from '../src/diff.js';
import { CONFIG_PATCH } from './helpers.js';

/**
 * The vendored parser is what the grounding gate indexes: an off-by-one here
 * silently drops every finding, and the run still reports success.
 */
describe('parseUnifiedDiff', () => {
  it('numbers the new side so a grounding lookup hits the added line', () => {
    const { diff } = filesToUnifiedDiff([{ path: 'src/config.ts', patch: CONFIG_PATCH }]);
    const file = diff.files[0];
    expect(file?.path).toBe('src/config.ts');
    const hunk = file?.hunks[0];
    // @@ -10,3 +10,4 @@ — context 10, the addition 11, context 12.
    expect(hunk?.newStart).toBe(10);
    expect(hunk?.newLineNumbers).toEqual([10, 11, 12]);
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(0);
  });

  it('counts deletions and keeps the new-side cursor off them', () => {
    const diff = parseUnifiedDiff(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,3 +1,3 @@',
        ' keep',
        '-gone',
        '+added',
        ' tail',
      ].join('\n'),
    );
    const file = diff.files[0];
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(1);
    // The removed line consumes no new-side number: 1 keep, 2 added, 3 tail.
    expect(file?.hunks[0]?.newLineNumbers).toEqual([1, 2, 3]);
  });

  it('parses several files and drops entries with no resolvable path', () => {
    const { diff } = filesToUnifiedDiff([
      { path: 'src/a.ts', patch: '@@ -1 +1,2 @@\n one\n+two' },
      { path: 'src/b.ts', patch: '@@ -5 +5,2 @@\n five\n+six' },
    ]);
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('filesToUnifiedDiff', () => {
  it('reports files GitHub returned with no patch instead of treating them as clean', () => {
    const { diff, skipped } = filesToUnifiedDiff([
      { path: 'src/config.ts', patch: CONFIG_PATCH },
      { path: 'assets/logo.png', patch: null }, // binary → no patch
      { path: 'data/huge.csv' }, // truncated by the API → key absent
    ]);
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(skipped).toEqual(['assets/logo.png', 'data/huge.csv']);
  });

  it('yields an empty diff, not a throw, when every file was skipped', () => {
    const { diff, skipped } = filesToUnifiedDiff([{ path: 'a.png', patch: null }]);
    expect(diff.files).toEqual([]);
    expect(skipped).toEqual(['a.png']);
  });
});

describe('isDevDigestOwnedPath', () => {
  it('claims every path the export writes, taken from the shared constants', () => {
    for (const p of [
      CI_WORKFLOW_PATH,
      CI_RUNNER_PATH,
      `${CI_AGENTS_DIR}/security-reviewer.yaml`,
      `${CI_SKILLS_DIR}/secret-gate.md`,
    ]) {
      expect(isDevDigestOwnedPath(p)).toBe(true);
    }
  });

  it('leaves ordinary source and other workflows alone', () => {
    for (const p of [
      'src/config.ts',
      '.github/workflows/ci.yml',
      'docs/.devdigest-notes.md',
      'devdigest/runner.mjs',
    ]) {
      expect(isDevDigestOwnedPath(p)).toBe(false);
    }
  });
});

describe('excludeDevDigestFiles', () => {
  it('splits the changed files into reviewable and DevDigest-owned', () => {
    const { reviewable, excluded } = excludeDevDigestFiles([
      { path: 'src/config.ts', patch: CONFIG_PATCH },
      { path: `${CI_AGENTS_DIR}/x.yaml`, patch: '@@ -1 +1 @@\n-a\n+b' },
      { path: CI_WORKFLOW_PATH, patch: '@@ -1 +1 @@\n-a\n+b' },
    ]);
    expect(reviewable.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(excluded).toEqual([`${CI_AGENTS_DIR}/x.yaml`, CI_WORKFLOW_PATH]);
  });
});
