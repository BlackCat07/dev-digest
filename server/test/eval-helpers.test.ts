import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { DIFF_MAX_BYTES } from '../src/modules/eval/constants.js';
import {
  anchorsOverlap,
  diffByteLength,
  diffFragmentFor,
  normaliseAnchor,
  passFromOutcome,
  periodStart,
  readExpectation,
  readExpectedAnchors,
  toEvalAgentCase,
  toEvalBatch,
  toEvalBatchCaseResult,
  toEvalBatchTrendPoint,
  withExpectedAnchors,
} from '../src/modules/eval/helpers.js';
import type {
  DiffParser,
  EvalAgentSource,
  EvalFindingSource,
  StoredEvalBatch,
  StoredEvalCase,
} from '../src/modules/eval/types.js';

/**
 * The pure half of the Eval Pipeline — hermetic on purpose.
 *
 * No Postgres, no Docker, no `test/helpers/pg.ts`: everything asserted here is a
 * function of its arguments, so this file is named `*.test.ts` and runs in the
 * unit workflow. The one thing that genuinely needs a database — that a list
 * ordered on a non-unique column comes back in a TOTAL order and stays there
 * after an update — lives in `eval-order.it.test.ts`, because no fake reproduces
 * physical heap order.
 */

/* ─── the ports are real ports ────────────────────────────────────────────── */

/**
 * Compile-time only. `Impl extends Port` fails the typecheck if the shared
 * repository stops satisfying the narrow view this module declares — which is the
 * whole claim behind `modules/eval/types.ts`: the CONSUMER declares the fields it
 * reads, and the composition root satisfies them structurally with no
 * `implements` and no adapter.
 *
 * It matters here and not in `src/` because the module deliberately imports no
 * sibling: nothing under `src/modules/eval/` may name `ReviewRepository`, so
 * `tsc -p tsconfig.json` never sees the two shapes in one file. `tsconfig.eslint.json`
 * widens the include to `test/**`, which is what makes these three lines checked
 * rather than decorative.
 */
type Satisfies<Port, Impl extends Port> = Impl;
type _FindingSourceIsSatisfied = Satisfies<EvalFindingSource, ReviewRepository>;
type _AgentSourceIsSatisfied = Satisfies<EvalAgentSource, AgentsRepository>;
type _DiffParserIsSatisfied = Satisfies<DiffParser, typeof parseUnifiedDiff>;

/* ─── anchors ─────────────────────────────────────────────────────────────── */

describe('normaliseAnchor', () => {
  it('keeps an already-ordered range as it is', () => {
    expect(normaliseAnchor('src/a.ts', 72, 75)).toEqual({
      file: 'src/a.ts',
      low_line: 72,
      high_line: 75,
    });
  });

  it('orders an INVERTED range, which the live findings table really holds', () => {
    // Measured rows: notifications/repo.ts:105-30, .../routes.ts:36-20,
    // .../service.ts:52-0. `Finding` does not promise start <= end.
    expect(normaliseAnchor('src/modules/notifications/repo.ts', 105, 30)).toEqual({
      file: 'src/modules/notifications/repo.ts',
      low_line: 30,
      high_line: 105,
    });
    expect(normaliseAnchor('src/modules/notifications/service.ts', 52, 0)).toEqual({
      file: 'src/modules/notifications/service.ts',
      low_line: 0,
      high_line: 52,
    });
  });

  it('treats a single line as a one-line range', () => {
    expect(normaliseAnchor('src/a.ts', 8, 8)).toEqual({
      file: 'src/a.ts',
      low_line: 8,
      high_line: 8,
    });
  });
});

describe('anchorsOverlap — the predicate behind `conflicting_anchor`', () => {
  const at = (file: string, lo: number, hi: number) => normaliseAnchor(file, lo, hi);

  it('an identical range conflicts', () => {
    expect(anchorsOverlap(at('src/a.ts', 72, 75), at('src/a.ts', 72, 75))).toBe(true);
  });

  it('a partially overlapping range conflicts', () => {
    // AC-10's own example: :72-75 against :70-73.
    expect(anchorsOverlap(at('src/a.ts', 72, 75), at('src/a.ts', 70, 73))).toBe(true);
    // And touching at one line is still an overlap.
    expect(anchorsOverlap(at('src/a.ts', 72, 75), at('src/a.ts', 75, 90))).toBe(true);
  });

  it('a disjoint range in the SAME file does not conflict', () => {
    // AC-10's counter-example: :80-84 in the same file is a different place.
    expect(anchorsOverlap(at('src/a.ts', 72, 75), at('src/a.ts', 80, 84))).toBe(false);
  });

  it('the same lines in a DIFFERENT file do not conflict', () => {
    expect(anchorsOverlap(at('src/a.ts', 72, 75), at('src/b.ts', 72, 75))).toBe(false);
  });

  it('overlaps the same way whichever order the bounds arrived in', () => {
    const inverted = { file: 'src/a.ts', low_line: 75, high_line: 72 };
    expect(anchorsOverlap(inverted, at('src/a.ts', 74, 90))).toBe(true);
    expect(anchorsOverlap(inverted, at('src/a.ts', 80, 84))).toBe(false);
  });
});

/* ─── the stored input diff ───────────────────────────────────────────────── */

describe('diffFragmentFor', () => {
  const files = [
    {
      path: 'src/adapters/webhooks.ts',
      patch: '@@ -1,3 +1,6 @@\n context\n+added one\n+added two\n context\n',
    },
    { path: 'src/other.ts', patch: '@@ -10,2 +10,3 @@\n keep\n+new\n' },
    { path: 'assets/logo.png', patch: null },
  ];

  it('assembles a standalone one-file diff in the shape the parser expects', () => {
    const fragment = diffFragmentFor(files, 'src/adapters/webhooks.ts');
    expect(fragment).not.toBeNull();
    expect(fragment!.split('\n').slice(0, 3)).toEqual([
      'diff --git a/src/adapters/webhooks.ts b/src/adapters/webhooks.ts',
      '--- a/src/adapters/webhooks.ts',
      '+++ b/src/adapters/webhooks.ts',
    ]);
  });

  it('round-trips through the real parser to exactly one file with new-side lines', () => {
    // The load-bearing claim: the fragment must parse to the SAME new-side line
    // numbers the review that produced the finding saw, or the stored anchor
    // points at lines the agent can never report.
    const parsed = parseUnifiedDiff(diffFragmentFor(files, 'src/adapters/webhooks.ts')!);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.path).toBe('src/adapters/webhooks.ts');
    expect(parsed.files[0]!.hunks[0]!.newStart).toBe(1);
    expect(parsed.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('excludes every other file of the pull request', () => {
    const fragment = diffFragmentFor(files, 'src/adapters/webhooks.ts')!;
    expect(fragment).not.toContain('src/other.ts');
  });

  it('is null for a path the pull request does not carry', () => {
    expect(diffFragmentFor(files, 'src/absent.ts')).toBeNull();
  });

  it('is null for a file stored with no patch, rather than an empty diff', () => {
    // GitHub omits the patch for a binary or very large file. Null is a refusal
    // the caller names; an empty diff would be stored and then score as a pass.
    expect(diffFragmentFor(files, 'assets/logo.png')).toBeNull();
  });
});

describe('diffByteLength — the 64 KB budget', () => {
  it('measures ASCII one byte per character, exactly at the boundary', () => {
    const atLimit = 'a'.repeat(DIFF_MAX_BYTES);
    expect(diffByteLength(atLimit)).toBe(DIFF_MAX_BYTES);
    expect(diffByteLength(atLimit)).not.toBeGreaterThan(DIFF_MAX_BYTES);
    expect(diffByteLength(`${atLimit}a`)).toBeGreaterThan(DIFF_MAX_BYTES);
  });

  it('counts BYTES, so a multi-byte diff is over budget while its length is not', () => {
    const halfPlusOne = 'ä'.repeat(DIFF_MAX_BYTES / 2 + 1);
    expect(halfPlusOne.length).toBeLessThan(DIFF_MAX_BYTES);
    expect(diffByteLength(halfPlusOne)).toBeGreaterThan(DIFF_MAX_BYTES);
  });
});

/* ─── the dashboard window ────────────────────────────────────────────────── */

describe('periodStart', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  it('subtracts the named window from the supplied clock', () => {
    expect(periodStart('7d', now)?.toISOString()).toBe('2026-08-16T12:00:00.000Z');
    expect(periodStart('30d', now)?.toISOString()).toBe('2026-07-24T12:00:00.000Z');
    expect(periodStart('90d', now)?.toISOString()).toBe('2026-05-25T12:00:00.000Z');
  });

  it('is null for `all`, so the caller adds no predicate at all', () => {
    expect(periodStart('all', now)).toBeNull();
  });

  it('reads no clock of its own — the same arguments give the same answer', () => {
    expect(periodStart('30d', now)).toEqual(periodStart('30d', now));
  });
});

/* ─── where the expected anchors live ─────────────────────────────────────── */

describe('expected anchors inside `expected_output`', () => {
  const anchors = [normaliseAnchor('src/a.ts', 2, 8)];

  it('round-trips through the blob', () => {
    expect(readExpectedAnchors(withExpectedAnchors(null, anchors))).toEqual(anchors);
  });

  it("keeps a hand-edited blob's own keys beside the anchors", () => {
    const stored = withExpectedAnchors({ findings: [], note: 'kept' }, anchors);
    expect(readExpectedAnchors(stored)).toEqual(anchors);
    expect(stored).toMatchObject({ note: 'kept' });
  });

  it('replaces a blob with nowhere to put a key rather than dropping the anchors', () => {
    expect(readExpectedAnchors(withExpectedAnchors(['array'], anchors))).toEqual(anchors);
    expect(readExpectedAnchors(withExpectedAnchors('a string', anchors))).toEqual(anchors);
  });

  it('parses and never casts: an unreadable blob yields NO anchors', () => {
    // Empty is safe in both directions — a `must_find` case with no anchor fails,
    // and a `must_not_flag` case with no anchor cannot manufacture a false positive.
    expect(readExpectedAnchors(null)).toEqual([]);
    expect(readExpectedAnchors({ anchors: 'nope' })).toEqual([]);
    expect(readExpectedAnchors({ anchors: [{ file: 'a.ts' }] })).toEqual([]);
    expect(readExpectedAnchors({ anchors: [{ file: 'a.ts', low_line: 1.5, high_line: 2 }] })).toEqual(
      [],
    );
  });
});

/* ─── Row → DTO, and the two nulls the contract does not allow ────────────── */

const storedCase: StoredEvalCase = {
  id: 'case-1',
  workspaceId: 'ws-1',
  ownerKind: 'agent',
  ownerId: 'agent-1',
  name: 'webhook signature',
  inputDiff: 'diff --git a/src/a.ts b/src/a.ts\n',
  inputFiles: null,
  inputMeta: null,
  expectedOutput: { anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }] },
  notes: null,
  expectation: 'must_find',
  sourceFindingId: 'finding-1',
  sourceSeverity: 'warning',
  sourceCategory: 'bug',
  edited: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

describe('toEvalAgentCase', () => {
  it('maps a well-formed row, anchors included, with no execution', () => {
    const dto = toEvalAgentCase(storedCase);
    expect(dto).toMatchObject({
      id: 'case-1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      expectation: 'must_find',
      source_finding_id: 'finding-1',
      // Mapped straight through, so the row's snapshot is what the chip renders.
      source_severity: 'warning',
      source_category: 'bug',
      edited: false,
    });
    expect(dto.expected_anchors).toEqual([{ file: 'src/a.ts', low_line: 2, high_line: 8 }]);
    // Null, not a block of nulls: "never run" stays distinguishable from
    // "ran and measured nothing" all the way to the screen.
    expect(dto.last_execution).toBeNull();
  });

  it('resolves a NULL expectation to `must_find` — the non-flattering reading', () => {
    // The column is nullable (the table shipped before this feature) and the
    // contract's field is not. `must_find` with no anchors scores as FAILED; a
    // `must_not_flag` fallback would pass for free and inflate every batch.
    const dto = toEvalAgentCase({ ...storedCase, expectation: null, expectedOutput: null });
    expect(dto.expectation).toBe('must_find');
    expect(dto.expected_anchors).toEqual([]);
  });

  it('resolves an unrecognised expectation the same way', () => {
    expect(toEvalAgentCase({ ...storedCase, expectation: 'maybe_find' }).expectation).toBe(
      'must_find',
    );
    expect(readExpectation(null)).toBe('must_find');
    expect(readExpectation('must_not_flag')).toBe('must_not_flag');
  });

  it('resolves a NULL input diff to the empty string, not to undefined', () => {
    // An empty diff parses to zero files and is recorded `diff_unparseable`
    // with no model call — again the non-flattering reading.
    const dto = toEvalAgentCase({ ...storedCase, inputDiff: null });
    expect(dto.input_diff).toBe('');
    expect(parseUnifiedDiff(dto.input_diff).files).toEqual([]);
  });

  it('carries the most recent execution when there is one', () => {
    const dto = toEvalAgentCase(storedCase, {
      outcome: 'failed',
      notRunReason: null,
      expectedCount: 1,
      actualCount: 0,
    });
    expect(dto.last_execution).toEqual({
      outcome: 'failed',
      not_run_reason: null,
      expected_count: 1,
      actual_count: 0,
    });
  });

  it('reads an unrecognised outcome as `not_run` with a named reason', () => {
    // `not_run` counts in the covered total and in NEITHER tally. And the
    // contract says a `not_run` outcome always carries a reason, so an
    // unreadable one becomes `not_scorable` rather than a null with no wording.
    const dto = toEvalAgentCase(storedCase, {
      outcome: null,
      notRunReason: null,
      expectedCount: null,
      actualCount: null,
    });
    expect(dto.last_execution).toEqual({
      outcome: 'not_run',
      not_run_reason: 'not_scorable',
      expected_count: null,
      actual_count: null,
    });
  });
});

const storedBatch: StoredEvalBatch = {
  id: 'batch-1',
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  agentName: 'General Reviewer',
  agentVersion: 7,
  systemPromptSnapshot: 'Review the diff.',
  modelSnapshot: 'gpt-4o-mini',
  status: 'complete',
  label: null,
  startedAt: new Date('2026-08-20T10:00:00.000Z'),
  finishedAt: new Date('2026-08-20T10:04:00.000Z'),
  casesCovered: 20,
  casesPassed: 17,
  recall: 0.82,
  precision: 0.75,
  citationAccuracy: 0.9,
  truePositives: 14,
  falseNegatives: 3,
  falsePositives: 4,
  costUsd: 0.0051,
  error: null,
};

describe('toEvalBatch', () => {
  it('serves both timestamps as ISO strings and keeps every null a null', () => {
    const dto = toEvalBatch(storedBatch);
    expect(dto.started_at).toBe('2026-08-20T10:00:00.000Z');
    expect(dto.finished_at).toBe('2026-08-20T10:04:00.000Z');
    expect(dto).toMatchObject({ agent_version: 7, cases_passed: 17, cases_covered: 20 });

    const running = toEvalBatch({
      ...storedBatch,
      status: 'running',
      finishedAt: null,
      casesCovered: null,
      casesPassed: null,
      recall: null,
      costUsd: null,
    });
    expect(running.finished_at).toBeNull();
    expect(running.recall).toBeNull();
    // Null cost is "at least one case's cost is unknown", never a free batch.
    expect(running.cost_usd).toBeNull();
    expect(running.cost_usd).not.toBe(0);
  });

  it('keeps a batch readable when its agent is gone', () => {
    const orphan = toEvalBatch({ ...storedBatch, agentId: null, agentName: null });
    expect(orphan.agent_id).toBeNull();
    expect(orphan.agent_name).toBeNull();
    // The snapshots are what make it still readable: they are text on the row.
    expect(orphan.system_prompt_snapshot).toBe('Review the diff.');
    expect(orphan.model_snapshot).toBe('gpt-4o-mini');
  });

  it('reads an unrecognised status as `error`, never as `complete`', () => {
    expect(toEvalBatch({ ...storedBatch, status: 'finished' }).status).toBe('error');
  });
});

describe('toEvalBatchCaseResult', () => {
  it('maps a case execution and its grounding counts', () => {
    expect(
      toEvalBatchCaseResult({
        caseId: 'case-1',
        caseName: 'webhook signature',
        outcome: 'passed',
        notRunReason: null,
        expectedCount: 1,
        actualCount: 1,
        keptCount: 3,
        droppedCount: 1,
        durationMs: 4200,
        costUsd: 0.0004,
      }),
    ).toEqual({
      case_id: 'case-1',
      case_name: 'webhook signature',
      outcome: 'passed',
      not_run_reason: null,
      expected_count: 1,
      actual_count: 1,
      kept_count: 3,
      dropped_count: 1,
      duration_ms: 4200,
      cost_usd: 0.0004,
    });
  });

  it('keeps a `not_run` reason, which is what makes it distinct from a failure', () => {
    const result = toEvalBatchCaseResult({
      caseId: 'case-2',
      caseName: 'no diff',
      outcome: 'not_run',
      notRunReason: 'diff_unparseable',
      expectedCount: 1,
      actualCount: null,
      keptCount: null,
      droppedCount: null,
      durationMs: null,
      costUsd: null,
    });
    expect(result.outcome).toBe('not_run');
    expect(result.not_run_reason).toBe('diff_unparseable');
  });
});

describe('toEvalBatchTrendPoint', () => {
  it('derives a pass rate from the recorded counts', () => {
    const point = toEvalBatchTrendPoint(toEvalBatch(storedBatch));
    expect(point).toMatchObject({ batch_id: 'batch-1', agent_version: 7, recall: 0.82 });
    expect(point.pass_rate).toBeCloseTo(17 / 20, 10);
  });

  it('is null — never 0 — when there is nothing to divide', () => {
    const noCounts = toEvalBatchTrendPoint(
      toEvalBatch({ ...storedBatch, casesCovered: null, casesPassed: null }),
    );
    expect(noCounts.pass_rate).toBeNull();
    const emptyBatch = toEvalBatchTrendPoint(
      toEvalBatch({ ...storedBatch, casesCovered: 0, casesPassed: 0 }),
    );
    expect(emptyBatch.pass_rate).toBeNull();
    expect(emptyBatch.pass_rate).not.toBe(0);
  });

  it('carries a null metric through as null', () => {
    const point = toEvalBatchTrendPoint(
      toEvalBatch({ ...storedBatch, recall: null, precision: null, citationAccuracy: null }),
    );
    expect([point.recall, point.precision, point.citation_accuracy]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('passFromOutcome — the shipped `pass` column', () => {
  it('is null for `not_run`, which is why `outcome` had to exist', () => {
    expect(passFromOutcome('passed')).toBe(true);
    expect(passFromOutcome('failed')).toBe(false);
    // Not `false`: an infrastructure failure is not a wrong answer.
    expect(passFromOutcome('not_run')).toBeNull();
  });
});
