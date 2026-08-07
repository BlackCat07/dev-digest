import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';
import {
  collectSample,
  filterBySubtree,
  groupKey,
  stratify,
} from '../src/modules/conventions/sampler.js';
import { MAX_FILE_BYTES } from '../src/modules/conventions/constants.js';
import type { ReadSource } from '../src/modules/conventions/verifier.js';

/** Sample selection. Hermetic — the reader and the token counter are injected. */

const ROOT = `${sep}clones${sep}acme`;

/** One token per 4 chars, the same shape as the tokenizer's heuristic fallback. */
const countTokens = (text: string) => Math.ceil(text.length / 4);

function readerFor(contents: Record<string, string>): ReadSource {
  return async (absolutePath: string) => contents[absolutePath] ?? null;
}

/** Build a reader keyed by repo-relative path, resolving like the sampler does. */
function cloneWith(files: Record<string, string>): ReadSource {
  const byAbsolute: Record<string, string> = {};
  for (const [relative, source] of Object.entries(files)) {
    byAbsolute[`${ROOT}${sep}${relative.split('/').join(sep)}`] = source;
  }
  return readerFor(byAbsolute);
}

describe('filterBySubtree', () => {
  const paths = ['src/modules/a.ts', 'src/adapters/b.ts', 'test/c.ts'];

  it('keeps everything when no prefixes are given', () => {
    expect(filterBySubtree(paths)).toEqual(paths);
    expect(filterBySubtree(paths, [])).toEqual(paths);
  });

  it('keeps only the requested subtrees', () => {
    expect(filterBySubtree(paths, ['src/modules'])).toEqual(['src/modules/a.ts']);
  });

  it('tolerates a trailing or leading slash in the prefix', () => {
    expect(filterBySubtree(paths, ['./src/modules/'])).toEqual(['src/modules/a.ts']);
  });

  it('matches on segment boundaries, so a partial name selects nothing', () => {
    // `src/mod` must not quietly widen to `src/modules/` — the user would be
    // billed for files they thought they had excluded.
    expect(filterBySubtree(paths, ['src/mod'])).toEqual([]);
  });
});

describe('groupKey', () => {
  it('uses two segments so layers under src/ stay apart', () => {
    expect(groupKey('src/modules/skills/service.ts')).toBe('src/modules');
    expect(groupKey('src/adapters/git/simple-git.ts')).toBe('src/adapters');
  });

  it('falls back to the directory when the path is shallow', () => {
    expect(groupKey('src/app.ts')).toBe('src');
    expect(groupKey('index.ts')).toBe('.');
  });
});

describe('stratify', () => {
  it('returns the list untouched when it already fits', () => {
    const paths = ['src/a/one.ts', 'src/a/two.ts'];
    expect(stratify(paths, 10)).toEqual(paths);
  });

  it('takes the best file of every layer before the second of any', () => {
    // Rank order would take three files from src/modules and none from the rest.
    const paths = [
      'src/modules/one.ts',
      'src/modules/two.ts',
      'src/modules/three.ts',
      'src/adapters/one.ts',
      'src/platform/one.ts',
    ];
    expect(stratify(paths, 3)).toEqual([
      'src/modules/one.ts',
      'src/adapters/one.ts',
      'src/platform/one.ts',
    ]);
  });

  it('keeps rank order inside a layer', () => {
    const paths = ['src/a/one.ts', 'src/a/two.ts', 'src/b/one.ts'];
    expect(stratify(paths, 4)).toEqual(paths);
    expect(stratify(paths, 2)).toEqual(['src/a/one.ts', 'src/b/one.ts']);
  });

  it('returns nothing for a non-positive limit', () => {
    expect(stratify(['src/a/one.ts'], 0)).toEqual([]);
  });
});

describe('collectSample', () => {
  it('reads the selected files and reports nothing capped when all fit', async () => {
    const read = cloneWith({
      'src/a/one.ts': 'export const one = 1;',
      'src/b/two.ts': 'export const two = 2;',
    });
    const result = await collectSample(ROOT, ['src/a/one.ts', 'src/b/two.ts'], read, countTokens);
    expect(result.files.map((f) => f.path)).toEqual(['src/a/one.ts', 'src/b/two.ts']);
    expect(result.cappedBy).toBeNull();
    expect(result.files[0]!.tokens).toBeGreaterThan(0);
  });

  it('reports the file ceiling when the ranked list is longer than the cap', async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const path = `src/a/file${i}.ts`;
      paths.push(path);
      files[path] = 'export const x = 1;';
    }
    const result = await collectSample(ROOT, paths, cloneWith(files), countTokens, {
      maxFiles: 2,
    });
    expect(result.files).toHaveLength(2);
    expect(result.cappedBy).toBe('files');
  });

  it('reports the token ceiling and names it over the file ceiling', async () => {
    const read = cloneWith({
      'src/a/big.ts': 'x'.repeat(400),
      'src/b/small.ts': 'y'.repeat(4),
    });
    const result = await collectSample(
      ROOT,
      ['src/a/big.ts', 'src/b/small.ts'],
      read,
      countTokens,
      { maxTokens: 50 },
    );
    expect(result.files.map((f) => f.path)).toEqual(['src/b/small.ts']);
    expect(result.cappedBy).toBe('tokens');
  });

  it('keeps going past an oversized file so smaller ones still fit', async () => {
    // The budget must not be ended by the first file that does not fit — that
    // would make the sample depend on rank order in a way nobody can predict.
    const read = cloneWith({
      'src/a/big.ts': 'x'.repeat(400),
      'src/b/small.ts': 'y'.repeat(4),
      'src/c/small.ts': 'z'.repeat(4),
    });
    const result = await collectSample(
      ROOT,
      ['src/a/big.ts', 'src/b/small.ts', 'src/c/small.ts'],
      read,
      countTokens,
      { maxTokens: 50 },
    );
    expect(result.files.map((f) => f.path)).toEqual(['src/b/small.ts', 'src/c/small.ts']);
  });

  it('skips a file past the per-file byte ceiling and counts it', async () => {
    const read = cloneWith({
      'src/a/generated.ts': 'x'.repeat(MAX_FILE_BYTES + 1),
      'src/b/real.ts': 'export const real = 1;',
    });
    const result = await collectSample(
      ROOT,
      ['src/a/generated.ts', 'src/b/real.ts'],
      read,
      countTokens,
    );
    expect(result.files.map((f) => f.path)).toEqual(['src/b/real.ts']);
    expect(result.skippedTooLarge).toBe(1);
  });

  it('counts a file that vanished between indexing and the scan', async () => {
    const result = await collectSample(
      ROOT,
      ['src/a/deleted.ts'],
      cloneWith({}),
      countTokens,
    );
    expect(result.files).toEqual([]);
    expect(result.skippedUnreadable).toBe(1);
  });

  it('never lets an option raise a ceiling above the hard cap', async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const path = `src/a/file${i}.ts`;
      paths.push(path);
      files[path] = 'export const x = 1;';
    }
    const result = await collectSample(ROOT, paths, cloneWith(files), countTokens, {
      maxFiles: 10_000,
    });
    expect(result.files.length).toBeLessThanOrEqual(120);
    expect(result.cappedBy).toBe('files');
  });
});
