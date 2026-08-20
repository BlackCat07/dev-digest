import { describe, it, expect } from 'vitest';
import {
  assembleBriefInput,
  blockTokens,
  type AssembleInput,
  type BriefBlock,
} from '../src/modules/brief/assemble.js';
import {
  CORE_SOURCES,
  MAX_PROMPT_PATHS,
  SHED_ORDER,
} from '../src/modules/brief/constants.js';
import type {
  BriefBlastFacts,
  BriefIntentFacts,
  BriefPriorPrsFacts,
  BriefPull,
  FileRoleClassifier,
} from '../src/modules/brief/types.js';
import { classifyPath } from '../src/modules/smart-diff/classify.js';

/**
 * L05 — the model input: its eight sources, its ordering, its budget and the
 * two absences it rests on (AC-10 … AC-17, AC-60, EC-4, EC-36).
 *
 * Hermetic and pure: no database, no clone, no provider, no clock. Everything the
 * assembly reads is a plain object handed in.
 *
 * The REAL classifier is passed in as the port, the way
 * `test/brief-file-roles.test.ts` does and for the same reason:
 * `modules/brief/` imports no sibling module, so a test is the only place the
 * declared {@link FileRoleClassifier} and the implementation the composition root
 * binds to it are checked against each other.
 *
 * What this file does NOT claim: that the 8 000-token ceiling holds. AC-12
 * measures the system and user messages exactly as sent — after `wrapUntrusted`
 * has added a delimiter pair per block and after the system template has been
 * rendered — and neither exists at this layer. `prompt.ts` owns that
 * re-measurement. Everything asserted below is about the pre-wrap figure the
 * shedding decides on.
 */

const fileRole: FileRoleClassifier = (path: string) => classifyPath(path);

/** A `pr_files` row. `patch` is deliberately absent from the port's own shape. */
function file(path: string, additions = 1, deletions = 0) {
  return { path, additions, deletions };
}

function pull(over: Partial<BriefPull> = {}): BriefPull {
  return {
    id: 'pr-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Rate-limit the review endpoint',
    body: 'Closes #12.',
    branch: 'feat/limit',
    base: 'main',
    headSha: 'a'.repeat(40),
    additions: 41,
    deletions: 2,
    filesCount: 2,
    updatedAt: null,
    ...over,
  };
}

function blastFacts(over: Partial<BriefBlastFacts> = {}): BriefBlastFacts {
  return {
    status: 'ok',
    reason: null,
    indexed_sha: 'b'.repeat(40),
    changed_files: [],
    changed_symbols: [],
    downstream: [],
    impacted: [],
    counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    ...over,
  };
}

function intentFacts(over: Partial<BriefIntentFacts> = {}): BriefIntentFacts {
  return {
    status: 'ok',
    intent: 'Bound the review endpoint so one client cannot exhaust the provider budget.',
    in_scope: ['the review route'],
    out_of_scope: ['the polling route'],
    risk_areas: [],
    head_sha: 'a'.repeat(40),
    derived_at: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

function priorPrsFacts(over: Partial<BriefPriorPrsFacts> = {}): BriefPriorPrsFacts {
  return {
    prs: [
      {
        number: 30,
        title: 'Add the review endpoint',
        updated_at: '2026-07-01T00:00:00.000Z',
        shared_files: ['src/api/rate-limit.ts'],
        shared_file_count: 1,
      },
    ],
    total: 1,
    truncated: false,
    status: 'ok',
    reason: null,
    ...over,
  };
}

/** Every source present, so a test can remove exactly one thing at a time. */
function fullInput(over: Partial<AssembleInput> = {}): AssembleInput {
  return {
    pull: pull(),
    files: [file('src/api/rate-limit.ts', 40, 2), file('pnpm-lock.yaml', 900, 3)],
    intent: intentFacts(),
    blast: blastFacts(),
    priorPrs: priorPrsFacts(),
    issue: { ref: 'acme/api#12', ok: true, title: 'Reviews are unbounded', body: 'Any client can loop.' },
    docs: [{ path: 'docs/reviews.md', ok: true, text: 'The review pipeline is documented here.', note: null }],
    fileRole,
    ...over,
  };
}

/** The whole user-message material, as one string — what a leak would show up in. */
function allText(blocks: readonly BriefBlock[]): string {
  return blocks.map((block) => `## ${block.heading}\n${block.text}`).join('\n\n');
}

describe('assembleBriefInput — the eight sources (AC-10)', () => {
  it('offers exactly the eight named kinds and no others', () => {
    const result = assembleBriefInput(fullInput());

    expect([...new Set(result.blocks.map((block) => block.kind))]).toEqual([
      'pr_title',
      'file_list',
      'intent',
      'blast',
      'pr_body',
      'linked_issue',
      'prior_prs',
      'repo_doc',
    ]);
    // The core reads first, so a shed input is a shorter version of the same
    // prompt rather than a differently shaped one.
    expect(result.blocks.slice(0, 3).map((block) => block.kind)).toEqual([...CORE_SOURCES]);
  });

  it('records one source entry per input it was offered (AC-33)', () => {
    const result = assembleBriefInput(fullInput());

    expect(result.sources.map((source) => source.kind)).toEqual([
      'pr_title',
      'file_list',
      'intent',
      'blast',
      'pr_body',
      'linked_issue',
      'prior_prs',
      'repo_doc',
    ]);
    expect(result.sources.every((source) => source.status === 'used')).toBe(true);
  });

  it('records a missing intent and a missing changed-file list rather than omitting them', () => {
    const result = assembleBriefInput(fullInput({ files: [], intent: undefined }));

    const byKind = new Map(result.sources.map((source) => [source.kind, source]));
    expect(byKind.get('intent')?.status).toBe('unfetched');
    expect(byKind.get('intent')?.note).toContain('no intent has been derived');
    expect(byKind.get('file_list')?.status).toBe('unfetched');
    expect(byKind.get('file_list')?.chars).toBeNull();
    // Neither contributed a block, so nothing empty is sent as if it were a fact.
    expect(result.blocks.some((block) => block.kind === 'intent')).toBe(false);
    expect(result.blocks.some((block) => block.kind === 'file_list')).toBe(false);
  });

  it('omits the description entirely when there is none, and records nothing for it', () => {
    // A pull request with no description is a normal state, not a failure — an
    // `unfetched` entry would read as one.
    const result = assembleBriefInput(fullInput({ pull: pull({ body: null }) }));

    expect(result.blocks.some((block) => block.kind === 'pr_body')).toBe(false);
    expect(result.sources.some((source) => source.kind === 'pr_body')).toBe(false);
  });

  it('records a linked issue that could not be fetched, with its reason', () => {
    const result = assembleBriefInput(
      fullInput({ issue: { ref: 'acme/api#12', ok: false, note: 'GitHub is not configured' } }),
    );

    const entry = result.sources.find((source) => source.kind === 'linked_issue');
    expect(entry?.status).toBe('unfetched');
    expect(entry?.note).toBe('GitHub is not configured');
    expect(result.blocks.some((block) => block.kind === 'linked_issue')).toBe(false);
  });

  it('carries the blast map’s own reason into the block when it is not ok (AC-32)', () => {
    const result = assembleBriefInput(
      fullInput({ blast: blastFacts({ status: 'partial', reason: 'index_partial' }) }),
    );

    const block = result.blocks.find((b) => b.kind === 'blast');
    expect(block?.text).toContain('Index status: partial (index_partial)');
    expect(result.sources.find((s) => s.kind === 'blast')?.note).toContain('index_partial');
  });
});

describe('assembleBriefInput — no diff hunk body (AC-11)', () => {
  it('leaks no substring of a stored patch, even when the rows carry one', () => {
    // `BriefPrFile` has no `patch` field — the repository selects three columns —
    // so the extra property is structurally harmless and is exactly how the
    // absence can be proven rather than asserted.
    const patch = '@@ -1,3 +1,4 @@\n-const limit = 0;\n+const limit = UNIQUE_PATCH_MARKER;';
    // Bound to a variable first: TypeScript's excess-property check only fires on
    // a FRESH literal, and the point of the fixture is that a row with a patch is
    // structurally acceptable to a port that declares none.
    const rows = [
      { ...file('src/api/rate-limit.ts', 40, 2), patch },
      { ...file('pnpm-lock.yaml', 900, 3), patch },
    ];
    const result = assembleBriefInput(fullInput({ files: rows }));

    const text = allText(result.blocks);
    expect(text).toContain('src/api/rate-limit.ts +40/-2');
    for (const line of patch.split('\n')) {
      expect(text).not.toContain(line);
    }
    expect(text).not.toContain('UNIQUE_PATCH_MARKER');
    expect(text).not.toContain('@@');
  });
});

describe('assembleBriefInput — the changed-file list (AC-60, AC-17, EC-4, EC-36)', () => {
  it('orders core, then wiring, then boilerplate, in pr_files order within a role', () => {
    const result = assembleBriefInput(
      fullInput({
        files: [
          file('pnpm-lock.yaml'),
          file('src/server.ts'),
          file('src/api/rate-limit.ts'),
          file('src/api/limits.ts'),
        ],
      }),
    );

    expect(result.groundingPaths).toEqual([
      'src/api/rate-limit.ts',
      'src/api/limits.ts',
      'src/server.ts',
      'pnpm-lock.yaml',
    ]);
  });

  it('caps a 400-file pull request at 200 paths and states the remainder (AC-17)', () => {
    // 200 core files and 200 boilerplate ones, interleaved so a cap applied
    // BEFORE the ordering would keep a mix of the two.
    const files = [];
    for (let i = 0; i < 200; i += 1) {
      files.push(file(`docs/note-${i}.md`), file(`src/api/f-${i}.ts`));
    }

    const result = assembleBriefInput(fullInput({ files }));

    expect(result.groundingPaths).toHaveLength(MAX_PROMPT_PATHS);
    expect(result.omittedPaths).toBe(200);
    expect(result.diffStats.files_changed).toBe(400);
    expect(result.diffStats.files_listed).toBe(200);
    // Every kept path is a source file: the ordering ran first, so the cap spent
    // the whole budget on `core`.
    expect(result.groundingPaths.every((path) => path.startsWith('src/api/'))).toBe(true);
    // The count the reader is shown is outside the untrusted delimiters.
    expect(result.blocks.find((block) => block.kind === 'file_list')?.heading).toContain(
      '200 of 400',
    );
    expect(result.sources.find((source) => source.kind === 'file_list')?.note).toContain(
      '200 further changed files',
    );
  });

  it('counts a duplicate (pr_id, path) row once (EC-4)', () => {
    const result = assembleBriefInput(
      fullInput({
        files: [
          file('src/api/rate-limit.ts', 40, 2),
          file('src/api/rate-limit.ts', 40, 2),
          file('pnpm-lock.yaml', 900, 3),
        ],
      }),
    );

    expect(result.changedPaths).toEqual(['src/api/rate-limit.ts', 'pnpm-lock.yaml']);
    expect(result.diffStats.files_changed).toBe(2);
    expect(result.diffStats.additions).toBe(940);
    expect(result.diffStats.deletions).toBe(5);
    // One line in the prompt, not two.
    const fileBlock = result.blocks.find((block) => block.kind === 'file_list');
    expect(fileBlock?.text.split('\n').filter((line) => line.startsWith('src/api/rate-limit.ts')))
      .toHaveLength(1);
  });

  it('keeps two paths differing only in case in their recorded forms (EC-36)', () => {
    // `classifyPath` folds separators and LOWERCASES. If that normalised form
    // ever escaped the classifier into this list, the grounding set would widen
    // silently and a citation of one file would be accepted for the other.
    const result = assembleBriefInput(
      fullInput({ files: [file('src/api/Rate.ts'), file('src/api/rate.ts')] }),
    );

    expect(result.groundingPaths).toEqual(['src/api/Rate.ts', 'src/api/rate.ts']);
    const text = allText(result.blocks);
    expect(text).toContain('src/api/Rate.ts +1/-0');
    expect(text).toContain('src/api/rate.ts +1/-0');
  });
});

describe('assembleBriefInput — the input budget (AC-14, AC-15, AC-16)', () => {
  /** Every optional source made large enough that each one alone busts a 100-token budget. */
  function bulkyInput(): AssembleInput {
    const filler = 'x'.repeat(2_000);
    return fullInput({
      pull: pull({ body: filler }),
      issue: { ref: 'acme/api#12', ok: true, title: 'Unbounded', body: filler },
      blast: blastFacts({
        changed_symbols: Array.from({ length: 60 }, (_, i) => ({
          name: `symbol${i}`,
          file: `src/api/module-${i}.ts`,
          kind: 'function',
        })),
      }),
      priorPrs: priorPrsFacts({
        prs: Array.from({ length: 5 }, (_, i) => ({
          number: 20 + i,
          title: 'Earlier change to the same area of the review pipeline',
          updated_at: '2026-07-01T00:00:00.000Z',
          shared_files: [`src/api/rate-limit.ts`, `src/api/module-${i}.ts`, 'src/api/review.ts'],
          shared_file_count: 12,
        })),
      }),
      docs: [{ path: 'docs/reviews.md', ok: true, text: filler, note: null }],
    });
  }

  it('sheds whole optional sources in SHED_ORDER until the core alone remains', () => {
    const result = assembleBriefInput({ ...bulkyInput(), budget: 100 });

    expect(result.dropped).toEqual([...SHED_ORDER]);
    expect(result.blocks.map((block) => block.kind)).toEqual([...CORE_SOURCES]);
    expect(result.coreOverBudget).toBe(false);
    expect(result.tokens).toBeLessThanOrEqual(100);

    const droppedEntries = result.sources.filter(
      (source) => source.status === 'dropped_over_budget',
    );
    expect(droppedEntries).toHaveLength(5);
    expect(new Set(droppedEntries.map((source) => source.kind))).toEqual(new Set(SHED_ORDER));
    // Each says why, and claims no size: nothing of it reached the prompt.
    for (const entry of droppedEntries) {
      expect(entry.chars).toBeNull();
      expect(entry.note).toContain('token input budget');
    }
  });

  it('stops shedding as soon as the input fits, keeping the cheapest sources', () => {
    // A budget that only the two largest sources bust.
    const bulky = bulkyInput();
    const tokens = (kinds: readonly string[]) =>
      blockTokens(
        assembleBriefInput({ ...bulky, budget: Number.MAX_SAFE_INTEGER }).blocks.filter((block) =>
          kinds.includes(block.kind),
        ),
      );
    const budget = tokens([...CORE_SOURCES, 'blast', 'pr_body', 'linked_issue']);

    const result = assembleBriefInput({ ...bulky, budget });

    expect(result.dropped).toEqual(['repo_doc', 'prior_prs']);
    expect(result.blocks.some((block) => block.kind === 'pr_body')).toBe(true);
    expect(result.blocks.some((block) => block.kind === 'blast')).toBe(true);
    expect(result.coreOverBudget).toBe(false);
  });

  it('reports that the core alone overruns, so no model call is made (AC-16)', () => {
    const result = assembleBriefInput({ ...fullInput(), budget: 1 });

    expect(result.coreOverBudget).toBe(true);
    // The core is never dropped, whatever the budget says (AC-15).
    expect(result.blocks.map((block) => block.kind)).toEqual([...CORE_SOURCES]);
    expect(result.dropped).toEqual([...SHED_ORDER]);
  });

  it('sheds nothing when the input fits, and reports its own pre-wrap size', () => {
    const result = assembleBriefInput(fullInput());

    expect(result.dropped).toEqual([]);
    expect(result.coreOverBudget).toBe(false);
    expect(result.tokens).toBe(blockTokens(result.blocks));
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('drops every document of the effective set together, never half of them', () => {
    const filler = 'y'.repeat(2_000);
    const result = assembleBriefInput({
      ...fullInput({
        docs: [
          { path: 'docs/a.md', ok: true, text: filler, note: null },
          { path: 'docs/b.md', ok: true, text: filler, note: null },
        ],
      }),
      budget: 400,
    });

    expect(result.blocks.some((block) => block.kind === 'repo_doc')).toBe(false);
    expect(
      result.sources.filter(
        (source) => source.kind === 'repo_doc' && source.status === 'dropped_over_budget',
      ),
    ).toHaveLength(2);
  });
});

describe('assembleBriefInput — the deterministic figures (AC-30)', () => {
  it('sums the counts over the list the brief was built from', () => {
    // The four blast figures are deliberately all DIFFERENT here: the brief
    // carries two of them, and a fixture where they coincide would pass just as
    // happily if `endpoints` were wired to `symbols` — or to `crons`.
    const result = assembleBriefInput(
      fullInput({
        blast: blastFacts({ counts: { symbols: 4, callers: 9, endpoints: 3, crons: 2 } }),
      }),
    );

    expect(result.diffStats).toEqual({
      files_changed: 2,
      files_listed: 2,
      additions: 940,
      deletions: 5,
      symbols: 4,
      endpoints: 3,
    });
  });

  it('reports zeros for a pull request with no changed files recorded', () => {
    // The stats describe the list the assembly held, not the pull request row's
    // own hand-written totals — the two disagree on real data
    // (`server/INSIGHTS.md`, 2026-08-11), and `no_changed_files` is what explains
    // the zeros on the card.
    const result = assembleBriefInput(fullInput({ files: [] }));

    expect(result.diffStats).toEqual({
      files_changed: 0,
      files_listed: 0,
      additions: 0,
      deletions: 0,
      symbols: 0,
      endpoints: 0,
    });
    expect(result.groundingPaths).toEqual([]);
  });
});

describe('assembleBriefInput — the document audit trail (AC-33)', () => {
  it('carries a sizing note onto the source entry of a document that was still read', () => {
    // A document the walk never sized contributed `0` to the cache key. It is
    // `used` — the read succeeded, so it really did reach the prompt — and the
    // note is what says the key's figure was a stand-in rather than a measurement.
    const docs = [
      {
        path: 'docs/reviews.md',
        ok: true as const,
        text: 'The review pipeline is documented here.',
        note: 'the walk did not report this path — it is missing from the clone, or outside it',
      },
    ];

    const entry = assembleBriefInput(fullInput({ docs })).sources.find(
      (source) => source.kind === 'repo_doc',
    );

    expect(entry?.status).toBe('used');
    expect(entry?.note).toContain('the walk did not report this path');
  });

  it('records a document that could not be read, and sends no block for it', () => {
    const docs = [{ path: 'docs/big.md', ok: false as const, note: '900000 bytes, past the read cap' }];

    const result = assembleBriefInput(fullInput({ docs }));

    expect(result.blocks.some((block) => block.kind === 'repo_doc')).toBe(false);
    expect(result.sources.find((source) => source.kind === 'repo_doc')).toMatchObject({
      status: 'unfetched',
      chars: null,
      note: '900000 bytes, past the read cap',
    });
  });
});
