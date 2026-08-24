import type { EvalAnchor, EvalCaseOutcome, EvalExpectation, EvalMetrics, EvalNotRunReason, Finding } from '@devdigest/shared';

/**
 * The eval scorer — the whole of "did the agent get better or worse", as arithmetic.
 *
 * The point of this module is what it does NOT contain. Scoring an eval batch is
 * a comparison, not a judgement: an expectation is a `file:line` anchor, an
 * actual finding is a `file:line` range, and "the agent found it" is two integer
 * comparisons and a string equality. There is no model call, no heuristic and no
 * fuzzy match anywhere below, and there is nothing to inject — no provider, no
 * clock, no config, no logger. That is a requirement rather than a style
 * preference: a scorer that asked a model whether the answer was right would
 * measure the judge as much as the agent, and two runs of the same set would
 * stop being comparable.
 *
 * It is enforced by this file's IMPORT LIST, which is one type-only line from
 * `@devdigest/shared` and must stay that way. A relative import would pull in
 * whatever that module imports; a value import would put runtime code behind the
 * scorer. Both are checkable by reading the top of this file, which is exactly
 * why the repository's own gate does that instead of walking an import graph.
 *
 * Three counting rules carry every number this module produces, and the
 * asymmetry between them is deliberate:
 *
 *  - a TRUE POSITIVE is an EXPECTED ANCHOR that was hit. An anchor covered by
 *    five findings is one true positive, because the case asserted one place,
 *    not five;
 *  - a FALSE NEGATIVE is an expected anchor that nothing hit;
 *  - a FALSE POSITIVE is an ACTUAL FINDING that landed where nothing was
 *    expected — on a `must_not_flag` case's forbidden anchor, or, in a
 *    `must_find` case, on none of that case's expected anchors. Findings are
 *    counted here, not anchors: precision is a statement about output, and two
 *    wrong findings are twice as much noise as one.
 *
 * And one rule about absence, which the whole feature turns on: a metric whose
 * DENOMINATOR is zero is `null`, never `0`. "We could not measure recall" and
 * "recall is 0%" are different claims, they are rendered differently, and a
 * batch of only `must_not_flag` cases with nothing to find legitimately measures
 * neither recall nor precision. A case that produced no output at all
 * (`no_output`) is counted in the covered total and contributes to NO tally: an
 * infrastructure failure is not evidence that the agent missed anything, so a
 * batch that entirely failed to execute reports three null metrics rather than a
 * recall of zero.
 */

/**
 * The part of a `Finding` the scorer reads — and, by construction, all of it.
 *
 * Narrowed on purpose. A real `Finding` satisfies this structurally, so the
 * runner passes its findings straight through, while the signature states that
 * severity, category, confidence, rationale and the model's own prose have no
 * influence on any number below. It also keeps a test case to three fields.
 */
export type EvalScoredFinding = Pick<Finding, 'file' | 'start_line' | 'end_line'>;

/**
 * What one case produced, as an explicit two-way marker rather than a nullable
 * array.
 *
 * The distinction is load-bearing and easy to lose. `{ kind: 'output',
 * findings: [] }` means the agent ran and reported nothing — a `must_find` case
 * fails on it and a `must_not_flag` case passes. `{ kind: 'no_output' }` means
 * the case never reached an answer, which is neither.
 *
 * The grounding gate's kept/dropped counts live INSIDE the `output` variant, so
 * a case that never executed cannot contribute to citation accuracy: that metric
 * is aggregated over the batch's executed cases, and making the alternative
 * unrepresentable is cheaper than remembering the rule.
 */
export type EvalCaseOutput =
  | {
      readonly kind: 'output';
      /** Every finding the agent produced for this case, after grounding. */
      readonly findings: readonly EvalScoredFinding[];
      /** The citation-grounding gate's own counts for this case. */
      readonly kept_count: number;
      readonly dropped_count: number;
    }
  | {
      readonly kind: 'no_output';
      readonly reason: EvalNotRunReason;
    };

/** One case of a batch, as the scorer needs it. */
export interface EvalScoreCase {
  readonly case_id: string;
  readonly expectation: EvalExpectation;
  /**
   * Where the case says something must (or must not) be found. Line numbers are
   * NEW-side diff line numbers — the same side the citation-grounding gate
   * indexes — and they are normalised again here, because the `Finding` contract
   * does not guarantee `start_line <= end_line` and the live data holds rows
   * where it does not.
   */
  readonly expected_anchors: readonly EvalAnchor[];
  readonly output: EvalCaseOutput;
}

/** How one case scored, and the tallies it contributed to the batch. */
export interface EvalCaseScore {
  readonly case_id: string;
  readonly outcome: EvalCaseOutcome;
  /** Set exactly when `outcome` is `not_run`, and null otherwise. */
  readonly not_run_reason: EvalNotRunReason | null;
  /**
   * How many findings the case expected: the number of expected anchors for a
   * `must_find` case, and 0 for a `must_not_flag` case, which asserts emptiness
   * at its anchor.
   */
  readonly expected_count: number;
  /**
   * How many actual findings landed ON an expected anchor — the counterpart of
   * `expected_count`, not the size of the whole output. For a `must_not_flag`
   * case that is the number of violations, so `expected 0, actual 0` reads as a
   * pass. Null when the case produced no output at all.
   */
  readonly actual_count: number | null;
  readonly true_positives: number;
  readonly false_negatives: number;
  readonly false_positives: number;
}

/** The scorer's answer for a whole batch. */
export interface EvalBatchScore {
  /** One entry per input case, in input order. */
  readonly cases: readonly EvalCaseScore[];
  /**
   * Every case the batch set out to cover, `no_output` cases included. A case
   * killed by a deadline stays in this denominator — dropping it is how a
   * harness reports `4/5` for a set of five and looks like it improved.
   */
  readonly cases_covered: number;
  readonly cases_passed: number;
  readonly cases_failed: number;
  readonly metrics: EvalMetrics;
}

/** An inclusive line range, low bound first whatever order it arrived in. */
interface Range {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The two-line normalisation the whole file depends on.
 *
 * `grounding.ts` does the same `Math.min`/`Math.max` on a finding's bounds
 * before testing it against a hunk. It is re-derived rather than imported —
 * that helper is module-private there and the two gates must not be coupled
 * through it — and the agreement between the two is pinned by a test that runs
 * `groundFindings` and this scorer over one finding and asserts they say the
 * same thing.
 */
function normalise(a: number, b: number): Range {
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/**
 * Does this finding cover this anchor? Equal file path, and overlapping
 * inclusive ranges. This is the only place "the agent found it" is decided.
 */
function covers(finding: EvalScoredFinding, anchor: EvalAnchor): boolean {
  if (finding.file !== anchor.file) return false;
  const f = normalise(finding.start_line, finding.end_line);
  const a = normalise(anchor.low_line, anchor.high_line);
  return f.lo <= a.hi && a.lo <= f.hi;
}

/** A metric, or null when there was nothing to measure it over. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function scoreCase(input: EvalScoreCase): EvalCaseScore {
  const anchors = input.expected_anchors;

  if (input.output.kind === 'no_output') {
    return {
      case_id: input.case_id,
      outcome: 'not_run',
      not_run_reason: input.output.reason,
      expected_count: input.expectation === 'must_find' ? anchors.length : 0,
      actual_count: null,
      true_positives: 0,
      false_negatives: 0,
      false_positives: 0,
    };
  }

  const findings = input.output.findings;

  switch (input.expectation) {
    case 'must_find': {
      let truePositives = 0;
      let falseNegatives = 0;
      for (const anchor of anchors) {
        // An anchor covered five times is still one true positive.
        if (findings.some((finding) => covers(finding, anchor))) truePositives += 1;
        else falseNegatives += 1;
      }

      let matched = 0;
      let falsePositives = 0;
      for (const finding of findings) {
        // A finding on none of this case's anchors is noise the case did not ask
        // for — the criterion a "flag unused imports too" prompt edit shows up in.
        if (anchors.some((anchor) => covers(finding, anchor))) matched += 1;
        else falsePositives += 1;
      }

      return {
        case_id: input.case_id,
        // "at least one actual finding covers its anchor, and failed otherwise".
        // A case derived from a finding carries exactly one anchor, so this is
        // the only reading that matters in practice; a hand-edited case with
        // several anchors still records every uncovered one as a false negative,
        // so a partial hit cannot hide in the batch's metrics.
        outcome: truePositives > 0 ? 'passed' : 'failed',
        not_run_reason: null,
        expected_count: anchors.length,
        actual_count: matched,
        true_positives: truePositives,
        false_negatives: falseNegatives,
        false_positives: falsePositives,
      };
    }

    case 'must_not_flag': {
      let violations = 0;
      for (const finding of findings) {
        if (anchors.some((anchor) => covers(finding, anchor))) violations += 1;
      }

      return {
        case_id: input.case_id,
        // Only the forbidden anchor is asserted. A negative case whose diff also
        // contains a real, unrelated problem still passes — a whole-output
        // emptiness check would fail the agent for being right.
        outcome: violations === 0 ? 'passed' : 'failed',
        not_run_reason: null,
        expected_count: 0,
        actual_count: violations,
        // Nothing was expected to be found, so there is no true positive and no
        // false negative available here; a hit on the forbidden anchor is noise.
        true_positives: 0,
        false_negatives: 0,
        false_positives: violations,
      };
    }

    default: {
      const unreachable: never = input.expectation;
      throw new Error(`unhandled eval expectation: ${String(unreachable)}`);
    }
  }
}

/**
 * Score one eval batch: per-case outcomes plus the batch's metrics.
 *
 * A pure function of its argument. No I/O, no clock, no randomness, nothing
 * injected — two calls with identical input return deep-equal results, which is
 * what makes a number from last week comparable with a number from today.
 *
 * Recall and precision are computed over the WHOLE batch rather than averaged
 * per case: a batch of one anchor and a batch of forty anchors then weigh what
 * they actually contain. Citation accuracy comes from the grounding gate's
 * kept/dropped counts and introduces no second grounding pass.
 */
export function scoreEvalBatch(cases: readonly EvalScoreCase[]): EvalBatchScore {
  const scored: EvalCaseScore[] = [];
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let kept = 0;
  let dropped = 0;
  let passed = 0;
  let failed = 0;

  for (const input of cases) {
    const result = scoreCase(input);
    scored.push(result);

    truePositives += result.true_positives;
    falseNegatives += result.false_negatives;
    falsePositives += result.false_positives;

    if (result.outcome === 'passed') passed += 1;
    else if (result.outcome === 'failed') failed += 1;

    // Executed cases only — see `EvalCaseOutput`.
    if (input.output.kind === 'output') {
      kept += input.output.kept_count;
      dropped += input.output.dropped_count;
    }
  }

  const metrics: EvalMetrics = {
    recall: ratio(truePositives, truePositives + falseNegatives),
    precision: ratio(truePositives, truePositives + falsePositives),
    citation_accuracy: ratio(kept, kept + dropped),
    true_positives: truePositives,
    false_negatives: falseNegatives,
    false_positives: falsePositives,
  };

  return {
    cases: scored,
    cases_covered: scored.length,
    cases_passed: passed,
    cases_failed: failed,
    metrics,
  };
}
