/**
 * shape.test.ts — hermetic by construction: `src/shape.ts` is pure, so there is
 * no client, no `fetchImpl` and no clock to stub here.
 *
 * Three things this file is deliberately strict about.
 *
 *  1. **Order is asserted against the SORTED sequence, never against "unchanged".**
 *     Every ordering test feeds the fixtures in an order that is already wrong
 *     and compares the output to a hard-coded expected sequence, then feeds the
 *     same fixtures reversed and requires the identical output. Asserting only
 *     that a list came back unchanged passes without the comparator
 *     (`server/INSIGHTS.md`, 2026-08-06).
 *  2. **The projections are asserted by EXACT KEY SET**, not by "the field I want
 *     is there". A projection that grows a field silently is the failure mode
 *     worth a gate: `system_prompt`, verified `evidence` snippets and the whole
 *     `scan`/`budget` envelope all live one spread away from the model's context
 *     window. `withExtras` puts keys onto a fixture that the contract does not
 *     even carry, so a passthrough is caught whatever the contract does next.
 *  3. **Counts are asserted on a CAPPED answer.** "Counts before the cap" is the
 *     one property of `shapeFindings` a page-shaped implementation gets wrong
 *     while looking right.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConventionScan,
  ConventionScanBudget,
  ConventionStatus,
  ConventionsPayload,
  ExtractedConvention,
  FindingCategory,
  FindingRecord,
  ReviewRecord,
  Severity,
} from '@devdigest/shared';
import {
  DEFAULT_FINDINGS_LIMIT,
  MAX_CONVENTIONS,
  MAX_FINDINGS_LIMIT,
  MAX_PROSE_CHARS,
  MAX_SNIPPET_CHARS,
  aggregateScore,
  aggregateVerdict,
  countsBySeverity,
  latestReviewPerAgent,
  reviewAgentKey,
  shapeConventions,
  shapeFindings,
} from '../src/shape.js';

/**
 * The house pattern from `test/errors.test.ts` and `test/resolve.test.ts`: text
 * this server puts in front of the model names the next action. Applied here to
 * `truncated` and to both `next_step` texts.
 */
const IMPERATIVE = /(Start|Wait|Retry|retry|Check|check|report|set) /;

/**
 * Add keys a contract does not have, without a cast: `Object.assign` widens
 * rather than checking excess properties, so the result is still assignable to
 * the fixture's type. This is how a would-be passthrough is caught — the input
 * really does carry `system_prompt`.
 */
function withExtras<T extends object>(base: T, extras: Record<string, unknown>): T {
  return Object.assign({}, base, extras);
}

// --------------------------------------------------------------------------
// Findings fixtures
// --------------------------------------------------------------------------

interface FindingInput {
  readonly id: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly file?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly category?: FindingCategory;
  readonly dismissedAt?: string | null;
  readonly rationale?: string;
  readonly suggestion?: string | null;
}

/**
 * `title` mirrors `id` so an ordering assertion can name the rows it expects:
 * `ShapedFinding` carries no id, by design.
 *
 * The row also carries `kind`, `scope`, `trifecta_components` and the finding's
 * own `evidence` array — all real contract fields, all of which must stay out of
 * the projection.
 */
function findingRow(input: FindingInput): FindingRecord {
  const startLine = input.startLine ?? 10;
  return {
    id: input.id,
    review_id: 'review-1',
    severity: input.severity,
    category: input.category ?? 'bug',
    title: input.id,
    file: input.file ?? 'src/api/users.ts',
    start_line: startLine,
    end_line: input.endLine ?? startLine + 6,
    rationale: input.rationale ?? 'Because the input is never validated.',
    // `=== undefined` rather than `??`: an explicit `null` is the case under
    // test (a finding with no suggestion), and `??` would fill it back in.
    suggestion: input.suggestion === undefined ? 'Parse it with the request schema.' : input.suggestion,
    confidence: input.confidence,
    kind: 'finding',
    scope: 'in_scope',
    trifecta_components: ['untrusted_input'],
    evidence: [{ component: 'untrusted_input', file: 'src/api/users.ts', line: 13 }],
    accepted_at: null,
    dismissed_at: input.dismissedAt ?? null,
  };
}

/**
 * Deliberately shuffled, and every comparator step is exercised by a tie above
 * it: two CRITICALs tie on confidence and split on file, two WARNINGs tie on
 * file and split on `start_line`, two SUGGESTIONs tie on everything and split on
 * `id`.
 */
const UNORDERED_FINDINGS: readonly FindingRecord[] = [
  findingRow({ id: 'f-sug-b', severity: 'SUGGESTION', confidence: 0.5 }),
  findingRow({ id: 'f-warn-late', severity: 'WARNING', confidence: 0.8, startLine: 90 }),
  findingRow({ id: 'f-crit-low', severity: 'CRITICAL', confidence: 0.6 }),
  findingRow({ id: 'f-sug-a', severity: 'SUGGESTION', confidence: 0.5 }),
  findingRow({ id: 'f-crit-zed', severity: 'CRITICAL', confidence: 0.9, file: 'src/z.ts' }),
  findingRow({ id: 'f-warn-early', severity: 'WARNING', confidence: 0.8, startLine: 12 }),
  findingRow({ id: 'f-crit-alpha', severity: 'CRITICAL', confidence: 0.9, file: 'src/a.ts' }),
];

/** severity, then confidence desc, then file, then start_line, then id. */
const EXPECTED_FINDING_ORDER: readonly string[] = [
  'f-crit-alpha',
  'f-crit-zed',
  'f-crit-low',
  'f-warn-early',
  'f-warn-late',
  'f-sug-a',
  'f-sug-b',
];

const CONCISE_FINDING_KEYS = ['category', 'confidence', 'file', 'lines', 'severity', 'title'];

describe('shapeFindings', () => {
  it('returns the SORTED order, and the same one whatever order the API sent', () => {
    const forwards = shapeFindings(UNORDERED_FINDINGS);
    const backwards = shapeFindings([...UNORDERED_FINDINGS].reverse());

    expect(forwards.findings.map((finding) => finding.title)).toEqual(EXPECTED_FINDING_ORDER);
    expect(backwards.findings.map((finding) => finding.title)).toEqual(EXPECTED_FINDING_ORDER);
    expect(forwards.total).toBe(7);
    expect(forwards.truncated).toBeUndefined();
  });

  it('drops dismissed findings, out of the counts as well as out of the list', () => {
    const shaped = shapeFindings([
      ...UNORDERED_FINDINGS,
      findingRow({
        id: 'f-dismissed',
        severity: 'CRITICAL',
        confidence: 1,
        dismissedAt: '2026-08-13T09:00:00.000Z',
      }),
    ]);

    // A human decided it is not a problem here; re-presenting it would invite
    // the model to argue with that decision, and cost tokens to do it.
    expect(shaped.findings.map((finding) => finding.title)).toEqual(EXPECTED_FINDING_ORDER);
    expect(shaped.total).toBe(7);
    expect(shaped.counts).toEqual({ CRITICAL: 3, WARNING: 2, SUGGESTION: 2 });
  });

  it('counts every severity BEFORE the cap, and says how to read the rest', () => {
    const shaped = shapeFindings(UNORDERED_FINDINGS, { limit: 2 });

    expect(shaped.findings.map((finding) => finding.title)).toEqual([
      'f-crit-alpha',
      'f-crit-zed',
    ]);
    // The page holds two CRITICALs and nothing else; the counts still describe
    // the whole review, or the model reads "1 WARNING" off a two-row page.
    expect(shaped.counts).toEqual({ CRITICAL: 3, WARNING: 2, SUGGESTION: 2 });
    expect(shaped.total).toBe(7);

    expect(shaped.truncated).toBeDefined();
    expect(shaped.truncated ?? '').toContain('offset 2');
    expect(shaped.truncated ?? '').toContain('of 7');
    expect(shaped.truncated ?? '').toMatch(IMPERATIVE);
  });

  it('pages with offset, clamps a silly limit, and reports an offset past the end', () => {
    const second = shapeFindings(UNORDERED_FINDINGS, { offset: 5, limit: 2 });
    expect(second.findings.map((finding) => finding.title)).toEqual(['f-sug-a', 'f-sug-b']);
    expect(second.offset).toBe(5);
    // Last page: nothing further to fetch, so it points back at offset 0.
    expect(second.truncated ?? '').toContain('offset 0');

    const clamped = shapeFindings(UNORDERED_FINDINGS, { limit: MAX_FINDINGS_LIMIT + 500 });
    expect(clamped.findings).toHaveLength(7);
    expect(clamped.offset).toBe(0);

    const negative = shapeFindings(UNORDERED_FINDINGS, { offset: -4, limit: 0 });
    expect(negative.offset).toBe(0);
    expect(negative.findings).toHaveLength(1);

    const past = shapeFindings(UNORDERED_FINDINGS, { offset: 99 });
    expect(past.findings).toEqual([]);
    expect(past.total).toBe(7);
    expect(past.truncated ?? '').toContain('smaller offset');
    expect(past.truncated ?? '').toMatch(IMPERATIVE);
  });

  it('defaults to concise, and concise is an exact key set - never a passthrough', () => {
    const shaped = shapeFindings([
      withExtras(findingRow({ id: 'f-1', severity: 'CRITICAL', confidence: 0.9 }), {
        system_prompt: 'SECRET-PROMPT',
        output_schema: { type: 'object' },
      }),
    ]);

    const [finding] = shaped.findings;
    expect(finding).toBeDefined();
    expect(Object.keys(finding ?? {}).sort()).toEqual(CONCISE_FINDING_KEYS);
    expect(finding?.lines).toBe('10-16');

    const serialised = JSON.stringify(shaped);
    for (const leak of [
      'system_prompt',
      'SECRET-PROMPT',
      'output_schema',
      'review_id',
      'dismissed_at',
      'trifecta_components',
      'evidence',
      'start_line',
    ]) {
      expect(serialised, `${leak} escaped the projection`).not.toContain(leak);
    }
  });

  it('adds ONLY rationale and suggestion in detailed, each capped at 1200 chars', () => {
    const shaped = shapeFindings(
      [
        findingRow({
          id: 'f-long',
          severity: 'WARNING',
          confidence: 0.7,
          rationale: 'r'.repeat(5000),
          suggestion: 's'.repeat(5000),
        }),
        findingRow({
          id: 'f-no-suggestion',
          severity: 'SUGGESTION',
          confidence: 0.7,
          suggestion: null,
        }),
      ],
      { format: 'detailed' },
    );

    const [long, bare] = shaped.findings;
    expect(Object.keys(long ?? {}).sort()).toEqual(
      [...CONCISE_FINDING_KEYS, 'rationale', 'suggestion'].sort(),
    );
    expect((long?.rationale ?? '').length).toBe(MAX_PROSE_CHARS);
    expect(long?.rationale ?? '').toMatch(/\.\.\.$/);
    expect((long?.suggestion ?? '').length).toBe(MAX_PROSE_CHARS);

    // No suggestion means no key: `"suggestion": ""` costs a key and says nothing.
    expect(Object.keys(bare ?? {}).sort()).toEqual([...CONCISE_FINDING_KEYS, 'rationale'].sort());
  });

  it('renders a single-line finding as one number, not a degenerate range', () => {
    const shaped = shapeFindings([
      findingRow({ id: 'f-1', severity: 'WARNING', confidence: 0.5, startLine: 42, endLine: 42 }),
    ]);

    expect(shaped.findings[0]?.lines).toBe('42');
  });

  it('answers an empty review without a truncation notice', () => {
    const shaped = shapeFindings([]);

    expect(shaped).toEqual({
      total: 0,
      counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      offset: 0,
      findings: [],
    });
  });

  it('keeps DEFAULT_FINDINGS_LIMIT under MAX_FINDINGS_LIMIT', () => {
    expect(DEFAULT_FINDINGS_LIMIT).toBeLessThanOrEqual(MAX_FINDINGS_LIMIT);
  });
});

describe('countsBySeverity', () => {
  it('counts exactly the list it is given, in the FindingsBySeverity shape', () => {
    expect(countsBySeverity(UNORDERED_FINDINGS)).toEqual({
      CRITICAL: 3,
      WARNING: 2,
      SUGGESTION: 2,
    });
    expect(countsBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

// --------------------------------------------------------------------------
// Reviews
// --------------------------------------------------------------------------

interface ReviewInput {
  readonly id: string;
  readonly agentId: string | null;
  readonly createdAt: string;
  readonly kind?: 'review' | 'summary';
  readonly verdict?: ReviewRecord['verdict'];
  readonly score?: number | null;
}

function reviewRow(input: ReviewInput): ReviewRecord {
  return {
    id: input.id,
    pr_id: 'pr-482',
    agent_id: input.agentId,
    run_id: `run-${input.id}`,
    agent_name: 'Security Reviewer',
    kind: input.kind ?? 'review',
    // `=== undefined`, not `??`: `null` is a real value for both of these and is
    // exactly what the aggregate tests pass in.
    verdict: input.verdict === undefined ? 'comment' : input.verdict,
    summary: 'Looks mostly fine.',
    score: input.score === undefined ? 70 : input.score,
    model: 'gpt-4.1-mini',
    grounding: 'diff',
    created_at: input.createdAt,
    findings: [],
  };
}

describe('latestReviewPerAgent', () => {
  it('keeps one row per agent, newest first, and ignores kind !== review', () => {
    // `reviewsForPull` does NOT filter kind (server/INSIGHTS.md, 2026-08-03), so
    // a summary row arrives here with its own verdict and score.
    const reviews = [
      reviewRow({ id: 'r-old-a', agentId: 'agent-a', createdAt: '2026-08-10T10:00:00.000Z' }),
      reviewRow({
        id: 'r-summary',
        agentId: 'agent-a',
        createdAt: '2026-08-13T10:00:00.000Z',
        kind: 'summary',
      }),
      reviewRow({ id: 'r-new-a', agentId: 'agent-a', createdAt: '2026-08-12T10:00:00.000Z' }),
      reviewRow({ id: 'r-b', agentId: 'agent-b', createdAt: '2026-08-11T10:00:00.000Z' }),
    ];

    const latest = latestReviewPerAgent(reviews);

    expect(latest.map((review) => review.id)).toEqual(['r-new-a', 'r-b']);
    expect(latest.every((review) => review.kind === 'review')).toBe(true);
  });

  it('breaks a created_at tie on id ascending, in the SORTED order', () => {
    // Every row of one run is written in a single transaction, where `now()` is
    // transaction-scoped - so ties are the normal case, not a contrived one.
    const sameInstant = '2026-08-13T10:00:00.000Z';
    const reviews = [
      reviewRow({ id: 'r-c', agentId: 'agent-c', createdAt: sameInstant }),
      reviewRow({ id: 'r-a', agentId: 'agent-a', createdAt: sameInstant }),
      reviewRow({ id: 'r-b', agentId: 'agent-b', createdAt: sameInstant }),
    ];

    const forwards = latestReviewPerAgent(reviews);
    const backwards = latestReviewPerAgent([...reviews].reverse());

    expect(forwards.map((review) => review.id)).toEqual(['r-a', 'r-b', 'r-c']);
    expect(backwards.map((review) => review.id)).toEqual(['r-a', 'r-b', 'r-c']);
  });

  it('keeps agent-less rows apart instead of collapsing them into one bucket', () => {
    // `reviews.agent_id` carries no FK and no notNull (server/INSIGHTS.md,
    // 2026-08-03): keying on the raw value folds every agent-deleted row into a
    // single bucket, and the reduction then drops all but one of them.
    const reviews = [
      reviewRow({ id: 'r-orphan-1', agentId: null, createdAt: '2026-08-13T10:00:00.000Z' }),
      reviewRow({ id: 'r-orphan-2', agentId: null, createdAt: '2026-08-12T10:00:00.000Z' }),
      reviewRow({ id: 'r-live', agentId: 'agent-a', createdAt: '2026-08-11T10:00:00.000Z' }),
    ];

    const latest = latestReviewPerAgent(reviews);

    expect(latest.map((review) => review.id)).toEqual(['r-orphan-1', 'r-orphan-2', 'r-live']);
    expect(reviewAgentKey({ agent_id: null, id: 'r-orphan-1' })).toBe('row:r-orphan-1');
    // The prefix is what stops a row id from colliding with an agent id.
    expect(reviewAgentKey({ agent_id: 'agent-a', id: 'r-live' })).toBe('agent-a');
  });

  it('stays total when created_at is not a parsable timestamp', () => {
    const reviews = [
      reviewRow({ id: 'r-1', agentId: 'agent-a', createdAt: 'not-a-date' }),
      reviewRow({ id: 'r-2', agentId: 'agent-b', createdAt: 'also-not-a-date' }),
    ];

    const forwards = latestReviewPerAgent(reviews).map((review) => review.id);
    const backwards = latestReviewPerAgent([...reviews].reverse()).map((review) => review.id);

    expect(forwards).toEqual(backwards);
    expect(forwards).toHaveLength(2);
  });

  it('answers an empty list with an empty list', () => {
    expect(latestReviewPerAgent([])).toEqual([]);
  });
});

describe('aggregateVerdict', () => {
  it('lets the worst verdict win, and never reports absence as approve', () => {
    const at = '2026-08-13T10:00:00.000Z';

    expect(
      aggregateVerdict([
        reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, verdict: 'approve' }),
        reviewRow({ id: 'r-2', agentId: 'b', createdAt: at, verdict: 'request_changes' }),
        reviewRow({ id: 'r-3', agentId: 'c', createdAt: at, verdict: 'comment' }),
      ]),
    ).toBe('request_changes');

    expect(
      aggregateVerdict([
        reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, verdict: 'approve' }),
        reviewRow({ id: 'r-2', agentId: 'b', createdAt: at, verdict: 'comment' }),
      ]),
    ).toBe('comment');

    expect(
      aggregateVerdict([
        reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, verdict: 'approve' }),
      ]),
    ).toBe('approve');

    // One agent asking for changes is not cancelled by another approving, and no
    // verdict at all is not an approval.
    expect(aggregateVerdict([reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, verdict: null })]))
      .toBeNull();
    expect(aggregateVerdict([])).toBeNull();
  });
});

describe('aggregateScore', () => {
  it('takes the MINIMUM, matching the PrMeta.score contract, and skips nulls', () => {
    const at = '2026-08-13T10:00:00.000Z';

    expect(
      aggregateScore([
        reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, score: 88 }),
        reviewRow({ id: 'r-2', agentId: 'b', createdAt: at, score: 42 }),
        reviewRow({ id: 'r-3', agentId: 'c', createdAt: at, score: 70 }),
      ]),
      // An average (66) would disagree with what the studio shows for the same
      // pull request, and would let a lenient agent dilute a strict one.
    ).toBe(42);

    expect(
      aggregateScore([
        reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, score: null }),
        reviewRow({ id: 'r-2', agentId: 'b', createdAt: at, score: 0 }),
      ]),
      // 0 is a real score and must not be treated as absent.
    ).toBe(0);

    expect(
      aggregateScore([reviewRow({ id: 'r-1', agentId: 'a', createdAt: at, score: null })]),
    ).toBeNull();
    expect(aggregateScore([])).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Conventions
// --------------------------------------------------------------------------

interface ConventionInput {
  readonly id: string;
  readonly rule: string;
  readonly confidence: number;
  readonly status?: ConventionStatus;
  readonly category?: ExtractedConvention['category'];
  readonly snippet?: string;
}

function conventionRow(input: ConventionInput): ExtractedConvention {
  return {
    id: input.id,
    category: input.category ?? 'imports',
    rule: input.rule,
    rationale: 'Every relative import in this package carries the extension.',
    evidence: [
      {
        path: 'src/modules/agents/service.ts',
        start_line: 13,
        end_line: 19,
        snippet: input.snippet ?? "import { toAgentDto } from './helpers.js';",
        match: 'exact',
      },
      {
        path: 'src/modules/repos/service.ts',
        start_line: 4,
        end_line: 4,
        snippet: "import { clonePathFor } from './helpers.js';",
        match: 'shifted',
      },
    ],
    confidence: input.confidence,
    adherence: { conforming: 62, violating: 2 },
    status: input.status ?? 'pending',
    edited: false,
    skill_id: null,
    created_at: '2026-08-13T10:00:00.000Z',
  };
}

const SCAN: ConventionScan = {
  id: 'scan-1',
  status: 'done',
  commit_sha: 'abc123',
  eligible_files: 26,
  sampled_files: 26,
  proposed: 12,
  dropped_unverified: 4,
  dropped_low_adherence: 3,
  kept: 5,
  cost_usd: 0.0031,
  started_at: '2026-08-13T09:59:00.000Z',
  finished_at: '2026-08-13T10:00:00.000Z',
  error: null,
};

const BUDGET: ConventionScanBudget = {
  indexed_files: 300,
  eligible_files: 26,
  planned_sample: 26,
  planned_tokens: 41_000,
  planned_calls: 10,
  estimated_cost_usd: 0.004,
  capped_by: null,
  can_scan: true,
  blocked_reason: null,
};

function payload(input: {
  readonly scan: ConventionScan | null;
  readonly candidates: readonly ExtractedConvention[];
}): ConventionsPayload {
  return {
    scan: input.scan,
    budget: BUDGET,
    candidates: [...input.candidates],
    repo: { full_name: 'acme/payments-api', sha: 'abc123' },
  };
}

/** Shuffled, and every comparator step is exercised by a tie above it. */
const UNORDERED_CONVENTIONS: readonly ExtractedConvention[] = [
  conventionRow({ id: 'c-pending-low', rule: 'Zed rule', confidence: 0.4 }),
  conventionRow({ id: 'c-accepted-low', rule: 'Accepted low', confidence: 0.5, status: 'accepted' }),
  conventionRow({ id: 'c-rejected-high', rule: 'Rejected', confidence: 0.99, status: 'rejected' }),
  conventionRow({ id: 'c-pending-tie-b', rule: 'Beta rule', confidence: 0.9 }),
  conventionRow({ id: 'c-pending-tie-c', rule: 'Aaa rule', confidence: 0.9 }),
  conventionRow({
    id: 'c-pending-tie-a',
    rule: 'Alpha rule',
    confidence: 0.9,
    category: 'error-handling',
  }),
  conventionRow({ id: 'c-accepted-high', rule: 'Accepted high', confidence: 0.95, status: 'accepted' }),
];

/**
 * triage, then confidence desc, then category, then rule.
 *
 * The 0.9 pending group splits on CATEGORY first (`error-handling` before
 * `imports`, so "Alpha rule" leads) and only then on rule text ("Aaa rule"
 * before "Beta rule") - which is what makes both steps of the comparator
 * observable rather than assumed.
 */
const EXPECTED_CONVENTION_ORDER: readonly string[] = [
  'Accepted high',
  'Accepted low',
  'Alpha rule',
  'Aaa rule',
  'Beta rule',
  'Zed rule',
  'Rejected',
];

const CONCISE_CONVENTION_KEYS = ['accepted', 'category', 'confidence', 'file', 'lines', 'rule'];

describe('shapeConventions', () => {
  it('returns every candidate with accepted, in the SORTED order, input order irrelevant', () => {
    const forwards = shapeConventions(payload({ scan: SCAN, candidates: UNORDERED_CONVENTIONS }));
    const backwards = shapeConventions(
      payload({ scan: SCAN, candidates: [...UNORDERED_CONVENTIONS].reverse() }),
    );

    expect(forwards.conventions.map((convention) => convention.rule)).toEqual(
      EXPECTED_CONVENTION_ORDER,
    );
    expect(backwards.conventions.map((convention) => convention.rule)).toEqual(
      EXPECTED_CONVENTION_ORDER,
    );

    // All candidates, not only the accepted ones: an untriaged repository would
    // otherwise answer "no conventions" while holding six measured rules.
    expect(forwards.count).toBe(7);
    expect(forwards.accepted_count).toBe(2);
    expect(forwards.conventions.map((convention) => convention.accepted)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(forwards.repo).toBe('acme/payments-api');
    expect(forwards.scanned).toBe(true);
    expect(forwards.next_step).toBeUndefined();
    expect(forwards.truncated).toBeUndefined();
  });

  it('drops the scan/budget envelope and keeps evidence out of concise', () => {
    const shaped = shapeConventions(
      payload({
        scan: SCAN,
        candidates: [
          withExtras(conventionRow({ id: 'c-1', rule: 'One rule', confidence: 0.8 }), {
            system_prompt: 'SECRET-PROMPT',
          }),
        ],
      }),
    );

    const [convention] = shaped.conventions;
    expect(Object.keys(convention ?? {}).sort()).toEqual(CONCISE_CONVENTION_KEYS);
    expect(convention?.file).toBe('src/modules/agents/service.ts');
    expect(convention?.lines).toBe('13-19');

    const serialised = JSON.stringify(shaped);
    for (const leak of [
      'system_prompt',
      'SECRET-PROMPT',
      'budget',
      'planned_tokens',
      'eligible_files',
      'dropped_low_adherence',
      'commit_sha',
      'can_scan',
      'snippet',
      'evidence',
      'skill_id',
      'created_at',
      'edited',
      'adherence',
    ]) {
      expect(serialised, `${leak} escaped the projection`).not.toContain(leak);
    }
  });

  it('adds rationale and capped evidence only in detailed', () => {
    const shaped = shapeConventions(
      payload({
        scan: SCAN,
        candidates: [
          conventionRow({
            id: 'c-1',
            rule: 'One rule',
            confidence: 0.8,
            snippet: 'x'.repeat(4000),
          }),
        ],
      }),
      { format: 'detailed' },
    );

    const [convention] = shaped.conventions;
    expect(Object.keys(convention ?? {}).sort()).toEqual(
      [...CONCISE_CONVENTION_KEYS, 'rationale', 'evidence'].sort(),
    );
    expect(convention?.evidence).toHaveLength(2);
    expect(convention?.evidence?.[0]?.file).toBe('src/modules/agents/service.ts');
    expect((convention?.evidence?.[0]?.snippet ?? '').length).toBe(MAX_SNIPPET_CHARS);
    expect(convention?.evidence?.[1]?.lines).toBe('4');
  });

  it('distinguishes never-scanned from scanned-and-empty, with different next steps', () => {
    const neverScanned = shapeConventions(payload({ scan: null, candidates: [] }));
    const scannedEmpty = shapeConventions(payload({ scan: SCAN, candidates: [] }));

    expect(neverScanned.scanned).toBe(false);
    expect(scannedEmpty.scanned).toBe(true);
    expect(neverScanned.conventions).toEqual([]);
    expect(scannedEmpty.conventions).toEqual([]);

    const first = neverScanned.next_step ?? '';
    const second = scannedEmpty.next_step ?? '';

    // Same empty array, two different facts: nothing was measured, versus
    // everything measured was dropped. A model cannot tell those apart on its
    // own, and they call for different actions.
    expect(first).not.toBe(second);
    expect(first).toContain('never');
    expect(first).toContain('run a scan');
    expect(second).toContain('kept none');
    expect(second).toContain('Re-run');
    expect(first).toMatch(IMPERATIVE);
    expect(second).toMatch(IMPERATIVE);
    expect(first).toContain('acme/payments-api');
    expect(second).toContain('acme/payments-api');
  });

  it('caps a long list and says where the rest is', () => {
    const many = Array.from({ length: MAX_CONVENTIONS + 4 }, (_unused, index) =>
      conventionRow({
        id: `c-${String(index).padStart(2, '0')}`,
        rule: `Rule ${String(index).padStart(2, '0')}`,
        confidence: 0.5,
      }),
    );

    const shaped = shapeConventions(payload({ scan: SCAN, candidates: many }));

    expect(shaped.conventions).toHaveLength(MAX_CONVENTIONS);
    expect(shaped.count).toBe(MAX_CONVENTIONS + 4);
    expect(shaped.truncated ?? '').toContain(`${MAX_CONVENTIONS} of ${MAX_CONVENTIONS + 4}`);
    expect(shaped.truncated ?? '').toContain('acme/payments-api');
    expect(shaped.truncated ?? '').toMatch(IMPERATIVE);
    expect(shaped.next_step).toBeUndefined();
  });
});
