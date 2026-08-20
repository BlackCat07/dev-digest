/**
 * The cache key a stored brief is compared against — pure, and the whole of
 * AC-2.
 *
 * WHY NOT THE HEAD SHA. A brief keyed on `head_sha` alone caches a title-only
 * answer forever, and this codebase has already paid for that exact mistake:
 * `pull_requests.body` and `pr_files` are written ONLY by `GET /pulls/:id`,
 * while `head_sha` is also written by the pull-request LIST route — so a
 * derivation triggered from the list has a stable SHA and no description and no
 * changed files, and a SHA-keyed freshness rule can never notice the material
 * arriving afterwards. Measured on real data: 15 of 21 `pr_intent` rows derived
 * from the title alone, at the confidence floor (`server/INSIGHTS.md`,
 * 2026-08-11). The key below is over the STATE, not over the commit.
 *
 * WHAT THE KEY DELIBERATELY CANNOT CATCH, and why that is not a defect: an
 * issue body edited on GitHub, and a document rewritten to the same byte size.
 * Both are invisible to every value here, both would need a network call or a
 * full clone read to detect, and the `force` path exists for exactly them
 * (EC-9, EC-10). Sizes come from `stat`, so the key stays cheap enough to
 * compute on the pull-request detail read.
 *
 * THE ORDER OF THE FILE LIST IS THIS FILE'S OWN, and that is load-bearing.
 * `getPrFiles` issues no `ORDER BY`, so the rows arrive in whatever order
 * Postgres read the heap — and a heap order moves the instant any row of the
 * table is updated, because Postgres writes a new tuple version elsewhere
 * (`server/INSIGHTS.md`, 2026-08-06, where exactly this made a list "reorder
 * itself" and was reported as a feature). A key derived from that order would
 * change without the pull request changing and regenerate a brief for free, so
 * the lines below are sorted into a total order before they are digested. The
 * PROMPT's order is a different question with a different answer — role first,
 * `pr_files` order within a role (AC-60) — and the two must not be confused.
 *
 * `pr_files` also carries no unique constraint on `(pr_id, path)`, so the list
 * is deduplicated by path before it is digested or shown; a duplicate row would
 * otherwise double-count a path in both the key and the prompt (EC-4).
 *
 * NO CRYPTOGRAPHIC HASH, and no `node:` import. Nothing under this module
 * imports a Node builtin — the invariant is a grep gate of this feature's own
 * (`modules/brief/` must contain no `node:` import specifier), because a feature
 * module reaching for the filesystem is invisible to `.dependency-cruiser.cjs`
 * (`server/INSIGHTS.md`, 2026-08-10). The digest below is therefore a pure
 * function, and that is sound for what it is: a CHANGE DETECTOR, not a security
 * primitive. Nothing is authenticated by this value and nothing is authorised by
 * it; the worst outcome of a collision is a stale brief on one pull request,
 * which the regenerate control clears. Three independent 32-bit lanes plus the
 * canonical length are digested, so a collision needs three simultaneous ones.
 */
import type { BlastStatus, IntentStatus } from '@devdigest/shared';
import { BRIEF_FORMAT_VERSION } from './constants.js';
import type { BriefPrFile } from './types.js';

/**
 * The intent's contribution: its status and when it was derived.
 *
 * Narrowed to two fields rather than taking `BriefIntentFacts`, which satisfies
 * this structurally — the key must move when a re-derivation happens even if the
 * text it produced is identical, and `derived_at` is the only value that says
 * so. The intent's own `head_sha` is deliberately NOT here: the pull request's
 * head SHA is already a key value, and a second copy of it would add nothing.
 */
export interface CacheKeyIntent {
  status: IntentStatus;
  /** ISO, or null when nothing has been derived. */
  derived_at: string | null;
}

/**
 * The blast map's contribution: its status and the commit its index was built
 * at.
 *
 * The map itself is derived fresh on every read and has no row, so there is no
 * "derived at" to read. `indexed_sha` is what changes when the index is rebuilt,
 * and `status` is what changes when a rebuild moves the map from `partial` to
 * `ok` without moving the SHA.
 */
export interface CacheKeyBlast {
  status: BlastStatus;
  indexed_sha: string | null;
}

/** One document of the effective set, as the key sees it: a path and a size. */
export interface CacheKeyDoc {
  path: string;
  /** Bytes, from `stat`. `0` for a path the walk did not report — see `documents.ts`. */
  size: number;
}

/**
 * Everything the key is computed from — the nine values AC-2 names, plus the
 * brief-format version.
 *
 * On the count: AC-2 enumerates the pull request's head SHA, its title, its
 * description, its changed-file list, the intent's status, the intent's
 * derived-at time, the blast map's status, the blast map's indexed SHA, and the
 * effective document set — nine values, each of which can change while the
 * others are held, which is precisely what the criterion's observable asks of
 * them. The brief-format version is the tenth ingredient and is not one of the
 * nine: it is a constant of THIS CODE rather than a fact about the pull request,
 * and it exists so that a change to the prompt, the schema or the grounding
 * rules can invalidate every stored brief in one step — none of the nine would
 * move for it.
 */
export interface CacheKeyState {
  /** Null only for a pull request row that has never carried one. */
  headSha: string | null;
  title: string;
  /** The description. Null and empty are digested identically — both mean none. */
  body: string | null;
  /** The raw `pr_files` rows, in any order. Deduplicated and sorted below. */
  files: readonly BriefPrFile[];
  /** Null when no intent has ever been derived for this pull request. */
  intent: CacheKeyIntent | null;
  blast: CacheKeyBlast;
  /** In EFFECTIVE order — the order is part of the value (AC-2, AC-59). */
  docs: readonly CacheKeyDoc[];
}

/**
 * One entry per path, first occurrence winning, input order preserved.
 *
 * The PROMPT's deduplication: the list the model is shown keeps the order it
 * arrived in, because `orderChangedFilesByRole` preserves the input's order
 * within each role (AC-60) and re-sorting here would quietly overrule it.
 *
 * Idempotent, so it is safe for the caller to apply it once for both consumers
 * and for each consumer to apply it again — which is the point. AC-2's list and
 * the prompt's list must be the same set of paths, and the cheapest way to
 * guarantee that is for neither to be able to skip the step.
 */
export function dedupeFilesByPath<T extends { readonly path: string }>(
  files: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push(file);
  }
  return out;
}

/**
 * The nine values, rendered as one canonical string in a fixed order.
 *
 * Exported because it is the only readable way to test the key: a digest can
 * only be asserted as "different from the other one", while this can be asserted
 * as "carries the description". Every segment is LENGTH-PREFIXED — `label:n:`
 * then exactly n characters — so no value can imitate a separator and no two
 * different states can render the same string. A pull request titled
 * `\ntitle:5:hello` is the reason that matters.
 */
export function renderCacheKeyState(state: CacheKeyState): string {
  const files = canonicalFileLines(state.files);
  const docs = state.docs.map((doc) => `${doc.path}:${doc.size}`).join('\n');

  return [
    segment('head', state.headSha ?? ''),
    segment('title', state.title),
    segment('body', state.body ?? ''),
    segment('files', files),
    segment('intent_status', state.intent?.status ?? ''),
    segment('intent_at', state.intent?.derived_at ?? ''),
    segment('blast_status', state.blast.status),
    segment('blast_sha', state.blast.indexed_sha ?? ''),
    segment('docs', docs),
    segment('format', String(BRIEF_FORMAT_VERSION)),
  ].join('\n');
}

/**
 * The digest a stored brief records and a read compares against (AC-2, AC-3).
 *
 * Deterministic and total: the same state always produces the same key, and
 * every state produces one — there is no failure mode here for a caller to
 * handle, which is what lets the read path compare unconditionally.
 */
export function computeCacheKey(state: CacheKeyState): string {
  const canonical = renderCacheKeyState(state);

  // Three lanes over one pass. Two FNV-1a variants (same prime, different
  // offset bases) and a djb2-xor, each with a different mixing shape, so a pair
  // of inputs that collides in one lane will not collide in the others.
  let fnvA = 0x811c9dc5;
  let fnvB = 0x01000193;
  let djb2 = 5381;

  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    fnvA = Math.imul(fnvA ^ code, FNV_PRIME);
    fnvB = Math.imul(fnvB ^ code, FNV_PRIME);
    djb2 = (Math.imul(djb2, 33) ^ code) | 0;
  }

  return [hex32(fnvA), hex32(fnvB), hex32(djb2), canonical.length.toString(16)].join('-');
}

/** FNV-1a's 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * The changed-file list as `path:additions:deletions`, one per line, in a TOTAL
 * order.
 *
 * Sorted by path, then by the two counts, and only then deduplicated by path.
 * The sort before the dedup is what makes the result independent of the order
 * `pr_files` happened to return: if a duplicate pair really does disagree about
 * its counts, the same one wins every time rather than whichever the heap read
 * first. See the file header for why an unstable order here would regenerate
 * briefs for free.
 */
function canonicalFileLines(files: readonly BriefPrFile[]): string {
  const sorted = [...files].sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.additions - b.additions || a.deletions - b.deletions,
  );

  return dedupeFilesByPath(sorted)
    .map((file) => `${file.path}:${file.additions}:${file.deletions}`)
    .join('\n');
}

/** `label:<length>:<value>` — see `renderCacheKeyState` on why the length is there. */
function segment(label: string, value: string): string {
  return `${label}:${value.length}:${value}`;
}

/** Unsigned, zero-padded, eight hex digits. */
function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
