import { describe, it, expect } from 'vitest';
import { buildGroups } from '../src/modules/smart-diff/groups.js';
import { ROLE_ORDER } from '../src/modules/smart-diff/constants.js';
import type { ClassifiedFile } from '../src/modules/smart-diff/types.js';

/**
 * L03b — group assembly and its order.
 *
 * "Core first" is the feature, so it is asserted as an ORDER and not as
 * membership: a test that only checks each file is in the right group passes
 * happily while the reviewer sees Boilerplate at the top.
 *
 * The within-group order is asserted the same way, and for a specific reason.
 * `getPrFiles` issues no `ORDER BY`, so rows arrive in physical heap order, and a
 * list rendered in order needs a TOTAL one — that failure has already been
 * reported here once as though it were a feature (`server/INSIGHTS.md`,
 * 2026-08-06). Asserting "the order did not change after an update" would pass
 * without a tiebreaker; asserting the output EQUALS the sorted expectation is
 * what actually catches it.
 */

let seq = 0;

function file(
  path: string,
  role: ClassifiedFile['role'],
  additions = 1,
  deletions = 0,
  over: { id?: string; patch?: string | null } = {},
): ClassifiedFile {
  return {
    role,
    file: {
      id: over.id ?? `f-${++seq}`,
      path,
      additions,
      deletions,
      patch: over.patch ?? null,
    },
  };
}

const NO_FINDINGS = new Map<string, number[]>();

describe('buildGroups — order across groups', () => {
  it('returns core, then wiring, then boilerplate, whatever order the files arrived in', () => {
    const groups = buildGroups(
      [
        file('package-lock.json', 'boilerplate'),
        file('src/config.ts', 'wiring'),
        file('src/logic.ts', 'core'),
      ],
      NO_FINDINGS,
    );
    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('follows ROLE_ORDER rather than first appearance', () => {
    // Pinned against the constant, so reordering ROLE_ORDER is a deliberate act
    // that shows up here rather than a silent change to what a reviewer reads first.
    const groups = buildGroups(
      [file('b.lock', 'boilerplate'), file('w.ts', 'wiring'), file('c.ts', 'core')],
      NO_FINDINGS,
    );
    expect(groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
  });

  it('omits a role with no files instead of emitting an empty heading', () => {
    const groups = buildGroups([file('src/logic.ts', 'core')], NO_FINDINGS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.role).toBe('core');
  });

  it('returns no groups at all for a PR whose files have never been imported', () => {
    expect(buildGroups([], NO_FINDINGS)).toEqual([]);
  });
});

describe('buildGroups — order within a group', () => {
  it('puts the biggest churn first', () => {
    const groups = buildGroups(
      [
        file('small.ts', 'core', 1, 1),
        file('big.ts', 'core', 80, 4),
        file('medium.ts', 'core', 10, 10),
      ],
      NO_FINDINGS,
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(['big.ts', 'medium.ts', 'small.ts']);
  });

  it('breaks a churn tie on path, so tied files cannot shuffle', () => {
    // Deliberately unsorted input with THREE-way tied churn: without the `path`
    // tiebreaker the output is whatever order the rows arrived in.
    const groups = buildGroups(
      [
        file('src/zebra.ts', 'core', 2, 0),
        file('src/alpha.ts', 'core', 1, 1),
        file('src/middle.ts', 'core', 0, 2),
      ],
      NO_FINDINGS,
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual([
      'src/alpha.ts',
      'src/middle.ts',
      'src/zebra.ts',
    ]);
  });

  it('breaks a path tie on id, because pr_files has no unique index on (pr_id, path)', () => {
    const groups = buildGroups(
      [
        file('src/dup.ts', 'core', 1, 0, { id: 'f-zzz' }),
        file('src/dup.ts', 'core', 1, 0, { id: 'f-aaa' }),
      ],
      NO_FINDINGS,
    );
    expect(groups[0]!.files).toHaveLength(2);
    // Total: the only remaining discriminator decides, so the order is stable.
    const groupsReversed = buildGroups(
      [
        file('src/dup.ts', 'core', 1, 0, { id: 'f-aaa' }),
        file('src/dup.ts', 'core', 1, 0, { id: 'f-zzz' }),
      ],
      NO_FINDINGS,
    );
    expect(groups[0]!.files).toEqual(groupsReversed[0]!.files);
  });

  it('does not let findings reorder anything', () => {
    // The brief requires the grouping to work before any review; a list that
    // rearranges itself when a review lands reads as moving on its own.
    const files = [file('src/quiet.ts', 'core', 90, 0), file('src/loud.ts', 'core', 2, 0)];
    const withFindings = buildGroups(files, new Map([['src/loud.ts', [1, 2, 3]]]));
    const without = buildGroups(files, NO_FINDINGS);
    expect(withFindings[0]!.files.map((f) => f.path)).toEqual(
      without[0]!.files.map((f) => f.path),
    );
  });
});

describe('buildGroups — the file payload', () => {
  it('attaches the finding lines for the matching path', () => {
    const groups = buildGroups(
      [file('src/config.ts', 'wiring'), file('src/quiet.ts', 'wiring')],
      new Map([['src/config.ts', [12]]]),
    );
    const byPath = new Map(groups[0]!.files.map((f) => [f.path, f.finding_lines]));
    expect(byPath.get('src/config.ts')).toEqual([12]);
    // A file with no findings gets an empty array, never undefined — the client
    // reads `.length` on it.
    expect(byPath.get('src/quiet.ts')).toEqual([]);
  });

  it('emits the path VERBATIM, not normalised', () => {
    // The client joins this response against `pr.files` to get the patch text; a
    // lowercased path would fail to match on a case-sensitive filesystem.
    const groups = buildGroups([file('src/Api/UserProfile.ts', 'core')], NO_FINDINGS);
    expect(groups[0]!.files[0]!.path).toBe('src/Api/UserProfile.ts');
  });

  it('still finds the findings of a path whose case differs', () => {
    // …which is why the lookup key is normalised even though the output is not.
    const groups = buildGroups(
      [file('src/Config.ts', 'wiring')],
      new Map([['src/config.ts', [12]]]),
    );
    expect(groups[0]!.files[0]!.finding_lines).toEqual([12]);
  });

  it('carries the stats and a summary derived from the patch', () => {
    const groups = buildGroups(
      [
        file('src/m.ts', 'core', 84, 3, {
          patch: '@@ -24,6 +24,12 @@ export async function rateLimit(\n+  const key = 1;',
        }),
      ],
      NO_FINDINGS,
    );
    expect(groups[0]!.files[0]).toMatchObject({
      additions: 84,
      deletions: 3,
      pseudocode_summary: 'rateLimit',
    });
  });

  it('summarises a file with no patch as null, not an empty string', () => {
    const groups = buildGroups([file('src/m.ts', 'core')], NO_FINDINGS);
    expect(groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });
});
