import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { GitClient, RepoRef } from '@devdigest/shared';

/**
 * Reading a repo-relative document out of an existing clone, path-confined.
 *
 * WHY THIS IS AN ADAPTER. The candidate path comes out of a pull request
 * description, which is author-controlled, so `../../../etc/passwd`,
 * `/etc/passwd` and a checked-in symlink pointing out of the tree are all things
 * a hostile author can write. Enforcing that is filesystem work — `realpath`,
 * `stat`, a prefix check — and filesystem work belongs in `src/adapters/`, not
 * in a feature module. `modules/intent/sources.ts` previously did it inline with
 * its own `node:fs` import, which no gate could see: `.dependency-cruiser.cjs`'s
 * `modules-no-raw-sdk` rule lists SDKs (`octokit`, `openai`, `postgres`, …) and
 * not `node:fs`, so the module read the disk directly while the architecture
 * gate reported clean.
 *
 * It is deliberately NOT an extra method on the `GitClient` port:
 * `src/vendor/shared/` is the coordination-only cross-package contract, and this
 * capability has exactly one consumer. The intent module declares the shape it
 * needs (`RepoDocReader`, in `modules/intent/sources.ts`) and this class
 * satisfies it STRUCTURALLY — the same arrangement `IntentStore` already has
 * with `ReviewRepository`. Nothing here imports from `modules/`, so the
 * dependency still points inward.
 *
 * `GitClient.readFile` is not reused for the final read either, and that is the
 * one thing to preserve if this is ever refactored: it joins and reads in a
 * single step, which would drop the post-`realpath` re-check that is the only
 * defence against an escaping symlink.
 */

/** Either the document's text, or the reason it was refused — never a throw. */
export type RepoDocRead = { ok: true; text: string } | { ok: false; note: string };

export class ConfinedRepoDocReader {
  /** Only `clonePathFor` is needed: a pure, synchronous path computation. */
  constructor(private git: Pick<GitClient, 'clonePathFor'>) {}

  /**
   * Read `candidate` from `repo`'s clone, or explain why it was not read.
   *
   * Every refusal is a value, not an exception, because the caller records each
   * one as an `unfetched` source with its reason — a gap on the intent card is
   * the product behaviour, so a throw would have to be caught and converted
   * anyway.
   */
  async read(repo: RepoRef, candidate: string): Promise<RepoDocRead> {
    const resolved = await this.resolve(this.git.clonePathFor(repo), candidate);
    if (!resolved.path) return { ok: false, note: resolved.note };

    const contents = await readFile(resolved.path, 'utf8').catch((error: Error) => error);
    if (contents instanceof Error) return { ok: false, note: contents.message };
    return { ok: true, text: contents };
  }

  /**
   * Resolve a body-supplied path inside the clone, or refuse it.
   *
   * PATH CONFINEMENT IS MANDATORY HERE and this is the only place it is
   * enforced. Four independent gates, each stopping a different attack:
   *
   *  - an absolute path is refused outright;
   *  - `path.resolve(root, candidate)` must start with `root + path.sep`, which
   *    is what stops `..`;
   *  - the REAL path (symlinks followed) is checked against the real root as
   *    well, which is what stops a checked-in symlink escaping the clone;
   *  - only a regular file is read, so a fifo cannot hang the derivation.
   *
   * The root itself is realpath'd first because a clone directory under a
   * symlinked parent (`/var` → `/private/var` on macOS) would otherwise fail the
   * prefix check for every candidate.
   */
  private async resolve(
    root: string,
    candidate: string,
  ): Promise<{ path: string | null; note: string }> {
    if (path.isAbsolute(candidate)) {
      return { path: null, note: 'outside the repository' };
    }
    const realRoot = await realpath(root).catch(() => null);
    if (!realRoot) return { path: null, note: 'the repository has no local clone' };

    const target = path.resolve(realRoot, candidate);
    if (!target.startsWith(realRoot + path.sep)) {
      return { path: null, note: 'outside the repository' };
    }
    const real = await realpath(target).catch(() => null);
    if (!real) return { path: null, note: 'no such file in the repository' };
    if (!real.startsWith(realRoot + path.sep)) {
      return { path: null, note: 'outside the repository' };
    }
    const stats = await stat(real).catch(() => null);
    if (!stats?.isFile()) return { path: null, note: 'not a regular file' };
    return { path: real, note: '' };
  }
}
