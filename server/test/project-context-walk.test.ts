/**
 * T3 — `ConfinedRepoDocReader.list`, the project-context document walk.
 *
 * Hermetic: no Docker, no Postgres, no git. Every case builds a real temp
 * directory (the `test/indexer-walk.test.ts` shape) and stands a fake
 * `clonePathFor` in front of it, because the confinement being tested is real
 * filesystem behaviour — `realpath`, a prefix check, `stat` — and a mocked
 * `node:fs` would assert nothing about it.
 *
 * The filename deliberately carries no `.it.` segment: the two CI workflows
 * split the suite on exactly that substring, and a hermetic file named `.it.`
 * would be run in the DB-backed lane (`DDG-TEST-001`).
 *
 * Covers AC-1, AC-2, AC-5, AC-6, AC-7, AC-8, AC-11.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  ConfinedRepoDocReader,
  type RepoDocWalkOptions,
} from '../src/adapters/git/confined-doc.js';
import type { RepoRef } from '@devdigest/shared';

const REPO: RepoRef = { owner: 'acme', name: 'payments-api' };

/** The nine excluded directory names of the spec — passed in, never imported. */
const EXCLUDED = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
  '.pnpm-store',
];

/** The three default roots of AC-2, in the spelling the settings key uses. */
const ROOTS = ['specs/', 'docs/', 'insights/'];

function optionsFor(overrides: Partial<RepoDocWalkOptions> = {}): RepoDocWalkOptions {
  return { roots: ROOTS, excludedDirs: EXCLUDED, maxEntries: 20_000, limit: 500, ...overrides };
}

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

describe('ConfinedRepoDocReader.list', () => {
  let root: string;
  let reader: ConfinedRepoDocReader;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-walk-'));
    reader = new ConfinedRepoDocReader({ clonePathFor: () => root });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists markdown under the roots plus every INSIGHTS.md, in path order', async () => {
    // The exact fixture of T3's Acceptance: two documents under roots, one
    // INSIGHTS.md outside every root, one `.md` outside every root, and two
    // inside excluded directories.
    await writeFileAt(root, 'specs/a.md', '# a');
    await writeFileAt(root, 'docs/sub/b.md', '# b');
    await writeFileAt(root, 'src/c.md', '# c');
    await writeFileAt(root, 'pkg/INSIGHTS.md', '# insights');
    await writeFileAt(root, 'node_modules/p/docs/x.md', '# x');
    await writeFileAt(root, '.pnpm-store/q/docs/y.md', '# y');

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // AC-1 (both match rules), AC-5 (path ascending), AC-7 (excluded dirs).
    expect(result.docs.map((d) => d.path)).toEqual([
      'docs/sub/b.md',
      'pkg/INSIGHTS.md',
      'specs/a.md',
    ]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.entryBudgetExhausted).toBe(false);
  });

  it('matches a root at any depth, not only at the top of the tree', async () => {
    // AC-1, amended 2026-08-19. The originating requirement is
    // an any-depth glob over specs, docs and insights, and the prefix-only reading it
    // replaced was measurably wrong: on this repository, which requires every
    // package to keep its own specs/ and docs/, it returned 17 of 25 documents.
    await writeFileAt(root, 'specs/top.md', '# top');
    await writeFileAt(root, 'server/specs/README.md', '# server spec');
    await writeFileAt(root, 'client/docs/deep/note.md', '# client doc');
    // Anchored on `/` at BOTH ends, so a directory that merely contains a root's
    // name is not a root. Without these two the widened rule would quietly match
    // far more than it was asked to.
    await writeFileAt(root, 'myspecs/no.md', '# no');
    await writeFileAt(root, 'a/specsuite/no.md', '# no');
    // And pruning still beats the widened match: an excluded directory is never
    // descended into, so its nested `docs/` cannot be reached to match at all.
    await writeFileAt(root, 'node_modules/p/docs/x.md', '# no');

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.map((d) => d.path)).toEqual([
      'client/docs/deep/note.md',
      'server/specs/README.md',
      'specs/top.md',
    ]);
  });

  it('descends into no excluded directory, whatever its depth', async () => {
    // AC-7 / EC-2. Each excluded name is planted BOTH at the clone root and
    // nested under a search root, because the rule is on the directory name and
    // not on its position.
    await writeFileAt(root, 'docs/keep.md', '# keep');
    for (const name of EXCLUDED) {
      await writeFileAt(root, `${name}/docs/deep.md`, '# nope');
      await writeFileAt(root, `docs/${name}/deep.md`, '# nope');
      await writeFileAt(root, `docs/${name}/INSIGHTS.md`, '# nope');
    }

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.map((d) => d.path)).toEqual(['docs/keep.md']);
  });

  it('omits a symlink that escapes the clone, and reads no bytes from it', async () => {
    // AC-8 / EC-3. `resolve` refuses it on the post-`realpath` prefix check, so
    // the escaping target never reaches `stat` as a listed document.
    const outside = await mkdtemp(join(tmpdir(), 'project-context-outside-'));
    try {
      await writeFile(join(outside, 'secret.md'), 'PRIVATE');
      await writeFileAt(root, 'docs/real.md', '# real');
      await symlink(join(outside, 'secret.md'), join(root, 'docs', 'escape.md'));

      const result = await reader.list(REPO, optionsFor());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.docs.map((d) => d.path)).toEqual(['docs/real.md']);
      // The pre-cap total excludes it too: a refused candidate is not a
      // document that was merely capped away.
      expect(result.total).toBe(1);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('keeps a symlink that stays inside the clone', async () => {
    // The other half of AC-8: confinement is a prefix check, not a ban on
    // symlinks, so an in-clone link is a legitimate document.
    await writeFileAt(root, 'notes/source.md', '# source');
    await mkdir(join(root, 'docs'), { recursive: true });
    await symlink(join(root, 'notes', 'source.md'), join(root, 'docs', 'linked.md'));

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.map((d) => d.path)).toEqual(['docs/linked.md']);
  });

  it('caps the list at the limit and still reports the pre-cap total', async () => {
    // AC-6, at the spec's own figures: 501 matching documents in, 500 out.
    await Promise.all(
      Array.from({ length: 501 }, (_, i) =>
        writeFileAt(root, `docs/d${String(i).padStart(4, '0')}.md`, '# d'),
      ),
    );

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.length).toBe(500);
    expect(result.total).toBe(501);
    expect(result.truncated).toBe(true);
    // The cap takes a path-ordered PREFIX, not an arbitrary 500.
    expect(result.docs[0]?.path).toBe('docs/d0000.md');
    expect(result.docs[499]?.path).toBe('docs/d0499.md');
  });

  it('reports the entry budget running out rather than truncating silently', async () => {
    await writeFileAt(root, 'docs/a.md', '# a');
    await writeFileAt(root, 'docs/b.md', '# b');
    await writeFileAt(root, 'docs/c.md', '# c');

    const result = await reader.list(REPO, optionsFor({ maxEntries: 2 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entryBudgetExhausted).toBe(true);
    expect(result.docs.length).toBeLessThan(3);
  });

  it('carries size and a last-modified time on every entry', async () => {
    // AC-3's filesystem half — the path, the byte size and the mtime. The token
    // figure and the doc type are the service's, not the walk's.
    await writeFileAt(root, 'specs/a.md', '# a');

    const result = await reader.list(REPO, optionsFor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [doc] = result.docs;
    expect(doc?.size).toBe(3);
    expect(doc?.updatedAt).toBeInstanceOf(Date);
  });

  it('searches only the roots it is given', async () => {
    // AC-2 is the service's default; the walk's half of it is that the roots are
    // a parameter, so a workspace narrowing them narrows the result.
    await writeFileAt(root, 'specs/a.md', '# a');
    await writeFileAt(root, 'docs/b.md', '# b');

    const result = await reader.list(REPO, optionsFor({ roots: ['docs/'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.map((d) => d.path)).toEqual(['docs/b.md']);
  });

  it('tolerates every spelling of a root', async () => {
    await writeFileAt(root, 'specs/a.md', '# a');
    await writeFileAt(root, 'docs/b.md', '# b');

    const result = await reader.list(REPO, optionsFor({ roots: ['/specs', './docs/'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs.map((d) => d.path)).toEqual(['docs/b.md', 'specs/a.md']);
  });

  it('cannot be steered out of the clone by a `..` root', async () => {
    // A root is a filter over relative paths, never a directory the walk starts
    // from, so a traversal-shaped setting selects nothing instead of escaping.
    await writeFileAt(root, 'specs/a.md', '# a');

    const result = await reader.list(REPO, optionsFor({ roots: ['../..'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.docs).toEqual([]);
  });

  it('refuses rather than throws when the repository has no clone', async () => {
    // AC-11. The wording is the one `resolve` already returns for a missing
    // clone, so the envelope reads the same however the caller arrived at it.
    const missing = new ConfinedRepoDocReader({
      clonePathFor: () => join(root, 'no-such-clone'),
    });

    const result = await missing.list(REPO, optionsFor());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toBe('the repository has no local clone');
  });
});
