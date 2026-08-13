import { describe, it, expect } from 'vitest';
import { buildSplitSuggestion } from '../src/modules/smart-diff/split.js';
import {
  MAX_PROPOSED_SPLITS,
  SPLIT_BOILERPLATE_NAME,
  SPLIT_OVERFLOW_NAME,
  SPLIT_REVIEWABLE_FILES_THRESHOLD,
  SPLIT_REVIEWABLE_LINES_THRESHOLD,
  SPLIT_WIRING_NAME,
} from '../src/modules/smart-diff/constants.js';
import type { ClassifiedFile } from '../src/modules/smart-diff/types.js';

/**
 * L03b — the split suggestion.
 *
 * The central assertion in this file is the one that looks like a bug: a PR whose
 * only bulk is a lock file is NOT too big. That is the whole reason the classifier
 * exists — if boilerplate counted toward the reviewer's workload, every dependency
 * bump would be told to split itself and the roles would be decoration.
 *
 * The second is the partition invariant. A suggestion that silently dropped a file
 * would be advice to ship a subset of the change.
 */

let seq = 0;

function file(
  path: string,
  role: ClassifiedFile['role'],
  additions = 1,
  deletions = 0,
): ClassifiedFile {
  return {
    role,
    file: { id: `f-${++seq}`, path, additions, deletions, patch: null },
  };
}

/** `n` core files under one directory, `lines` changed lines each. */
function coreFiles(dir: string, n: number, lines: number): ClassifiedFile[] {
  return Array.from({ length: n }, (_, i) => file(`${dir}/file${i}.ts`, 'core', lines, 0));
}

describe('buildSplitSuggestion — when it fires', () => {
  it('does not fire on a small PR', () => {
    const out = buildSplitSuggestion([file('src/a.ts', 'core', 10, 2)]);
    expect(out).toEqual({ too_big: false, total_lines: 12, proposed_splits: [] });
  });

  it('does NOT fire on a huge lock-file diff, which is the point of the feature', () => {
    const out = buildSplitSuggestion([
      file('package-lock.json', 'boilerplate', 5000, 240),
      file('package.json', 'boilerplate', 3, 1),
      file('src/a.ts', 'core', 8, 0),
    ]);
    expect(out.too_big).toBe(false);
    expect(out.proposed_splits).toEqual([]);
    // …and it still reports the PR's REAL size, which is what the header shows.
    expect(out.total_lines).toBe(5252);
  });

  it('counts boilerplate in total_lines while excluding it from the thresholds', () => {
    const out = buildSplitSuggestion([
      file('pnpm-lock.yaml', 'boilerplate', 4000, 0),
      ...coreFiles('src/api', 1, SPLIT_REVIEWABLE_LINES_THRESHOLD + 1),
    ]);
    expect(out.too_big).toBe(true);
    // The two figures deliberately run on different bases — see the doc-comment.
    expect(out.total_lines).toBe(4000 + SPLIT_REVIEWABLE_LINES_THRESHOLD + 1);
  });

  it('fires on reviewable LINES past the threshold', () => {
    const under = buildSplitSuggestion(
      coreFiles('src/api', 1, SPLIT_REVIEWABLE_LINES_THRESHOLD),
    );
    const over = buildSplitSuggestion(
      coreFiles('src/api', 1, SPLIT_REVIEWABLE_LINES_THRESHOLD + 1),
    );
    expect(under.too_big).toBe(false);
    expect(over.too_big).toBe(true);
  });

  it('fires on reviewable FILE COUNT even when every file is tiny', () => {
    // The shape line count misses: forty two-line edits is a worse review than
    // one 400-line function.
    const out = buildSplitSuggestion(
      coreFiles('src/api', SPLIT_REVIEWABLE_FILES_THRESHOLD + 1, 1),
    );
    expect(out.too_big).toBe(true);
    expect(out.total_lines).toBe(SPLIT_REVIEWABLE_FILES_THRESHOLD + 1);
  });

  it('counts wiring toward the reviewer workload alongside core', () => {
    const out = buildSplitSuggestion([
      file('src/a.ts', 'core', 300, 0),
      file('src/config.ts', 'wiring', 101, 0),
    ]);
    expect(out.too_big).toBe(true);
  });

  it('handles a PR with no files at all', () => {
    expect(buildSplitSuggestion([])).toEqual({
      too_big: false,
      total_lines: 0,
      proposed_splits: [],
    });
  });
});

describe('buildSplitSuggestion — the splits', () => {
  const BIG: ClassifiedFile[] = [
    ...coreFiles('src/api', 2, 150),
    ...coreFiles('src/middleware', 2, 60),
    file('src/config.ts', 'wiring', 20, 2),
    file('package-lock.json', 'boilerplate', 900, 40),
  ];

  it('divides core by directory and collapses the rest into one bucket each', () => {
    const { proposed_splits } = buildSplitSuggestion(BIG);
    expect(proposed_splits.map((s) => s.name)).toEqual([
      'Core: src/api',
      'Core: src/middleware',
      SPLIT_WIRING_NAME,
      SPLIT_BOILERPLATE_NAME,
    ]);
  });

  it('is a partition: every file appears in exactly one split', () => {
    const { proposed_splits } = buildSplitSuggestion(BIG);
    const placed = proposed_splits.flatMap((s) => s.files);
    expect(placed.slice().sort()).toEqual(BIG.map((c) => c.file.path).slice().sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  /**
   * The advice reads in the same order as the groups above it. This is the
   * assertion that caught the first implementation, which sorted on size alone:
   * the lock file is 940 lines against `src/api`'s 300, so a too-big PR was told
   * to split out its lock file first — the inversion the feature exists to fix.
   */
  it('orders splits by role first, so the substance is proposed before the noise', () => {
    const { proposed_splits } = buildSplitSuggestion(BIG);
    expect(proposed_splits[0]!.name).toBe('Core: src/api');
    expect(proposed_splits.at(-1)!.name).toBe(SPLIT_BOILERPLATE_NAME);
  });

  it('orders core buckets among themselves by size', () => {
    const { proposed_splits } = buildSplitSuggestion(BIG);
    const core = proposed_splits.filter((s) => s.name.startsWith('Core: '));
    // src/api is 2×150, src/middleware 2×60.
    expect(core.map((s) => s.name)).toEqual(['Core: src/api', 'Core: src/middleware']);
  });

  it('produces the same advice for a shuffled input', () => {
    const forwards = buildSplitSuggestion(BIG);
    const backwards = buildSplitSuggestion([...BIG].reverse());
    expect(backwards).toEqual(forwards);
  });

  it('names a root-level core file without inventing a directory', () => {
    const { proposed_splits } = buildSplitSuggestion([
      file('main.rs', 'core', 500, 0),
    ]);
    expect(proposed_splits[0]!.name).toBe('Core: (root)');
  });

  it('keys buckets case-insensitively but labels them as the repo wrote them', () => {
    const { proposed_splits } = buildSplitSuggestion([
      file('Src/Api/a.ts', 'core', 300, 0),
      file('src/api/b.ts', 'core', 200, 0),
    ]);
    expect(proposed_splits).toHaveLength(1);
    expect(proposed_splits[0]!.name).toBe('Core: Src/Api');
  });
});

describe('buildSplitSuggestion — the overflow bucket', () => {
  const MANY: ClassifiedFile[] = Array.from({ length: MAX_PROPOSED_SPLITS + 4 }, (_, i) =>
    file(`src/mod${i}/a.ts`, 'core', 100 - i, 0),
  );

  it(`proposes at most ${MAX_PROPOSED_SPLITS} splits`, () => {
    const { proposed_splits } = buildSplitSuggestion(MANY);
    expect(proposed_splits).toHaveLength(MAX_PROPOSED_SPLITS);
  });

  it('folds the remainder into one named bucket rather than dropping it', () => {
    const { proposed_splits } = buildSplitSuggestion(MANY);
    expect(proposed_splits.at(-1)!.name).toBe(SPLIT_OVERFLOW_NAME);
  });

  it('still partitions every file once', () => {
    const { proposed_splits } = buildSplitSuggestion(MANY);
    const placed = proposed_splits.flatMap((s) => s.files);
    expect(placed.slice().sort()).toEqual(MANY.map((c) => c.file.path).slice().sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('does not create an overflow bucket when the count fits exactly', () => {
    const exact = Array.from({ length: MAX_PROPOSED_SPLITS }, (_, i) =>
      file(`src/mod${i}/a.ts`, 'core', 100, 0),
    );
    const { proposed_splits } = buildSplitSuggestion(exact);
    expect(proposed_splits).toHaveLength(MAX_PROPOSED_SPLITS);
    expect(proposed_splits.map((s) => s.name)).not.toContain(SPLIT_OVERFLOW_NAME);
  });
});
