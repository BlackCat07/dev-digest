import { describe, it, expect } from 'vitest';
import {
  MAX_FOCUS_REASON_CHARS,
  MAX_REVIEW_FOCUS,
  MAX_RISKS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_TITLE_CHARS,
  MAX_WHAT_CHARS,
} from '../src/modules/brief/constants.js';
import {
  blastReferences,
  groundBriefDraft,
  type GroundingContext,
} from '../src/modules/brief/grounding.js';
import type {
  DraftReviewFocus,
  DraftRisk,
  PrBriefDraft,
} from '../src/modules/brief/schemas.js';
import type { BriefBlastFacts } from '../src/modules/brief/types.js';

/**
 * L05 — the evidence gate: what a model claimed versus what is stored
 * (AC-22 … AC-27, EC-15, EC-16, EC-17).
 *
 * Hermetic and pure. Every rule below is a defence against the model's own
 * output, which is the half of this feature's untrusted-input story that the
 * prompt's delimiters cannot cover: a review-focus row pointing at a file the pull
 * request never touched is a link a reviewer clicks that goes nowhere.
 *
 * The allowed path set handed in is deliberately `listedPaths` — the LISTED subset
 * the model was actually shown, after the role ordering and the 200-path cap — and
 * one test below pins that difference, because grounding against the full changed
 * set would accept a citation the model could not have made honestly.
 */

const LISTED = ['src/api/rate-limit.ts', 'src/api/routes.ts'];
const BLAST_FILE = 'src/api/server.ts';
const ENDPOINT = 'POST /pulls/:id/review';
const TITLE = 'Rate-limit the review endpoint';

function context(over: Partial<GroundingContext> = {}): GroundingContext {
  return {
    title: TITLE,
    listedPaths: LISTED,
    blastFiles: [BLAST_FILE],
    blastEndpoints: [ENDPOINT],
    ...over,
  };
}

function risk(over: Partial<DraftRisk> = {}): DraftRisk {
  return {
    kind: 'perf',
    title: 'Shared bucket across clients',
    explanation: 'One noisy client can exhaust the window for everyone else.',
    severity: 'medium',
    file_refs: [],
    ...over,
  };
}

function focus(over: Partial<DraftReviewFocus> = {}): DraftReviewFocus {
  return {
    path: 'src/api/rate-limit.ts',
    line: null,
    reason: 'The whole of the new limiting rule lives here.',
    ...over,
  };
}

function draft(over: Partial<PrBriefDraft> = {}): PrBriefDraft {
  return {
    what: 'Adds a per-client token bucket in front of the review route.',
    why: 'One client exhausted the provider budget last Friday.',
    risks: [],
    review_focus: [],
    ...over,
  };
}

/** The one item, or a readable failure — `noUncheckedIndexedAccess` is on. */
function only<T>(items: readonly T[]): T {
  if (items.length !== 1) throw new Error(`expected exactly one item, got ${items.length}`);
  const [item] = items;
  if (item == null) throw new Error('expected exactly one item');
  return item;
}

describe('groundBriefDraft — a risk\'s citations (AC-22, AC-23)', () => {
  it('stores the risk without an invented reference rather than dropping it', () => {
    const result = groundBriefDraft(
      draft({
        risks: [risk({ file_refs: ['src/api/rate-limit.ts', 'src/does-not-exist.ts'] })],
      }),
      context(),
    );

    expect(only(result.risks).file_refs).toEqual(['src/api/rate-limit.ts']);
  });

  it('keeps a trailing :line or :line-line suffix for display, matching on the path', () => {
    // The model is told to cite bare paths and routinely appends a range;
    // rejecting those would drop almost every true reference (EC-17).
    const result = groundBriefDraft(
      draft({ risks: [risk({ file_refs: ['src/api/rate-limit.ts:12-18', 'src/api/routes.ts:4'] })] }),
      context(),
    );

    expect(only(result.risks).file_refs).toEqual([
      'src/api/rate-limit.ts:12-18',
      'src/api/routes.ts:4',
    ]);
  });

  it('accepts a file the blast map referenced, which a review-focus row may not', () => {
    const result = groundBriefDraft(
      draft({ risks: [risk({ file_refs: [BLAST_FILE] })] }),
      context(),
    );

    expect(only(result.risks).file_refs).toEqual([BLAST_FILE]);
  });

  it('drops a risk whose every offered reference was invented', () => {
    const result = groundBriefDraft(
      draft({
        risks: [
          risk({ title: 'Invented', file_refs: ['src/nope.ts', 'docs/also-nope.md'] }),
          risk({ title: 'Grounded', file_refs: ['src/api/routes.ts'] }),
        ],
      }),
      context(),
    );

    expect(result.risks.map((r) => r.title)).toEqual(['Grounded']);
  });

  it('keeps a risk that cites nothing at all', () => {
    // "The auth surface is touched" is a legitimate whole-pull-request
    // observation, and the model was not required to cite anything.
    const result = groundBriefDraft(
      draft({ risks: [risk({ title: 'Auth surface touched', file_refs: [] })] }),
      context(),
    );

    expect(only(result.risks).title).toBe('Auth surface touched');
    expect(only(result.risks).file_refs).toEqual([]);
  });

  it('drops a risk with no title, which could not be rendered or clicked', () => {
    const result = groundBriefDraft(
      draft({ risks: [risk({ title: '   ' }), risk({ title: 'Real' })] }),
      context(),
    );

    expect(result.risks.map((r) => r.title)).toEqual(['Real']);
  });
});

describe('groundBriefDraft — an endpoint citation (AC-25)', () => {
  it('keeps an endpoint the blast map reported as impacted', () => {
    const result = groundBriefDraft(
      draft({ risks: [risk({ kind: 'breaking_api', file_refs: [ENDPOINT] })] }),
      context(),
    );

    expect(only(result.risks).file_refs).toEqual([ENDPOINT]);
  });

  it('stores the item without an endpoint the map never reported', () => {
    // A path comparison cannot see this: `GET /api/does-not-exist` is not a path
    // and would be dropped for the wrong reason, or — with a looser matcher —
    // kept. Hence its own rule.
    const result = groundBriefDraft(
      draft({
        risks: [
          risk({ file_refs: ['GET /api/does-not-exist', 'src/api/routes.ts'] }),
        ],
      }),
      context(),
    );

    expect(only(result.risks).file_refs).toEqual(['src/api/routes.ts']);
  });

  it('drops the risk when an invented endpoint was its only citation', () => {
    const result = groundBriefDraft(
      draft({ risks: [risk({ file_refs: ['GET /api/does-not-exist'] })] }),
      context(),
    );

    expect(result.risks).toEqual([]);
    // Nothing survived, so the level is the claim `low` rather than an absence.
    expect(result.riskLevel).toBe('low');
  });
});

describe('groundBriefDraft — review focus (AC-24)', () => {
  it('stores three entries when the fourth names a file the pull request does not change', () => {
    const result = groundBriefDraft(
      draft({
        review_focus: [
          focus({ path: 'src/api/rate-limit.ts', reason: 'one' }),
          focus({ path: 'src/api/routes.ts', reason: 'two' }),
          focus({ path: 'src/api/rate-limit.ts', reason: 'three' }),
          focus({ path: 'src/api/invented.ts', reason: 'four' }),
        ],
      }),
      context(),
    );

    expect(result.reviewFocus.map((item) => item.reason)).toEqual(['one', 'two', 'three']);
  });

  it('refuses a blast-radius file here, which a risk would have accepted', () => {
    // Stricter than AC-22 on purpose: this row's whole contract is that it
    // navigates into a tab that renders only changed files, so a row that cannot
    // navigate is worse than a missing row (OQ-3).
    const result = groundBriefDraft(
      draft({ review_focus: [focus({ path: BLAST_FILE })] }),
      context(),
    );

    expect(result.reviewFocus).toEqual([]);
  });

  it('grounds against the paths the model was SHOWN, not every changed path', () => {
    // A path the 200-path cap left out was never in front of the model, so a row
    // naming it is not a citation the model could have made honestly. The caller
    // passes `AssembledInput.groundingPaths` for exactly this reason.
    const capped = groundBriefDraft(
      draft({ review_focus: [focus({ path: 'src/api/unlisted.ts' })] }),
      context({ listedPaths: ['src/api/rate-limit.ts'] }),
    );
    expect(capped.reviewFocus).toEqual([]);

    const listed = groundBriefDraft(
      draft({ review_focus: [focus({ path: 'src/api/unlisted.ts' })] }),
      context({ listedPaths: ['src/api/unlisted.ts'] }),
    );
    expect(only(listed.reviewFocus).path).toBe('src/api/unlisted.ts');
  });

  it('stores a bare path even when the model appended a display suffix', () => {
    // The stored value is handed to the diff tab as a file target, and a
    // `path:line` display form would match no file.
    const result = groundBriefDraft(
      draft({ review_focus: [focus({ path: 'src/api/routes.ts:88', line: 12 })] }),
      context(),
    );

    const item = only(result.reviewFocus);
    expect(item.path).toBe('src/api/routes.ts');
    // The line stays the model's own field; the suffix's number is not adopted —
    // `line` is explicitly ungrounded and inferring one would be a second source.
    expect(item.line).toBe(12);
  });

  it('drops a row with no reason, because the reason is all the model adds', () => {
    const result = groundBriefDraft(
      draft({
        review_focus: [focus({ reason: '  ' }), focus({ path: 'src/api/routes.ts', reason: 'why' })],
      }),
      context(),
    );

    expect(result.reviewFocus.map((item) => item.reason)).toEqual(['why']);
  });
});

describe('groundBriefDraft — the derived level (AC-26)', () => {
  it('takes the highest severity among the risks that survived', () => {
    const result = groundBriefDraft(
      draft({
        risks: [
          risk({ title: 'a', severity: 'low' }),
          risk({ title: 'b', severity: 'high' }),
          risk({ title: 'c', severity: 'low' }),
        ],
      }),
      context(),
    );

    expect(result.risks).toHaveLength(3);
    expect(result.riskLevel).toBe('high');
  });

  it('is low when every risk was dropped, and medium when that is the top survivor', () => {
    const dropped = groundBriefDraft(
      draft({ risks: [risk({ severity: 'high', file_refs: ['src/invented.ts'] })] }),
      context(),
    );
    expect(dropped.risks).toEqual([]);
    expect(dropped.riskLevel).toBe('low');

    const medium = groundBriefDraft(
      draft({ risks: [risk({ severity: 'medium' }), risk({ title: 'x', severity: 'low' })] }),
      context(),
    );
    expect(medium.riskLevel).toBe('medium');
  });

  it('is low for a brief with no risks at all', () => {
    expect(groundBriefDraft(draft(), context()).riskLevel).toBe('low');
  });
});

describe('groundBriefDraft — the what (AC-27)', () => {
  it('stores no what when it only restates the title, and says so', () => {
    const result = groundBriefDraft(
      draft({ what: '  rate-limit   THE review\nendpoint ' }),
      context(),
    );

    expect(result.what).toBeNull();
    expect(result.restatedTitle).toBe(true);
    // The why and the risks are still real, which is why the caller marks the
    // brief partial rather than degraded.
    expect(result.why).not.toBeNull();
  });

  it('keeps a what that says more than the title', () => {
    const result = groundBriefDraft(
      draft({ what: `${TITLE} with a per-client token bucket.` }),
      context(),
    );

    expect(result.what).toBe(`${TITLE} with a per-client token bucket.`);
    expect(result.restatedTitle).toBe(false);
  });

  it('reports an empty what as absent, never as a restatement', () => {
    const result = groundBriefDraft(draft({ what: '   ', why: '\n' }), context());

    expect(result.what).toBeNull();
    expect(result.why).toBeNull();
    // Labelling this `restates_title` would put a wrong reason on the card.
    expect(result.restatedTitle).toBe(false);
  });
});

describe('groundBriefDraft — the caps (EC-16)', () => {
  it('discards a whole item over a list cap rather than merging or truncating it', () => {
    const risks = Array.from({ length: MAX_RISKS + 2 }, (_, i) =>
      risk({ title: `risk ${i}`, severity: 'low' }),
    );
    const rows = Array.from({ length: MAX_REVIEW_FOCUS + 2 }, (_, i) =>
      focus({ reason: `reason ${i}` }),
    );

    const result = groundBriefDraft(draft({ risks, review_focus: rows }), context());

    expect(result.risks).toHaveLength(MAX_RISKS);
    expect(result.reviewFocus).toHaveLength(MAX_REVIEW_FOCUS);
    // The FIRST ones, in the model's own order — nothing is re-ranked here.
    expect(result.risks.map((r) => r.title)).toEqual(
      Array.from({ length: MAX_RISKS }, (_, i) => `risk ${i}`),
    );
    // And the last title is not a merge of the discarded ones.
    expect(result.risks.map((r) => r.title)).not.toContain(`risk ${MAX_RISKS}`);
  });

  it('keeps at most three citations per risk', () => {
    const result = groundBriefDraft(
      draft({
        risks: [
          risk({
            file_refs: [
              'src/api/rate-limit.ts',
              'src/api/routes.ts',
              BLAST_FILE,
              ENDPOINT,
              'src/api/rate-limit.ts:9',
            ],
          }),
        ],
      }),
      context(),
    );

    expect(only(result.risks).file_refs).toHaveLength(MAX_RISK_FILE_REFS);
  });

  it('cuts the free-text fields to their character caps', () => {
    const result = groundBriefDraft(
      draft({
        what: 'w'.repeat(MAX_WHAT_CHARS + 50),
        risks: [
          risk({
            title: 't'.repeat(MAX_RISK_TITLE_CHARS + 50),
            explanation: 'e'.repeat(MAX_RISK_EXPLANATION_CHARS + 50),
          }),
        ],
        review_focus: [focus({ reason: 'r'.repeat(MAX_FOCUS_REASON_CHARS + 50) })],
      }),
      context(),
    );

    expect(result.what).toHaveLength(MAX_WHAT_CHARS);
    expect(only(result.risks).title).toHaveLength(MAX_RISK_TITLE_CHARS);
    expect(only(result.risks).explanation).toHaveLength(MAX_RISK_EXPLANATION_CHARS);
    expect(only(result.reviewFocus).reason).toHaveLength(MAX_FOCUS_REASON_CHARS);
  });
});

describe('blastReferences', () => {
  it('collects every file the map named, and its endpoint labels', () => {
    const blast: BriefBlastFacts = {
      status: 'ok',
      reason: null,
      indexed_sha: 'b'.repeat(40),
      changed_files: ['src/api/rate-limit.ts'],
      changed_symbols: [{ name: 'limit', file: 'src/api/rate-limit.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'limit',
          file: 'src/api/rate-limit.ts',
          callers: [{ name: 'register', file: 'src/api/routes.ts', line: 12 }],
        },
      ],
      impacted: [
        { label: ENDPOINT, kind: 'endpoint', file: 'src/api/routes.ts', depth: 0 },
        { label: 'cron nightly-reindex', kind: 'cron', file: 'src/jobs/reindex.ts', depth: 2 },
      ],
      counts: { symbols: 1, callers: 1, endpoints: 1, crons: 1 },
    };

    const refs = blastReferences(blast);

    // Deduplicated: `rate-limit.ts` arrives from three of the four sources.
    expect([...refs.files].sort()).toEqual([
      'src/api/rate-limit.ts',
      'src/api/routes.ts',
      'src/jobs/reindex.ts',
    ]);
    expect(refs.endpoints).toEqual([ENDPOINT, 'cron nightly-reindex']);
  });
});
