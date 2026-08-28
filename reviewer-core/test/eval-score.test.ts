/**
 * scoreEvalBatch — the eval scorer, as arithmetic.
 *
 * These are plain unit tests over hand-written arrays: no fixture, no database,
 * no provider, no clock. That is not a convenience, it is the property under
 * test — the whole reason this feature can compare a number from last week with
 * a number from today is that scoring is a comparison rather than a judgement.
 *
 * Four things here are worth more than the rest:
 *
 *  1. INVERTED RANGES. The `Finding` contract does not guarantee
 *     `start_line <= end_line`, and the live table holds rows where it does not
 *     (`.../pull.repo.ts:108-9`, `.../notifications/repo.ts:105-30`,
 *     `.../routes.ts:36-20`, `.../service.ts:52-0`, `.../classifier.ts:21-1`).
 *     Two of those sit in the demo eval set, so an unnormalised comparison is
 *     wrong on real data on day one, not eventually.
 *  2. A ZERO DENOMINATOR IS NULL. "We could not measure recall" is not "recall
 *     is 0%", and the screens render them differently.
 *  3. A `not_run` CASE STAYS IN THE DENOMINATOR. A harness that drops the case a
 *     timeout killed prints `4/5` for a set of five and looks like it improved.
 *  4. AGREEMENT WITH THE GROUNDING GATE. The last block runs `groundFindings`
 *     and the scorer over one finding and asserts they say the same thing about
 *     whether it sits on the diff's new side. The scorer re-derives the
 *     min/max normalisation rather than importing the gate's private helper, so
 *     "the two gates cannot disagree" needs to be a check and not a comment.
 */
import { describe, it, expect } from 'vitest';
import type { EvalAnchor, Finding, UnifiedDiff } from '@devdigest/shared';
import { groundFindings } from '../src/grounding.js';
import { scoreEvalBatch, type EvalCaseOutput, type EvalScoreCase } from '../src/index.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'because',
    confidence: 0.9,
    kind: 'finding',
    ...over,
  };
}

function anchor(file: string, low: number, high: number): EvalAnchor {
  return { file, low_line: low, high_line: high };
}

function output(
  findings: readonly Finding[],
  kept = findings.length,
  dropped = 0,
): EvalCaseOutput {
  return { kind: 'output', findings, kept_count: kept, dropped_count: dropped };
}

/** One `must_find` case over a single anchor and a single actual finding set. */
function mustFind(
  id: string,
  anchors: readonly EvalAnchor[],
  out: EvalCaseOutput,
): EvalScoreCase {
  return { case_id: id, expectation: 'must_find', expected_anchors: anchors, output: out };
}

function mustNotFlag(
  id: string,
  anchors: readonly EvalAnchor[],
  out: EvalCaseOutput,
): EvalScoreCase {
  return { case_id: id, expectation: 'must_not_flag', expected_anchors: anchors, output: out };
}

/** The single case's score, for the many one-case batches below. */
function only(batch: ReturnType<typeof scoreEvalBatch>) {
  const [first] = batch.cases;
  if (!first) throw new Error('expected exactly one scored case');
  return first;
}

describe('covering an anchor', () => {
  it('matches on equal file path and overlapping range, and on nothing else', () => {
    const target = anchor('src/a.ts', 12, 20);
    const rows: { label: string; found: Finding; covered: boolean }[] = [
      { label: 'overlaps the low end', found: finding({ start_line: 10, end_line: 14 }), covered: true },
      { label: 'sits entirely inside', found: finding({ start_line: 15, end_line: 16 }), covered: true },
      { label: 'is exactly the anchor', found: finding({ start_line: 12, end_line: 20 }), covered: true },
      { label: 'touches the high bound', found: finding({ start_line: 20, end_line: 25 }), covered: true },
      { label: 'spans the whole anchor', found: finding({ start_line: 1, end_line: 99 }), covered: true },
      { label: 'stops one line short', found: finding({ start_line: 1, end_line: 9 }), covered: false },
      { label: 'starts one line past', found: finding({ start_line: 21, end_line: 30 }), covered: false },
      {
        label: 'is the right lines in the wrong file',
        found: finding({ file: 'src/b.ts', start_line: 12, end_line: 20 }),
        covered: false,
      },
    ];

    for (const row of rows) {
      const scored = only(scoreEvalBatch([mustFind('c', [target], output([row.found]))]));
      expect(scored.true_positives, row.label).toBe(row.covered ? 1 : 0);
      expect(scored.false_negatives, row.label).toBe(row.covered ? 0 : 1);
      // The mirror image: a finding that covers no expected anchor is noise.
      expect(scored.false_positives, row.label).toBe(row.covered ? 0 : 1);
      expect(scored.outcome, row.label).toBe(row.covered ? 'passed' : 'failed');
    }
  });

  it('normalises an inverted range on either side before comparing', () => {
    // The spec's own example, and then the shapes the live table actually holds.
    const rows: { label: string; anchors: EvalAnchor[]; found: Finding }[] = [
      {
        label: 'finding stored 27-18 against an anchor of 20-22',
        anchors: [anchor('src/a.ts', 20, 22)],
        found: finding({ start_line: 27, end_line: 18 }),
      },
      {
        label: 'pull.repo.ts:108-9',
        anchors: [anchor('server/src/modules/reviews/repository/pull.repo.ts', 100, 104)],
        found: finding({
          file: 'server/src/modules/reviews/repository/pull.repo.ts',
          start_line: 108,
          end_line: 9,
        }),
      },
      {
        label: 'service.ts:52-0',
        anchors: [anchor('src/modules/notifications/service.ts', 10, 20)],
        found: finding({ file: 'src/modules/notifications/service.ts', start_line: 52, end_line: 0 }),
      },
      {
        label: 'classifier.ts:21-1 against an anchor that is itself inverted',
        anchors: [anchor('server/src/modules/smart-diff/classifier.ts', 15, 5)],
        found: finding({
          file: 'server/src/modules/smart-diff/classifier.ts',
          start_line: 21,
          end_line: 1,
        }),
      },
    ];

    for (const row of rows) {
      const scored = only(scoreEvalBatch([mustFind('c', row.anchors, output([row.found]))]));
      expect(scored.true_positives, row.label).toBe(1);
      expect(scored.outcome, row.label).toBe('passed');
    }
  });
});

describe('tallies', () => {
  it('counts one anchor covered twice as one true positive', () => {
    const target = anchor('src/a.ts', 12, 20);
    const scored = only(
      scoreEvalBatch([
        mustFind(
          'c',
          [target],
          output([
            finding({ id: 'f1', start_line: 12, end_line: 12 }),
            finding({ id: 'f2', start_line: 19, end_line: 20 }),
          ]),
        ),
      ]),
    );

    expect(scored.true_positives).toBe(1);
    expect(scored.false_positives).toBe(0);
    expect(scored.expected_count).toBe(1);
    // Both findings landed on the anchor, so both are "actual" against it.
    expect(scored.actual_count).toBe(2);
    expect(scored.outcome).toBe('passed');
  });

  it('counts three uncovered must_find anchors as three false negatives', () => {
    const batch = scoreEvalBatch([
      mustFind(
        'c',
        [anchor('src/a.ts', 10, 12), anchor('src/b.ts', 4, 4), anchor('src/c.ts', 90, 99)],
        output([]),
      ),
    ]);

    expect(batch.metrics.false_negatives).toBe(3);
    expect(batch.metrics.true_positives).toBe(0);
    expect(batch.metrics.false_positives).toBe(0);
    // A real zero, because there were three anchors to find and none was found …
    expect(batch.metrics.recall).toBe(0);
    // … and null, because nothing was reported for precision to be about.
    expect(batch.metrics.precision).toBeNull();
    expect(only(batch).outcome).toBe('failed');
    expect(only(batch).actual_count).toBe(0);
  });

  it('counts a finding on a must_not_flag anchor as a false positive', () => {
    const scored = only(
      scoreEvalBatch([
        mustNotFlag('c', [anchor('src/a.ts', 40, 44)], output([finding({ start_line: 42, end_line: 42 })])),
      ]),
    );

    expect(scored.false_positives).toBe(1);
    expect(scored.true_positives).toBe(0);
    expect(scored.false_negatives).toBe(0);
    expect(scored.expected_count).toBe(0);
    expect(scored.actual_count).toBe(1);
    expect(scored.outcome).toBe('failed');
  });

  it('counts an off-anchor finding in a must_find case as a false positive', () => {
    // The criterion a "flag unused imports as suggestions too" prompt edit shows
    // up in: recall holds while precision falls.
    const batch = scoreEvalBatch([
      mustFind(
        'c',
        [anchor('src/a.ts', 12, 20)],
        output([
          finding({ id: 'wanted', start_line: 13, end_line: 13 }),
          finding({ id: 'noise-1', start_line: 60, end_line: 60 }),
          finding({ id: 'noise-2', file: 'src/z.ts', start_line: 1, end_line: 1 }),
        ]),
      ),
    ]);

    expect(batch.metrics.true_positives).toBe(1);
    expect(batch.metrics.false_positives).toBe(2);
    expect(batch.metrics.recall).toBe(1);
    expect(batch.metrics.precision).toBeCloseTo(1 / 3, 10);
    // The case still passes — the anchor was found. Precision carries the noise.
    expect(only(batch).outcome).toBe('passed');
    expect(only(batch).actual_count).toBe(1);
  });

  it('passes a must_not_flag case whose diff also produced a real, unrelated finding', () => {
    const scored = only(
      scoreEvalBatch([
        mustNotFlag(
          'negative',
          [anchor('src/a.ts', 40, 44)],
          output([
            finding({
              id: 'genuine',
              severity: 'CRITICAL',
              category: 'security',
              file: 'src/a.ts',
              start_line: 200,
              end_line: 204,
            }),
            finding({ id: 'elsewhere', file: 'src/other.ts', start_line: 41, end_line: 41 }),
          ]),
        ),
      ]),
    );

    // A whole-output emptiness assertion would fail the agent for being right.
    expect(scored.outcome).toBe('passed');
    expect(scored.false_positives).toBe(0);
    expect(scored.actual_count).toBe(0);
  });
});

describe('batch metrics', () => {
  it('computes recall, precision and citation accuracy over the whole batch', () => {
    const cases: EvalScoreCase[] = [];

    // 18 hits: one anchor each, each found. 18 kept citations, none dropped.
    for (let i = 0; i < 18; i++) {
      cases.push(
        mustFind(
          `hit-${i}`,
          [anchor(`src/hit${i}.ts`, 10, 12)],
          output([finding({ id: `hit-${i}`, file: `src/hit${i}.ts`, start_line: 11, end_line: 11 })]),
        ),
      );
    }
    // 4 misses: an anchor each, nothing reported.
    for (let i = 0; i < 4; i++) {
      cases.push(mustFind(`miss-${i}`, [anchor(`src/miss${i}.ts`, 10, 12)], output([], 0, 0)));
    }
    // One negative case violated twice, contributing the batch's 2 false
    // positives and its 1 dropped citation.
    cases.push(
      mustNotFlag(
        'negative',
        [anchor('src/neg.ts', 40, 44)],
        output(
          [
            finding({ id: 'v1', file: 'src/neg.ts', start_line: 40, end_line: 40 }),
            finding({ id: 'v2', file: 'src/neg.ts', start_line: 44, end_line: 44 }),
          ],
          1,
          1,
        ),
      ),
    );

    const batch = scoreEvalBatch(cases);

    expect(batch.metrics.true_positives).toBe(18);
    expect(batch.metrics.false_negatives).toBe(4);
    expect(batch.metrics.false_positives).toBe(2);
    expect(batch.metrics.recall).toBeCloseTo(18 / 22, 10); // 0.818…
    expect(batch.metrics.precision).toBeCloseTo(0.9, 10); // 18 / 20
    expect(batch.metrics.citation_accuracy).toBeCloseTo(0.95, 10); // 19 kept, 1 dropped
    expect(batch.cases_covered).toBe(23);
    expect(batch.cases_passed).toBe(18);
    expect(batch.cases_failed).toBe(5);
  });

  it('returns null, not zero, for a metric with a zero denominator', () => {
    // Only must_not_flag cases, none violated: there was nothing to find, so
    // recall and precision were not measured. Not 0, and not 1.
    const batch = scoreEvalBatch([
      mustNotFlag('n1', [anchor('src/a.ts', 40, 44)], output([], 0, 0)),
      mustNotFlag('n2', [anchor('src/b.ts', 1, 2)], output([], 0, 0)),
    ]);

    expect(batch.metrics.recall).toBeNull();
    expect(batch.metrics.precision).toBeNull();
    // Nothing was grounded either, so citation accuracy is unmeasured too.
    expect(batch.metrics.citation_accuracy).toBeNull();
    expect(batch.cases_passed).toBe(2);
    expect(batch.cases_covered).toBe(2);
  });
});

describe('a case with no output', () => {
  it('stays in the covered count and appears in neither tally', () => {
    const batch = scoreEvalBatch([
      mustFind('pass-1', [anchor('src/a.ts', 10, 12)], output([finding({ start_line: 11, end_line: 11 })])),
      mustFind(
        'pass-2',
        [anchor('src/b.ts', 10, 12)],
        output([finding({ file: 'src/b.ts', start_line: 12, end_line: 12 })]),
      ),
      mustFind('fail-1', [anchor('src/c.ts', 10, 12)], output([], 0, 0)),
      {
        case_id: 'killed',
        expectation: 'must_find',
        expected_anchors: [anchor('src/d.ts', 10, 12)],
        output: { kind: 'no_output', reason: 'deadline' },
      },
    ]);

    expect(batch.cases_covered).toBe(4);
    expect(batch.cases_passed).toBe(2);
    expect(batch.cases_failed).toBe(1);

    const killed = batch.cases.find((c) => c.case_id === 'killed');
    expect(killed?.outcome).toBe('not_run');
    expect(killed?.not_run_reason).toBe('deadline');
    expect(killed?.actual_count).toBeNull();
    expect(killed?.true_positives).toBe(0);
    expect(killed?.false_negatives).toBe(0);
    expect(killed?.false_positives).toBe(0);

    // The deadline is not evidence the agent missed anything: recall is 2/3 over
    // the three cases that ran, not 2/4.
    expect(batch.metrics.true_positives).toBe(2);
    expect(batch.metrics.false_negatives).toBe(1);
    expect(batch.metrics.recall).toBeCloseTo(2 / 3, 10);
  });

  it('reports three null metrics for a batch where nothing executed', () => {
    const batch = scoreEvalBatch([
      {
        case_id: 'a',
        expectation: 'must_find',
        expected_anchors: [anchor('src/a.ts', 10, 12)],
        output: { kind: 'no_output', reason: 'provider_error' },
      },
      {
        case_id: 'b',
        expectation: 'must_not_flag',
        expected_anchors: [anchor('src/b.ts', 10, 12)],
        output: { kind: 'no_output', reason: 'diff_unparseable' },
      },
    ]);

    expect(batch.metrics.recall).toBeNull();
    expect(batch.metrics.precision).toBeNull();
    expect(batch.metrics.citation_accuracy).toBeNull();
    expect(batch.cases_covered).toBe(2);
    expect(batch.cases_passed).toBe(0);
    expect(batch.cases_failed).toBe(0);
  });
});

describe('purity', () => {
  it('returns deep-equal results for identical inputs and mutates nothing', () => {
    const build = (): EvalScoreCase[] => [
      mustFind(
        'c1',
        [anchor('src/a.ts', 12, 20)],
        output([
          finding({ id: 'f1', start_line: 13, end_line: 13 }),
          finding({ id: 'f2', start_line: 90, end_line: 91 }),
        ]),
      ),
      mustNotFlag('c2', [anchor('src/b.ts', 1, 4)], output([], 3, 1)),
      {
        case_id: 'c3',
        expectation: 'must_find',
        expected_anchors: [anchor('src/c.ts', 5, 5)],
        output: { kind: 'no_output', reason: 'not_scorable' },
      },
    ];

    const input = build();
    const first = scoreEvalBatch(input);
    const second = scoreEvalBatch(build());

    expect(first).toEqual(second);
    // Same call, same argument, twice — nothing accumulates between calls.
    expect(scoreEvalBatch(input)).toEqual(first);
    // The caller's array and its objects come back untouched.
    expect(input).toEqual(build());
  });
});

describe('agreement with the citation-grounding gate', () => {
  /**
   * One file, one hunk, new-side lines 10-14. The anchor is that hunk, so
   * "the scorer thinks this finding covers the anchor" and "the grounding gate
   * keeps this finding" are two ways of asking whether the finding sits on the
   * diff's new side — and they must never differ.
   */
  const diff: UnifiedDiff = {
    raw: '',
    files: [
      {
        path: 'src/a.ts',
        additions: 5,
        deletions: 0,
        hunks: [
          {
            file: 'src/a.ts',
            oldStart: 10,
            oldLines: 0,
            newStart: 10,
            newLines: 5,
            newLineNumbers: [10, 11, 12, 13, 14],
          },
        ],
      },
    ],
  };
  const hunkAnchor = anchor('src/a.ts', 10, 14);

  it('agrees with groundFindings about whether a finding is on the new side', () => {
    const candidates: { label: string; found: Finding }[] = [
      { label: 'inside the hunk', found: finding({ start_line: 12, end_line: 13 }) },
      { label: 'before the hunk', found: finding({ start_line: 1, end_line: 9 }) },
      { label: 'overlapping the hunk tail', found: finding({ start_line: 14, end_line: 30 }) },
      { label: 'overlapping the hunk head', found: finding({ start_line: 9, end_line: 10 }) },
      { label: 'inverted, inside the hunk', found: finding({ start_line: 13, end_line: 11 }) },
      { label: 'inverted, spanning the hunk', found: finding({ start_line: 40, end_line: 12 }) },
      { label: 'far past the hunk', found: finding({ start_line: 40, end_line: 40 }) },
      { label: 'a file the diff does not touch', found: finding({ file: 'src/b.ts', start_line: 12, end_line: 13 }) },
    ];

    for (const candidate of candidates) {
      const grounded = groundFindings([candidate.found], diff).kept.length === 1;
      const covered =
        only(scoreEvalBatch([mustFind('c', [hunkAnchor], output([candidate.found]))]))
          .true_positives === 1;

      expect(covered, `${candidate.label}: grounding says ${String(grounded)}`).toBe(grounded);
    }
  });
});
