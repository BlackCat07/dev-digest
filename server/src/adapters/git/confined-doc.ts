import path from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
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
 *
 * WHY THE WALK LIVES HERE TOO. `list` below is a recursive directory walk, and
 * the same `modules-no-raw-sdk` blind spot applies to it: a feature module doing
 * `readdir` on a clone passes the architecture gate cleanly, so the walk would be
 * invisible to the one tool that guards this ring. More importantly the walk has
 * to make the SAME confinement decision the read makes — a `*.md` that is really
 * a symlink out of the clone must not be listed either — and the only way to
 * guarantee the two agree is for both to go through the one private `resolve`.
 * That is why `list` resolves every candidate it is about to report rather than
 * trusting the walk's own path arithmetic.
 *
 * Everything the walk is bounded by — which roots to search, which directory
 * names to skip, how many directory entries to visit, how many documents to
 * return, and WHICH FILENAMES COUNT — arrives as a PARAMETER.
 * `src/adapters/**` must import nothing from `src/modules/**`
 * (`adapters-are-leaves`), so the caller owns those values. That is why the
 * candidate rule is an optional `match` predicate rather than a list of
 * feature-specific filenames baked in here: onboarding needs `package.json`,
 * `Makefile` and `docker-compose*.yml`, Project Context needs `*.md`, and
 * neither vocabulary belongs to this ring. A predicate cannot widen
 * confinement — it only proposes candidates, and every candidate still goes
 * through `resolve` before it is reported.
 */

/** Either the document's text, or the reason it was refused — never a throw. */
export type RepoDocRead = { ok: true; text: string } | { ok: false; note: string };

/**
 * One document the walk is prepared to report.
 *
 * `size` and `updatedAt` come from `stat`; no byte of the file is ever read by
 * the walk, which is what makes listing a hostile clone cheap and safe.
 */
export interface RepoDocEntry {
  /** Repo-relative, forward-slash separated, whatever the host separator is. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** Last-modified time, or null when the filesystem reported none. */
  updatedAt: Date | null;
}

/** The bounds of one walk. All four are caller-owned — see the file doc-comment. */
export interface RepoDocWalkOptions {
  /**
   * Repo-relative directory names under which any `*.md` counts, e.g.
   * `['specs/', 'docs/']`. Trailing and leading slashes are tolerated.
   *
   * These are a FILTER over relative paths, never a path handed to the
   * filesystem: the walk always starts at the clone root and descends, so a root
   * of `../..` selects nothing rather than steering the walk out of the clone.
   */
  roots: readonly string[];
  /** Directory names never descended into, at any depth. */
  excludedDirs: readonly string[];
  /** Hard ceiling on directory entries visited, so a committed package cache
   *  cannot consume a whole request. */
  maxEntries: number;
  /** Maximum number of documents returned; `total` still reports the pre-cap count. */
  limit: number;
  /**
   * Which files count, replacing the default `*.md`-under-a-root rule entirely.
   *
   * `name` is the entry's basename, `rel` its repo-relative, forward-slash path.
   * Omit it and the default rule applies verbatim, so every existing caller —
   * `modules/project-context` — is behaviour-identical.
   *
   * The predicate does NOT need the excluded-directory set: the walk prunes
   * those before a candidate is ever offered to it. Nor does it decide safety:
   * `resolve` still refuses an escaping symlink, so a permissive predicate
   * widens what is LISTED, never what is reachable.
   */
  match?: (name: string, rel: string) => boolean;
}

/**
 * The walk's result, or the reason there is none — never a throw, for the same
 * reason `read` never throws: the caller renders the refusal as a state.
 */
export type RepoDocWalk =
  | {
      ok: true;
      /** Confined, path-ascending, at most `limit` long. */
      docs: RepoDocEntry[];
      /** Confined matches found BEFORE `limit` was applied. */
      total: number;
      /** `total > docs.length` — the caller shows both figures. */
      truncated: boolean;
      /** `maxEntries` ran out mid-walk, so `total` is itself a floor. */
      entryBudgetExhausted: boolean;
    }
  | { ok: false; note: string };

/**
 * The wording `resolve` returns when the clone directory is not on disk.
 *
 * Kept verbatim so a missing clone reads the same whether the caller asked for
 * one document or for the list.
 */
const NO_CLONE_NOTE = 'the repository has no local clone';

/** Matched anywhere outside the excluded directories, not only under a root. */
const ALWAYS_MATCHED_FILENAME = 'INSIGHTS.md';

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
   * List the documents in `repo`'s clone, or explain why there are none.
   *
   * Two match rules by default, and the second is load-bearing rather than a
   * convenience: any `*.md` under one of `options.roots`, PLUS any file named
   * `INSIGHTS.md` anywhere outside the excluded directories. This repository
   * keeps no `insights/` directory — its insights live as an `INSIGHTS.md` at
   * each package root — so a roots-only walk would find none of them. A caller
   * that supplies `options.match` replaces both rules with its own; a caller
   * that does not gets exactly the behaviour above.
   *
   * Every candidate goes through `resolve` before it is reported, so a `*.md`
   * whose real path leaves the clone is omitted and no byte of it is read. The
   * walk itself never follows a symlinked DIRECTORY (that is what bounds a
   * symlink loop); a symlinked FILE is deliberately left as a candidate so the
   * decision to refuse it is `resolve`'s, exactly as it is for `read`.
   */
  async list(repo: RepoRef, options: RepoDocWalkOptions): Promise<RepoDocWalk> {
    const root = this.git.clonePathFor(repo);
    // Same first gate as `resolve`, and the same wording: without a clone there
    // is nothing to walk, and that is a value the caller renders, not an error.
    const realRoot = await realpath(root).catch(() => null);
    if (!realRoot) return { ok: false, note: NO_CLONE_NOTE };

    const budget: EntryBudget = { left: options.maxEntries, exhausted: false };
    const candidates: string[] = [];
    await collectCandidates(realRoot, realRoot, {
      roots: normalizeRoots(options.roots),
      excluded: new Set(options.excludedDirs),
      match: options.match,
      budget,
      out: candidates,
    });

    // Path ascending. A path is unique within a clone, so this is already a
    // total order and the cap below takes a reproducible prefix of it.
    candidates.sort();

    const docs: RepoDocEntry[] = [];
    let total = 0;
    for (const candidate of candidates) {
      const resolved = await this.resolve(root, candidate);
      if (!resolved.path) continue;
      // `resolve` returns the real path only, so the size and mtime are read
      // here rather than plumbed out of it — the confinement logic is not this
      // task's to reshape.
      const stats = await stat(resolved.path).catch(() => null);
      if (!stats) continue;

      total += 1;
      if (docs.length >= options.limit) continue;
      const mtime = stats.mtime;
      docs.push({
        path: candidate,
        size: stats.size,
        updatedAt: Number.isNaN(mtime.getTime()) ? null : mtime,
      });
    }

    return {
      ok: true,
      docs,
      total,
      truncated: total > docs.length,
      entryBudgetExhausted: budget.exhausted,
    };
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

/** Mutable so one budget is shared across the whole recursion. */
interface EntryBudget {
  left: number;
  exhausted: boolean;
}

/** `null` roots mean "the whole clone" — see `normalizeRoots`. */
type NormalizedRoots = string[] | null;

interface CollectArgs {
  roots: NormalizedRoots;
  excluded: ReadonlySet<string>;
  /** Caller-supplied candidate rule; `undefined` means the default one. */
  match?: (name: string, rel: string) => boolean;
  budget: EntryBudget;
  out: string[];
}

/**
 * Reduce caller-supplied roots to the prefixes `isUnderRoot` compares against.
 *
 * `'docs/'`, `'/docs'`, `'./docs'` and `'docs'` all mean the same directory, and
 * a workspace setting will contain all four spellings sooner or later. A root
 * that normalizes to nothing (`''`, `'.'`, `'/'`) means the clone itself, which
 * is returned as `null` — "every `*.md` matches" — rather than as an empty
 * prefix that would accidentally match nothing.
 */
function normalizeRoots(roots: readonly string[]): NormalizedRoots {
  const out: string[] = [];
  for (const raw of roots) {
    const cleaned = raw
      .split(path.sep)
      .join('/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (cleaned === '' || cleaned === '.') return null;
    out.push(cleaned);
  }
  return out;
}

/**
 * A root matches at ANY depth, not only at the top of the tree.
 *
 * `specs/` therefore selects `specs/a.md` and `server/specs/a.md` alike. That is
 * the originating requirement's any-depth glob over `specs`, `docs` and
 * `insights`, and the
 * prefix-only reading it replaced (2026-08-19) was measurably wrong here: this
 * repository requires every package to keep its own `specs/` and `docs/`, so the
 * old rule missed eight of the twenty-five documents on the very repository the
 * feature is demonstrated against.
 *
 * Both arms are anchored on `/` so a root is matched as a whole path SEGMENT:
 * without that, root `specs` would also select `myspecs/a.md`. Excluded
 * directories are pruned by the walk before this is ever reached, so
 * `node_modules/p/docs/x.md` cannot arrive here to match `docs`.
 */
function isUnderRoot(rel: string, roots: NormalizedRoots): boolean {
  if (roots === null) return true;
  return roots.some((root) => rel.startsWith(`${root}/`) || rel.includes(`/${root}/`));
}

/**
 * The default rule is unchanged and applies whenever no `match` is supplied, so
 * a caller that passes none walks exactly the tree it walked before. A supplied
 * predicate replaces the rule outright — including `ALWAYS_MATCHED_FILENAME`,
 * which stays a constant of the default rule rather than becoming an option,
 * because it exists for Project Context's any-depth `INSIGHTS.md` and means
 * nothing to a caller looking for `package.json`.
 */
function isCandidate(
  name: string,
  rel: string,
  roots: NormalizedRoots,
  match?: (name: string, rel: string) => boolean,
): boolean {
  if (match) return match(name, rel);
  if (name === ALWAYS_MATCHED_FILENAME) return true;
  return path.extname(name).toLowerCase() === '.md' && isUnderRoot(rel, roots);
}

/**
 * Collect repo-relative candidate paths under `dir`, depth-first.
 *
 * Nothing here decides whether a path is safe — that is `resolve`'s job on the
 * way out. This function only bounds the work: it refuses to enter an excluded
 * directory, refuses to follow a symlinked directory (a symlink loop would
 * otherwise be limited only by the entry budget), and stops entirely once the
 * budget is spent, recording that it did so.
 */
async function collectCandidates(realRoot: string, dir: string, args: CollectArgs): Promise<void> {
  const { roots, excluded, match, budget, out } = args;
  if (budget.left <= 0) {
    budget.exhausted = true;
    return;
  }

  // An unreadable directory (permissions, dangling symlink) is skipped cleanly
  // so the rest of the clone still lists.
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;

  for (const entry of entries) {
    if (budget.left <= 0) {
      budget.exhausted = true;
      return;
    }
    budget.left -= 1;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (excluded.has(entry.name)) continue;
      await collectCandidates(realRoot, full, args);
      continue;
    }
    // `isDirectory()` is false for a symlink, so a symlinked directory lands
    // here and is never descended into. A symlinked FILE stays a candidate on
    // purpose: `resolve` is the single place that decides it escapes the clone.
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const rel = path.relative(realRoot, full).split(path.sep).join('/');
    if (!isCandidate(entry.name, rel, roots, match)) continue;
    out.push(rel);
  }
}
