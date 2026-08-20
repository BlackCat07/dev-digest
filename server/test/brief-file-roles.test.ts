import { describe, it, expect } from 'vitest';
import {
  capFileList,
  orderChangedFilesByRole,
  type FileRoleClassifier,
} from '../src/modules/brief/file-roles.js';
import { classifyPath } from '../src/modules/smart-diff/classify.js';

/**
 * L05 — the changed-file list the model input carries: ordered by role, then
 * capped (AC-60, AC-17), plus EC-35's accepted no-op.
 *
 * Hermetic and pure: no database, no clone, no provider, no clock. The role is a
 * function of the path alone, so there is nothing to fake and no degraded path
 * to exercise.
 *
 * The REAL classifier is passed in, deliberately, the way
 * `test/blast-service.test.ts` passes the real `BlastResult` into a
 * consumer-declared port: `modules/brief/` imports no sibling module, so this
 * test is the only place the declared {@link FileRoleClassifier} and the
 * implementation the composition root binds to it are checked against each
 * other. If they ever drift, they drift here.
 *
 * `classifyPath` is assigned to the port type rather than merely called, because
 * an arity or return-type drift is a compile error and not a failing assertion —
 * and note that no gate typechecks `test/` (`server/INSIGHTS.md`, 2026-08-10),
 * so `tsc --noEmit -p tsconfig.eslint.json` is what surfaces it.
 */
const classify: FileRoleClassifier = classifyPath;

/**
 * The shape the composition root actually binds — an arrow that closes over the
 * classifier — so the ordering is exercised through the same indirection the
 * assembly will use, not only through the bare function.
 */
const boundClassify: FileRoleClassifier = (path: string) => classifyPath(path);

/** A `pr_files` row, narrowed to what the ordering reads plus the fields it must carry. */
function file(path: string, additions = 1, deletions = 0) {
  return { path, additions, deletions };
}

describe('orderChangedFilesByRole', () => {
  it('contributes the source files first and the lock file last (AC-60)', () => {
    // The criterion's own observable, in its own `pr_files` order: the lock file
    // arrives FIRST and must end up last.
    const files = [file('pnpm-lock.yaml'), file('src/server.ts'), file('src/api/rate-limit.ts')];

    // Roles pinned explicitly, so a change in the classifier's table shows up as
    // a role assertion rather than as a mysterious order failure here.
    expect(classify('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classify('src/server.ts')).toBe('wiring');
    expect(classify('src/api/rate-limit.ts')).toBe('core');

    expect(orderChangedFilesByRole(files, classify).map((f) => f.path)).toEqual([
      'src/api/rate-limit.ts',
      'src/server.ts',
      'pnpm-lock.yaml',
    ]);
  });

  it('preserves the input order within each role', () => {
    // Two files per role, interleaved on the way in. Asserting the whole output
    // array rather than "each file is in the right block": a membership-only
    // assertion passes while the within-role order wobbles, and `getPrFiles`
    // issues no `ORDER BY`, so the input order is the only order there is.
    const files = [
      file('README.md'), //            boilerplate 1
      file('src/api/rate-limit.ts'), // core 1
      file('tsconfig.json'), //        wiring 1
      file('src/domain/pricing.ts'), // core 2
      file('pnpm-lock.yaml'), //       boilerplate 2
      file('src/server.ts'), //        wiring 2
    ];

    expect(orderChangedFilesByRole(files, classify).map((f) => f.path)).toEqual([
      'src/api/rate-limit.ts',
      'src/domain/pricing.ts',
      'tsconfig.json',
      'src/server.ts',
      'README.md',
      'pnpm-lock.yaml',
    ]);
  });

  it('loses no file, and carries the row it was given through untouched', () => {
    // The ordering iterates a role list declared inside `file-roles.ts`; a role
    // added to the contract and not added there would silently DROP its files,
    // which no order assertion above would notice. So the partition is asserted:
    // same count, same rows, same object identities.
    const files = [
      file('pnpm-lock.yaml', 900, 120),
      file('src/api/rate-limit.ts', 40, 3),
      file('tsconfig.json', 2, 1),
      file('docs/README.md', 5, 0),
      file('src/db/migrations/0001_init.sql', 30, 0),
    ];

    const ordered = orderChangedFilesByRole(files, classify);

    expect(ordered).toHaveLength(files.length);
    expect([...ordered].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...files].sort((a, b) => a.path.localeCompare(b.path)),
    );
    // Identity, not equality: `additions` / `deletions` travel to the assembly on
    // the caller's own row and are never rebuilt here.
    for (const row of files) expect(ordered).toContain(row);
    expect(ordered[0]).toMatchObject({ path: 'src/api/rate-limit.ts', additions: 40, deletions: 3 });
  });

  it('behaves identically through the arrow binding the container uses', () => {
    const files = [file('pnpm-lock.yaml'), file('src/api/rate-limit.ts'), file('src/server.ts')];

    expect(orderChangedFilesByRole(files, boundClassify)).toEqual(
      orderChangedFilesByRole(files, classify),
    );
  });

  it('is a no-op when no path is recognised (EC-35)', () => {
    // EC-35 is ACCEPTED, so this asserts the behaviour rather than correcting it:
    // an unrecognised path classifies `core` (the classifier's asymmetric-cost
    // default), so every file lands in one bucket, the ordering changes nothing,
    // and the cap therefore falls in `pr_files` order.
    const files = [
      file('zeta/handler.ts'),
      file('alpha/service.ts'),
      file('middle/repository.ts'),
    ];

    for (const f of files) expect(classify(f.path)).toBe('core');

    const ordered = orderChangedFilesByRole(files, classify);
    expect(ordered.map((f) => f.path)).toEqual(files.map((f) => f.path));

    expect(capFileList(ordered, 2)).toEqual({
      kept: [files[0], files[1]],
      omitted: 1,
    });
  });

  it('returns an empty list for an empty changed-file list', () => {
    expect(orderChangedFilesByRole([], classify)).toEqual([]);
  });
});

describe('capFileList', () => {
  it('keeps 200 of 400 paths and states the remainder (AC-17)', () => {
    const files = Array.from({ length: 400 }, (_, i) => file(`src/mod${i}/thing.ts`));

    const capped = capFileList(orderChangedFilesByRole(files, classify), 200);

    expect(capped.kept).toHaveLength(200);
    expect(capped.omitted).toBe(200);
  });

  it('is applied AFTER the ordering, never before', () => {
    // The load-bearing assertion of this file. Capping the raw `pr_files` list
    // would spend a 2-path budget on the two lock files that happen to come
    // first and drop the only source file in the pull request — the same
    // inversion Smart Diff's split suggestion once shipped by ranking its
    // buckets by size (`server/INSIGHTS.md`, 2026-08-11).
    const files = [
      file('pnpm-lock.yaml'),
      file('package-lock.json'),
      file('src/api/rate-limit.ts'),
    ];

    const rightWayRound = capFileList(orderChangedFilesByRole(files, classify), 2);
    expect(rightWayRound.kept.map((f) => f.path)).toEqual(['src/api/rate-limit.ts', 'pnpm-lock.yaml']);
    expect(rightWayRound.omitted).toBe(1);

    // Stated as the contrast it is: the inverted pipeline drops the file the
    // reviewer came for, and both lists are 2 long, so a length check cannot
    // tell them apart.
    const wrongWayRound = orderChangedFilesByRole(capFileList(files, 2).kept, classify);
    expect(wrongWayRound.map((f) => f.path)).not.toContain('src/api/rate-limit.ts');
  });

  it('omits nothing when the list already fits, at or under the cap', () => {
    const files = [file('a/one.ts'), file('b/two.ts')];

    expect(capFileList(files, 2)).toEqual({ kept: files, omitted: 0 });
    expect(capFileList(files, 5)).toEqual({ kept: files, omitted: 0 });
    expect(capFileList([], 5)).toEqual({ kept: [], omitted: 0 });
  });

  it('keeps nothing at a cap of zero and reports the whole list as omitted', () => {
    const files = [file('a/one.ts'), file('b/two.ts')];

    expect(capFileList(files, 0)).toEqual({ kept: [], omitted: 2 });
  });
});
