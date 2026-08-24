import { describe, it, expect } from 'vitest';
import {
  computeCacheKey,
  dedupeFilesByPath,
  renderCacheKeyState,
  type CacheKeyState,
} from '../src/modules/brief/cache-key.js';
import {
  BRIEF_FORMAT_VERSION,
  MAX_DOCUMENT_BYTES,
} from '../src/modules/brief/constants.js';
import {
  cacheKeyDocs,
  collectEffectiveDocSet,
  docWalkRoots,
  readEffectiveDocs,
  sizeEffectiveDocs,
  type EffectiveDoc,
} from '../src/modules/brief/documents.js';
import type {
  BriefDocReader,
  BriefRepoRef,
  RepoDocWalk,
  RepoDocWalkOptions,
} from '../src/modules/brief/types.js';

/**
 * L05 — the PR Brief cache key (AC-2, AC-3), and EC-4.
 *
 * Hermetic and pure: no database, no clone, no provider, no clock. The key is a
 * function of one plain object.
 *
 * The criterion's observable is asserted the way the criterion states it —
 * "changing any one of those nine values, with the other eight held, produces a
 * different key" — as a table of nine single-value mutations rather than as nine
 * prose assertions, so a value silently dropped out of the digest fails here and
 * not four waves later. The tenth ingredient, the brief-format version, is a
 * constant of the code rather than one of the nine and is asserted separately.
 *
 * Two properties beyond the criterion get their own tests because both are ways
 * the key could be WRONG while every equality above still held: the digest must
 * not move when only the physical order of `pr_files` moves (a heap order moves
 * on any UPDATE to the table, so a key that saw it would regenerate briefs for
 * free — `server/INSIGHTS.md`, 2026-08-06), and a duplicate `(pr_id, path)` row
 * must not count twice (`pr_files` has no unique constraint on the pair — EC-4).
 */

/** A `pr_files` row, narrowed to what the key reads. */
function file(path: string, additions = 1, deletions = 0) {
  return { path, additions, deletions };
}

/**
 * A pull request whose every one of the nine values is present and distinctive.
 *
 * A fresh object per call, so a mutation in one case cannot leak into the next.
 */
function baseState(): CacheKeyState {
  return {
    headSha: 'a'.repeat(40),
    title: 'Rate-limit the review endpoint',
    body: 'Closes #12. The endpoint is currently unbounded.',
    files: [file('src/api/rate-limit.ts', 40, 2), file('pnpm-lock.yaml', 900, 3)],
    intent: { status: 'ok', derived_at: '2026-08-19T10:00:00.000Z' },
    blast: { status: 'ok', indexed_sha: 'b'.repeat(40) },
    docs: [
      { path: 'docs/README.md', size: 1200 },
      { path: 'specs/api.md', size: 340 },
    ],
  };
}

/** One named single-value mutation, applied to a fresh base state. */
const MUTATIONS: readonly { value: string; mutate: (state: CacheKeyState) => void }[] = [
  { value: 'head SHA', mutate: (s) => void (s.headSha = 'c'.repeat(40)) },
  { value: 'title', mutate: (s) => void (s.title = 'Rate-limit the review endpoints') },
  { value: 'description', mutate: (s) => void (s.body = 'Closes #12.') },
  {
    value: 'changed-file list',
    mutate: (s) => void (s.files = [file('src/api/rate-limit.ts', 41, 2), file('pnpm-lock.yaml', 900, 3)]),
  },
  { value: "intent's status", mutate: (s) => void (s.intent = { ...s.intent!, status: 'partial' }) },
  {
    value: "intent's derived-at time",
    mutate: (s) => void (s.intent = { ...s.intent!, derived_at: '2026-08-19T10:00:01.000Z' }),
  },
  {
    value: "blast map's status",
    mutate: (s) => void (s.blast = { ...s.blast, status: 'partial' }),
  },
  {
    value: "blast map's indexed SHA",
    mutate: (s) => void (s.blast = { ...s.blast, indexed_sha: 'd'.repeat(40) }),
  },
  {
    value: 'effective document set',
    mutate: (s) => void (s.docs = [
      { path: 'docs/README.md', size: 1201 },
      { path: 'specs/api.md', size: 340 },
    ]),
  },
];

describe('computeCacheKey', () => {
  it('changing nothing produces the same key twice (AC-2)', () => {
    // Two independently constructed equal states, not the same object twice:
    // the key must be a function of the VALUES, not of object identity or of
    // anything the first call cached.
    expect(computeCacheKey(baseState())).toBe(computeCacheKey(baseState()));
  });

  it('changing any one of the nine values changes the key (AC-2)', () => {
    const base = computeCacheKey(baseState());
    const keys = new Set<string>([base]);

    for (const { value, mutate } of MUTATIONS) {
      const state = baseState();
      mutate(state);
      const key = computeCacheKey(state);
      expect(key, `${value} did not change the key`).not.toBe(base);
      keys.add(key);
    }

    // Ten distinct keys: the base plus one per value. A digest that folded two
    // of the nine into one slot would pass every assertion above and fail here.
    expect(keys.size).toBe(MUTATIONS.length + 1);
  });

  it('the brief-format version is digested, so bumping it invalidates every brief', () => {
    // The version is not one of the nine — it is a constant of this code — so it
    // is asserted on the canonical rendering rather than by mutating a state.
    expect(renderCacheKeyState(baseState())).toContain(
      `format:${String(BRIEF_FORMAT_VERSION).length}:${BRIEF_FORMAT_VERSION}`,
    );
  });

  it('does not move when only the physical order of pr_files moves', () => {
    // `getPrFiles` issues no ORDER BY, and a heap order changes on any UPDATE to
    // the table. If that reached the key, re-opening an untouched pull request
    // would regenerate its brief.
    const forward = baseState();
    const reversed = baseState();
    reversed.files = [...forward.files].reverse();

    expect(computeCacheKey(reversed)).toBe(computeCacheKey(forward));
  });

  it('counts a duplicate (pr_id, path) row once (EC-4)', () => {
    // `pr_files` carries no unique constraint on the pair, so the same path can
    // appear twice with the same counts.
    const single = baseState();
    const duplicated = baseState();
    duplicated.files = [...single.files, file('src/api/rate-limit.ts', 40, 2)];

    expect(computeCacheKey(duplicated)).toBe(computeCacheKey(single));
  });

  it('a new changed file changes the key even with identical counts', () => {
    const before = baseState();
    const after = baseState();
    after.files = [...before.files, file('src/api/limits.ts', 40, 2)];

    expect(computeCacheKey(after)).not.toBe(computeCacheKey(before));
  });

  it('the effective document ORDER is part of the value (AC-59)', () => {
    // Two agents contributing the same two documents in the other order is a
    // different prompt, so it must be a different key.
    const forward = baseState();
    const swapped = baseState();
    swapped.docs = [...forward.docs].reverse();

    expect(computeCacheKey(swapped)).not.toBe(computeCacheKey(forward));
  });

  it('a null and an empty description are the same value; a missing intent is its own', () => {
    const nullBody = baseState();
    nullBody.body = null;
    const emptyBody = baseState();
    emptyBody.body = '';
    expect(computeCacheKey(nullBody)).toBe(computeCacheKey(emptyBody));

    // A pull request with no intent row at all differs from one whose intent
    // failed, because AC-31 treats them the same on the card and NOT here: a
    // derivation that has since run must move the key.
    const noIntent = baseState();
    noIntent.intent = null;
    const failed = baseState();
    failed.intent = { status: 'failed', derived_at: null };
    expect(computeCacheKey(noIntent)).not.toBe(computeCacheKey(failed));
  });

  it('a value that imitates a segment separator cannot collide with another state', () => {
    // Without the length prefix on each segment, a title carrying the next
    // segment's own header would render the same canonical string as a genuinely
    // different state — and two different pull requests would share a brief.
    const injected = baseState();
    injected.title = 'x\nbody:0:';
    injected.body = 'y';

    const plain = baseState();
    plain.title = 'x';
    plain.body = '\nbody:0:y';

    expect(renderCacheKeyState(injected)).not.toBe(renderCacheKeyState(plain));
    expect(computeCacheKey(injected)).not.toBe(computeCacheKey(plain));
  });

  it('renders every one of the nine values into the canonical string', () => {
    const rendered = renderCacheKeyState(baseState());

    for (const label of [
      'head',
      'title',
      'body',
      'files',
      'intent_status',
      'intent_at',
      'blast_status',
      'blast_sha',
      'docs',
    ]) {
      expect(rendered, `${label} is missing from the canonical string`).toContain(`${label}:`);
    }
    // The paths and their counts, not just the paths.
    expect(rendered).toContain('src/api/rate-limit.ts:40:2');
    expect(rendered).toContain('docs/README.md:1200');
  });
});

describe('dedupeFilesByPath', () => {
  it('keeps the first occurrence and the input order (AC-60)', () => {
    const files = [
      file('pnpm-lock.yaml', 900, 3),
      file('src/a.ts', 1, 0),
      file('pnpm-lock.yaml', 1, 1),
    ];

    expect(dedupeFilesByPath(files).map((f) => f.path)).toEqual(['pnpm-lock.yaml', 'src/a.ts']);
    // The first row's counts win, so the prompt shows the same figures the
    // ordering was computed over.
    expect(dedupeFilesByPath(files)[0]?.additions).toBe(900);
  });

  it('is idempotent, so both consumers may apply it', () => {
    const files = [file('a.ts'), file('a.ts'), file('b.ts')];
    const once = dedupeFilesByPath(files);

    expect(dedupeFilesByPath(once)).toEqual(once);
  });
});

/**
 * The effective document set — AC-59's union, and the sizes the key digests.
 *
 * Here rather than in a file of its own because the set IS one of the nine key
 * values: the union decides which paths and which order the digest above sees,
 * and a bug in it shows up as a key that does not move when an agent's
 * attachments change. `readEffectiveDocs` is the generation-path counterpart and
 * is covered here for the same reason — it is the other half of one module.
 */

const REPO: BriefRepoRef = { owner: 'acme', name: 'api' };

/** An `EffectiveContextDoc` as `listEffectiveDocs` answers it. */
function doc(path: string, order: number) {
  return { path, source: { kind: 'agent' } as const, order };
}

/** A `BriefDocReader` that reports the given sizes and refuses to read. */
function reader(
  walk: RepoDocWalk,
  reads: Record<string, string> = {},
): BriefDocReader & { listed: RepoDocWalkOptions[]; read_: string[] } {
  const listed: RepoDocWalkOptions[] = [];
  const read_: string[] = [];
  return {
    listed,
    read_,
    list: async (_repo: BriefRepoRef, options: RepoDocWalkOptions) => {
      listed.push(options);
      return walk;
    },
    read: async (_repo: BriefRepoRef, candidate: string) => {
      read_.push(candidate);
      const text = reads[candidate];
      return text === undefined
        ? { ok: false as const, note: 'not found' }
        : { ok: true as const, text };
    },
  };
}

function okWalk(entries: readonly { path: string; size: number }[]): RepoDocWalk {
  return {
    ok: true,
    docs: entries.map((entry) => ({ ...entry, updatedAt: null })),
    total: entries.length,
    truncated: false,
    entryBudgetExhausted: false,
  };
}

describe('collectEffectiveDocSet', () => {
  it('unions the enabled agents’ sets, first occurrence winning (AC-59)', async () => {
    const sets: Record<string, ReturnType<typeof doc>[]> = {
      'agent-1': [doc('docs/a.md', 0), doc('specs/shared.md', 1)],
      'agent-2': [doc('specs/shared.md', 0), doc('docs/b.md', 1)],
    };

    const out = await collectEffectiveDocSet(
      {
        agents: { listEnabled: async () => [{ id: 'agent-1' }, { id: 'agent-2' }] },
        projectContext: { listEffectiveDocs: async (agentId) => sets[agentId] ?? [] },
      },
      'ws-1',
      'repo-1',
    );

    // Ordered by agent, then by attachment order; the shared document keeps the
    // FIRST agent's position and is not repeated.
    expect(out.map((entry) => entry.path)).toEqual(['docs/a.md', 'specs/shared.md', 'docs/b.md']);
    expect(out.map((entry) => entry.agentId)).toEqual(['agent-1', 'agent-1', 'agent-2']);
  });

  it('is empty when no agent is enabled, and asks Project Context nothing', async () => {
    let calls = 0;
    const out = await collectEffectiveDocSet(
      {
        agents: { listEnabled: async () => [] },
        projectContext: {
          listEffectiveDocs: async () => {
            calls += 1;
            return [];
          },
        },
      },
      'ws-1',
      'repo-1',
    );

    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('sizeEffectiveDocs', () => {
  const set: EffectiveDoc[] = [
    { path: 'docs/a.md', agentId: 'agent-1', source: { kind: 'agent' }, order: 0 },
    { path: 'server/specs/b.md', agentId: 'agent-1', source: { kind: 'agent' }, order: 1 },
  ];

  it('takes each size from one walk that opens no file', async () => {
    const docs = reader(okWalk([{ path: 'docs/a.md', size: 12 }, { path: 'server/specs/b.md', size: 34 }]));

    const sized = await sizeEffectiveDocs(docs, REPO, set);

    expect(cacheKeyDocs(sized)).toEqual([
      { path: 'docs/a.md', size: 12 },
      { path: 'server/specs/b.md', size: 34 },
    ]);
    expect(sized.every((entry) => entry.sized)).toBe(true);
    expect(docs.read_).toEqual([]);
    // The predicate is exact membership, so the walk cannot report a document
    // nobody attached — nor miss one whose extension this feature never listed.
    const options = docs.listed[0];
    expect(options?.match?.('a.md', 'docs/a.md')).toBe(true);
    expect(options?.match?.('other.md', 'docs/other.md')).toBe(false);
    expect(options?.roots).toEqual(['docs', 'server/specs']);
  });

  it('gives an unreported path size 0 and a note, rather than omitting it (Q2)', async () => {
    const docs = reader(okWalk([{ path: 'docs/a.md', size: 12 }]));

    const sized = await sizeEffectiveDocs(docs, REPO, set);

    expect(cacheKeyDocs(sized)).toEqual([
      { path: 'docs/a.md', size: 12 },
      { path: 'server/specs/b.md', size: 0 },
    ]);
    expect(sized[1]?.sized).toBe(false);
    expect(sized[1]?.note).toContain('missing from the clone');
  });

  it('treats a failed walk as a value: every size 0, carrying the walk’s own note', async () => {
    const docs = reader({ ok: false, note: 'no clone for this repository yet' });

    const sized = await sizeEffectiveDocs(docs, REPO, set);

    expect(sized.map((entry) => entry.size)).toEqual([0, 0]);
    expect(sized.every((entry) => entry.note === 'no clone for this repository yet')).toBe(true);
  });

  it('walks nothing at all for an empty set', async () => {
    const docs = reader(okWalk([]));

    expect(await sizeEffectiveDocs(docs, REPO, [])).toEqual([]);
    expect(docs.listed).toEqual([]);
  });
});

describe('readEffectiveDocs', () => {
  it('refuses a document past the read cap without opening it', async () => {
    const docs = reader(okWalk([]), { 'docs/big.md': 'never read' });
    const sized = [
      {
        path: 'docs/big.md',
        agentId: 'agent-1',
        source: { kind: 'agent' } as const,
        order: 0,
        size: MAX_DOCUMENT_BYTES + 1,
        sized: true,
        note: null,
      },
    ];

    const loaded = await readEffectiveDocs(docs, REPO, sized);

    expect(docs.read_).toEqual([]);
    expect(loaded[0]?.ok).toBe(false);
    expect(loaded[0]).toMatchObject({ path: 'docs/big.md' });
  });

  it('reads the rest, and records a refusal rather than dropping the document', async () => {
    const docs = reader(okWalk([]), { 'docs/a.md': 'the text' });
    const sized = [
      { path: 'docs/a.md', agentId: 'a', source: { kind: 'agent' } as const, order: 0, size: 8, sized: true, note: null },
      { path: 'docs/gone.md', agentId: 'a', source: { kind: 'agent' } as const, order: 1, size: 0, sized: false, note: 'x' },
    ];

    const loaded = await readEffectiveDocs(docs, REPO, sized);

    expect(loaded).toEqual([
      { path: 'docs/a.md', ok: true, text: 'the text', note: null },
      { path: 'docs/gone.md', ok: false, note: 'not found' },
    ]);
  });
});

describe('docWalkRoots', () => {
  it('is the directories the set’s own paths live in, deduplicated and sorted', () => {
    expect(
      docWalkRoots([
        { path: 'server/specs/a.md' },
        { path: 'docs/b.md' },
        { path: 'docs/c.md' },
        { path: 'README.md' },
      ]),
    ).toEqual(['.', 'docs', 'server/specs']);
  });
});
