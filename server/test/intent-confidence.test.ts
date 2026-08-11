import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IntentSource, IntentSourceKind } from '@devdigest/shared';
import {
  deriveConfidence,
  hasUnfetched,
  intentStatusFor,
} from '../src/modules/intent/confidence.js';
import {
  INTENT_MIN_CONFIDENCE,
  INTENT_SELF_REPORT_FLOOR,
  INTENT_UNFETCHED_CONFIDENCE_CEILING,
} from '../src/modules/intent/constants.js';

/**
 * L03 — the derived confidence, pinned as the four properties `confidence.ts`
 * states rather than as a table of numbers.
 *
 * Numbers alone would not catch the two spellings that file names as wrong,
 * because both of them agree with the multiplication on most inputs. Each is
 * therefore given the exact self-report at which it collapses:
 *
 *  - a plain `Math.min(available, selfReport)` returns the SAME figure for a
 *    source set with a description and one without, for every self-report at or
 *    below the smaller `available` (r = 0.15 below);
 *  - `max(available * FLOOR, min(available, r))` only moves the collision, to a
 *    self-report that lands inside both clamped ranges (r = 0.42 against the
 *    full source set, whose ranges are [0.225, 0.45] and [0.40, 0.80]).
 *
 * Both are property-2 failures — "for a fixed self-report, a used `pr_body`
 * strictly raises the figure" — which is R14, and which the first implementation
 * of this function falsified.
 */

const used = (kind: IntentSourceKind): IntentSource => ({
  kind,
  ref: `ref:${kind}`,
  status: 'used',
  chars: 100,
  note: null,
});

const unfetched = (kind: IntentSourceKind): IntentSource => ({
  kind,
  ref: `ref:${kind}`,
  status: 'unfetched',
  chars: null,
  note: 'could not be read',
});

/**
 * The degradation ladder's own pair: everything a PR yields with NO description
 * (title 0.05 + file list 0.05 + hunk headers 0.05 = 0.15), and the same PR with
 * one (+0.35 = 0.50). Those are the two figures `confidence.ts` names when it
 * explains where a hard `min` collapses.
 */
const MINIMAL_NO_BODY = [used('pr_title'), used('file_list'), used('hunk_headers')];
const MINIMAL_WITH_BODY = [...MINIMAL_NO_BODY, used('pr_body')];

/** The richest pair — every kind the classifier can be given, minus/plus the body. */
const FULL_NO_BODY = [
  used('pr_title'),
  used('file_list'),
  used('hunk_headers'),
  used('linked_issue'),
  used('repo_doc'),
];
const FULL_WITH_BODY = [...FULL_NO_BODY, used('pr_body')];

/** A sweep dense enough to include both collapse points and both endpoints. */
const SELF_REPORTS = [0, 0.05, 0.15, 0.3, 0.42, 0.5, 0.78, 0.9, 1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveConfidence — property 1: the self-report may only lower the figure', () => {
  it.each([
    // `available(S)` = Σ of the weights of the distinct used kinds, spelled out
    // rather than read back off the function, so this is an assertion and not a
    // tautology: 0.05 + 0.05 + 0.05 + 0.35, and that plus 0.15 + 0.15.
    ['minimal', MINIMAL_WITH_BODY, 0.5],
    ['full', FULL_WITH_BODY, 0.8],
  ])('never exceeds what the sources alone are worth (%s set)', (_name, sources, available) => {
    // A self-report of 1 is the ONLY one that leaves the figure untouched.
    expect(deriveConfidence(sources, 1)).toBeCloseTo(available, 10);
    for (const r of SELF_REPORTS) {
      expect(deriveConfidence(sources, r)).toBeLessThanOrEqual(available + 1e-12);
    }
    // A confident model does not get to add anything.
    expect(deriveConfidence(sources, 0.99)).toBeLessThan(available);
  });

  it('is monotonically non-decreasing in the self-report', () => {
    for (const sources of [MINIMAL_WITH_BODY, FULL_WITH_BODY, FULL_NO_BODY]) {
      const values = SELF_REPORTS.map((r) => deriveConfidence(sources, r));
      const sorted = [...values].sort((a, b) => a - b);
      expect(values).toEqual(sorted);
    }
  });

  it('discounts a self-report of zero by exactly the floor, and no further', () => {
    expect(deriveConfidence(FULL_WITH_BODY, 0)).toBeCloseTo(0.8 * INTENT_SELF_REPORT_FLOOR, 10);
  });

  it('clamps a self-report outside 0..1 instead of letting it move the figure', () => {
    const atZero = deriveConfidence(FULL_WITH_BODY, 0);
    const atOne = deriveConfidence(FULL_WITH_BODY, 1);
    expect(deriveConfidence(FULL_WITH_BODY, -5)).toBe(atZero);
    expect(deriveConfidence(FULL_WITH_BODY, 12)).toBe(atOne);
    // A non-finite self-report is treated as "said nothing", i.e. zero.
    expect(deriveConfidence(FULL_WITH_BODY, Number.NaN)).toBe(atZero);
  });
});

describe('deriveConfidence — property 2 (R14): a used pr_body strictly raises the figure', () => {
  it.each(SELF_REPORTS)('holds at self-report %s, for both source sets', (r) => {
    expect(deriveConfidence(MINIMAL_WITH_BODY, r)).toBeGreaterThan(
      deriveConfidence(MINIMAL_NO_BODY, r),
    );
    expect(deriveConfidence(FULL_WITH_BODY, r)).toBeGreaterThan(
      deriveConfidence(FULL_NO_BODY, r),
    );
  });

  it('holds at r = 0.15, where a plain min(available, selfReport) collapses both sides', () => {
    // Under `min`, MINIMAL_NO_BODY (0.15) and MINIMAL_WITH_BODY (0.50) would
    // both return 0.15 — a tie, and R14 falsified. Verified by computing all
    // three spellings on this input: `min` ties here, the multiplication does
    // not.
    const withBody = deriveConfidence(MINIMAL_WITH_BODY, 0.15);
    const noBody = deriveConfidence(MINIMAL_NO_BODY, 0.15);
    expect(withBody).toBeGreaterThan(noBody);
    expect(withBody).not.toBeCloseTo(0.15, 6);
  });

  it('holds at r = 0.42, where a proportional floor over min() collapses both sides', () => {
    // Under `max(available * FLOOR, min(available, r))`, r = 0.42 lands inside
    // both clamped ranges — [0.225, 0.45] and [0.40, 0.80] — and is returned
    // verbatim for both, which is the same tie one step further out.
    const withBody = deriveConfidence(FULL_WITH_BODY, 0.42);
    const noBody = deriveConfidence(FULL_NO_BODY, 0.42);
    expect(withBody).toBeGreaterThan(noBody);
    expect(withBody).not.toBeCloseTo(0.42, 6);
    expect(noBody).not.toBeCloseTo(0.42, 6);
  });

  it('is not flattened by the floor: any set with a body sits above it', () => {
    // The floor lifts the body-less side only, which is what keeps the ordering.
    expect(deriveConfidence([used('pr_body')], 0)).toBeGreaterThan(INTENT_MIN_CONFIDENCE);
    expect(deriveConfidence([], 0)).toBe(INTENT_MIN_CONFIDENCE);
    expect(deriveConfidence([used('pr_title')], 0)).toBe(INTENT_MIN_CONFIDENCE);
  });

  it('counts a kind once, however many sources of it were read', () => {
    const three = [used('linked_issue'), used('linked_issue'), used('linked_issue')];
    expect(deriveConfidence(three, 1)).toBe(deriveConfidence([used('linked_issue')], 1));
  });
});

describe('deriveConfidence — property 3: an unfetched source caps the figure', () => {
  const capped = [...FULL_WITH_BODY, unfetched('unfetched_link')];

  it('caps the value at the ceiling and keeps it under the uncapped one', () => {
    expect(deriveConfidence(capped, 1)).toBeCloseTo(INTENT_UNFETCHED_CONFIDENCE_CEILING, 10);
    expect(deriveConfidence(capped, 1)).toBeLessThan(deriveConfidence(FULL_WITH_BODY, 1));
  });

  it('caps before the discount, so no self-report can lift it back over the ceiling', () => {
    for (const r of SELF_REPORTS) {
      expect(deriveConfidence(capped, r)).toBeLessThanOrEqual(
        INTENT_UNFETCHED_CONFIDENCE_CEILING,
      );
    }
  });

  it('forces status partial on exactly the same fact', () => {
    expect(hasUnfetched(capped)).toBe(true);
    expect(intentStatusFor(capped)).toBe('partial');
    expect(hasUnfetched(FULL_WITH_BODY)).toBe(false);
    expect(intentStatusFor(FULL_WITH_BODY)).toBe('ok');
  });

  it('does not let an unfetched source earn any weight of its own', () => {
    const onlyGaps = [unfetched('linked_issue'), unfetched('repo_doc')];
    expect(deriveConfidence(onlyGaps, 1)).toBe(INTENT_MIN_CONFIDENCE);
  });
});

describe('deriveConfidence — property 4: pure', () => {
  it('reads no clock and no randomness', () => {
    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');

    deriveConfidence(FULL_WITH_BODY, 0.42);

    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it('returns the same number for the same audit trail and self-report', () => {
    const first = deriveConfidence(FULL_WITH_BODY, 0.42);
    expect(deriveConfidence(FULL_WITH_BODY, 0.42)).toBe(first);
    // Source ORDER is not part of the figure: it is a set of kinds. (Close, not
    // exact: summing the same weights in a different order is a different
    // sequence of float roundings, and that difference is not a behaviour.)
    expect(deriveConfidence([...FULL_WITH_BODY].reverse(), 0.42)).toBeCloseTo(first, 12);
  });
});
