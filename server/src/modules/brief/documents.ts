/**
 * The effective document set: whose documents, in what order, how big they are,
 * and — only inside a generation — what they say.
 *
 * AC-59's union, in one place. The set is the union of the effective document
 * sets of the ENABLED agents of the pull request's repository, deduplicated by
 * path with the first occurrence winning, ordered by agent and then by
 * attachment order. It is defined once here because this feature needs it TWICE
 * and must not define it twice: on the hot `GET /pulls/:id` path it contributes
 * paths and byte sizes to the cache key, and inside a generation it contributes
 * text. A second definition would drift, and the two answers would disagree
 * about which documents a brief was generated from.
 *
 * WHY A `stat` AND NOT A READ, on the key path. `listEffectiveDocs` returns
 * metadata only — no clone read, no text, no token count — which is what makes a
 * key computation cheap enough to sit on a pull-request detail read at all;
 * `resolveForRun`, the method that already existed, opens every document it
 * keeps. The sizes then come from one `list` walk, which reports `size` from
 * `stat` without opening a single file. A path the walk did not report
 * contributes size `0` and a recorded note rather than being silently omitted
 * from the key: a document that has been deleted from the clone must change the
 * key, and a document the walk's entry budget never reached must be visible as
 * such (Q2).
 *
 * WHY THE PREDICATE IS AN EXACT SET. The walk's default rule is "any `*.md`
 * under one of `roots`, plus any `INSIGHTS.md` anywhere", which is Project
 * Context's rule for DISCOVERING documents. This module is not discovering
 * anything — the set is already decided, by a person, and all that is wanted is
 * the size of each named path. So `match` is exact membership, which cannot
 * report a document nobody attached, and cannot miss one because of an extension
 * this feature never enumerated. `roots` is supplied alongside it because the
 * option is required and the directories the set lives in are what the walk
 * would fall back to; the predicate takes precedence, and neither widens
 * confinement — `resolve` still refuses a symlink pointing out of the clone.
 *
 * The four bounds of the walk are this module's (`constants.ts`), because
 * `src/adapters/**` may import nothing from `src/modules/**`: the adapter
 * enforces the bounds and the feature chooses them. `roots` is the one that is
 * NOT a constant — it is the directories the effective set's own paths live in,
 * so it is computed here.
 *
 * No file of this module imports a Node builtin, so a path's parent directory is
 * taken by string, not by a path helper — see {@link docWalkRoots}.
 */
import type { ContextDocSource } from '@devdigest/shared';
import type { CacheKeyDoc } from './cache-key.js';
import {
  EXCLUDED_DIR_NAMES,
  MAX_DIRECTORY_ENTRIES,
  MAX_DOCUMENT_BYTES,
  MAX_LISTED_DOCS,
} from './constants.js';
import type { BriefAgentLister, BriefDocReader, BriefDocSetReader, BriefRepoRef } from './types.js';

/** One document of the union, with the agent it entered the set through. */
export interface EffectiveDoc {
  /** Repo-relative, as the attachment recorded it. */
  path: string;
  /** The agent whose effective set contributed it FIRST — its position in the union. */
  agentId: string;
  /** Attached directly, or inherited through an enabled skill. */
  source: ContextDocSource;
  /** Position within that agent's own effective set. */
  order: number;
}

/** A document of the union, plus the size the cache key digests. */
export interface SizedDoc extends EffectiveDoc {
  /** Bytes from `stat`, or `0` when the walk did not report this path. */
  size: number;
  /** False when the size is the `0` stand-in rather than a measurement. */
  sized: boolean;
  /** Why the size is missing, or null when it was measured. */
  note: string | null;
}

/**
 * A document's text, or the reason there is none. Never a throw.
 *
 * The `ok` variant carries a `note` too, and it is not decoration: a document the
 * walk never sized still contributed `0` to the cache key, and the assembly
 * records that on the source entry so the audit trail says which figure was a
 * measurement and which was a stand-in (AC-33).
 */
export type LoadedDoc = { path: string } & (
  | { ok: true; text: string; note: string | null }
  | { ok: false; note: string }
);

/** The two ports this file's collection step needs — a `Container` satisfies it. */
export interface DocSetDeps {
  readonly agents: BriefAgentLister;
  readonly projectContext: BriefDocSetReader;
}

/**
 * The union of the enabled agents' effective document sets (AC-59).
 *
 * Ordered by agent and then by attachment order, deduplicated by path with the
 * FIRST occurrence winning — so a document two agents both attach is read once,
 * at the position the first agent gave it, and a change to the second agent's
 * attachments does not reorder the prompt.
 *
 * `listEffectiveDocs` already drops a cross-repository attachment and a document
 * reached through a DISABLED skill, so neither is filtered again here: one
 * definition of "effective", one place it lives.
 *
 * The agents are listed inside the caller's workspace; every document read below
 * is scoped by the repository. Both scopes are already established by the time
 * this runs — the pull request was resolved within the workspace first (AC-35).
 */
export async function collectEffectiveDocSet(
  deps: DocSetDeps,
  workspaceId: string,
  repoId: string,
): Promise<EffectiveDoc[]> {
  const agents = await deps.agents.listEnabled(workspaceId);

  // `Promise.all` preserves the agents' order, which IS the union's order.
  const perAgent = await Promise.all(
    agents.map((agent) => deps.projectContext.listEffectiveDocs(agent.id, repoId)),
  );

  const seen = new Set<string>();
  const out: EffectiveDoc[] = [];
  for (const [index, docs] of perAgent.entries()) {
    const agent = agents[index];
    if (!agent) continue;
    for (const doc of docs) {
      if (seen.has(doc.path)) continue;
      seen.add(doc.path);
      out.push({ path: doc.path, agentId: agent.id, source: doc.source, order: doc.order });
    }
  }
  return out;
}

/**
 * The directories the set's own paths live in, deduplicated and sorted.
 *
 * A document at the clone root contributes `'.'`, which the walk reads as "the
 * clone itself" — the same spelling its own root normaliser accepts. Sorted so
 * two runs over the same set produce the same options object, which keeps a walk
 * reproducible when its entry budget is the binding constraint.
 */
export function docWalkRoots(docs: readonly { path: string }[]): string[] {
  const roots = new Set<string>();
  for (const doc of docs) {
    const cut = doc.path.lastIndexOf('/');
    roots.add(cut <= 0 ? '.' : doc.path.slice(0, cut));
  }
  return [...roots].sort();
}

/**
 * Each document's size in bytes, from one walk that opens no file.
 *
 * A failed walk — no clone yet, most often — is a VALUE and not an error: every
 * document comes back with size `0` and the walk's own note, the key changes
 * because the sizes changed, and the generation records `unfetched` sources
 * rather than throwing out of a read.
 */
export async function sizeEffectiveDocs(
  repoDocs: BriefDocReader,
  repo: BriefRepoRef,
  docs: readonly EffectiveDoc[],
): Promise<SizedDoc[]> {
  if (docs.length === 0) return [];

  const wanted = new Set(docs.map((doc) => doc.path));
  const walk = await repoDocs.list(repo, {
    roots: docWalkRoots(docs),
    excludedDirs: EXCLUDED_DIR_NAMES,
    maxEntries: MAX_DIRECTORY_ENTRIES,
    limit: MAX_LISTED_DOCS,
    match: (_name, rel) => wanted.has(rel),
  });

  if (!walk.ok) {
    return docs.map((doc) => ({ ...doc, size: 0, sized: false, note: walk.note }));
  }

  const sizes = new Map(walk.docs.map((entry) => [entry.path, entry.size]));

  // Why a reported path might be missing, said once rather than guessed per
  // document: a spent entry budget makes the walk's own answer a floor, and the
  // document cap makes it a prefix.
  const shortfall = walk.entryBudgetExhausted
    ? 'the walk ran out of its directory-entry budget before reaching it'
    : walk.truncated
      ? `the walk reported its first ${MAX_LISTED_DOCS} documents only`
      : 'the walk did not report this path — it is missing from the clone, or outside it';

  return docs.map((doc) => {
    const size = sizes.get(doc.path);
    return size === undefined
      ? { ...doc, size: 0, sized: false, note: shortfall }
      : { ...doc, size, sized: true, note: null };
  });
}

/** The set as the cache key reads it: path and size, in effective order (AC-2). */
export function cacheKeyDocs(docs: readonly SizedDoc[]): CacheKeyDoc[] {
  return docs.map((doc) => ({ path: doc.path, size: doc.size }));
}

/**
 * The documents' texts — the generation path only, never the key path.
 *
 * The size cap is checked BEFORE a byte is read, which is the whole point of the
 * walk having reported sizes: a binary blob given a `.md` name is refused
 * without being opened. A document the walk never sized is still attempted, on
 * the grounds that the read is the more authoritative answer of the two and it
 * refuses safely; what it must not do is silently contribute nothing, so a
 * refusal comes back as a note the assembly records as `unfetched`.
 *
 * Sequential rather than concurrent, following `modules/intent/sources.ts`: the
 * set is what a person attached, so it is small, and a generation already has a
 * 75 s call ahead of it that dwarfs the reads.
 */
export async function readEffectiveDocs(
  repoDocs: BriefDocReader,
  repo: BriefRepoRef,
  docs: readonly SizedDoc[],
): Promise<LoadedDoc[]> {
  const out: LoadedDoc[] = [];
  for (const doc of docs) {
    if (doc.sized && doc.size > MAX_DOCUMENT_BYTES) {
      out.push({
        path: doc.path,
        ok: false,
        note: `${doc.size} bytes, past the ${MAX_DOCUMENT_BYTES}-byte read cap`,
      });
      continue;
    }
    const read = await repoDocs.read(repo, doc.path);
    out.push(
      read.ok
        ? // A readable document that the walk never sized IS still `used`: the
          // read is the more authoritative of the two answers, and calling it
          // `unfetched` would report a gap that does not exist. The sizing note
          // travels with it so the entry says the key's `0` was a stand-in.
          { path: doc.path, ok: true, text: read.text, note: doc.sized ? null : doc.note }
        : { path: doc.path, ok: false, note: read.note },
    );
  }
  return out;
}
