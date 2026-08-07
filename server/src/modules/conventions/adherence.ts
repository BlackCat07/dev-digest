import type { ConventionAdherence } from '@devdigest/shared';
import {
  MAX_MEASURED_CANDIDATES,
  MIN_ADHERENCE,
  MIN_OCCURRENCES,
  UNMEASURED_CONFIDENCE_CEILING,
} from './constants.js';

/**
 * Counting how widely a proposed rule actually holds.
 *
 * This is the part that turns "the model was 78% sure" into "312 places follow
 * this and 4 do not". The distinction matters because the first number is a
 * model talking about itself and the second is a fact about the repository, and
 * only the second can be wrong in a way anyone can check.
 *
 * The model supplies both patterns; this module runs them over the whole clone
 * — not the sample — so a rule inferred from eighty files is judged against all
 * of them. A rule that looked strong in the sample and holds in a third of the
 * repository is exactly the candidate this feature exists to throw away.
 *
 * The grep itself is injected, so everything here is testable without a clone.
 */

/** Matches a pattern across the corpus, returning how many lines hit. */
export type CountMatches = (pattern: string) => Promise<number>;

/**
 * Count matching lines across an in-memory corpus.
 *
 * This replaced a `CodeIndex.grep` per pattern, which walked the whole clone
 * once for every side of every rule — up to sixty walks in one scan. On a real
 * 26-file repository that alone consumed the scan's entire time budget, because
 * the clone also contained a committed `.pnpm-store` of several thousand files
 * that the walk had no reason to visit and no way to skip.
 *
 * Counting over the corpus the scan already read is faster AND more honest: the
 * denominator is the indexed, rank-filtered source of the repository, which is
 * the same body of code the rule was inferred from and the only part a
 * convention can meaningfully be said to hold across. A package cache is not
 * somewhere a house rule applies.
 *
 * Line-based, matching grep's semantics: a line that matches twice counts once.
 */
export function corpusCounter(files: Array<{ source: string }>): CountMatches {
  const lines = files.flatMap((file) => file.source.split('\n'));
  return async (pattern: string) => {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return 0;
    }
    let count = 0;
    for (const line of lines) if (regex.test(line)) count += 1;
    return count;
  };
}

export interface Measurable {
  match_conforming: string | null;
  match_violating: string | null;
}

/**
 * Reject a pattern that would match nearly every line.
 *
 * An over-broad matcher is worse than none: it inflates both sides, produces a
 * ratio near whatever the file mix happens to be, and dresses it up as a
 * measurement. `.` and `.*` are the obvious cases; an empty pattern matches
 * every line in the repository.
 */
export function isUsablePattern(pattern: string | null): pattern is string {
  if (pattern === null) return false;
  const trimmed = pattern.trim();
  if (trimmed.length < 3) return false;
  if (/^\.[*+]?$/.test(trimmed)) return false;
  // Must survive compilation — the model writes these by hand.
  try {
    new RegExp(trimmed);
  } catch {
    return false;
  }
  return true;
}

/**
 * Count both sides of a rule, or return null when it cannot be measured.
 *
 * Null is a legitimate outcome, not a failure. "Modules are registered
 * statically in one file" is a real convention with no line-level pattern, and
 * forcing a matcher for it would produce a confident number that means nothing.
 * Such a rule survives, flagged as unmeasured and capped in confidence.
 */
export async function measure(
  rule: Measurable,
  count: CountMatches,
): Promise<ConventionAdherence | null> {
  if (!isUsablePattern(rule.match_conforming)) return null;
  if (!isUsablePattern(rule.match_violating)) return null;

  const [conforming, violating] = await Promise.all([
    count(rule.match_conforming),
    count(rule.match_violating),
  ]);

  // Both patterns valid but nothing matched either way: the rule is about
  // something that does not appear in this repository at all.
  if (conforming === 0 && violating === 0) return null;
  return { conforming, violating };
}

/** The measured share, 0..1. */
export function adherenceRatio(adherence: ConventionAdherence): number {
  const total = adherence.conforming + adherence.violating;
  if (total === 0) return 0;
  return adherence.conforming / total;
}

/**
 * The confidence shown to the user.
 *
 * A measured rule reports its counted ratio. An unmeasured one keeps the model's
 * own estimate but can never rise above {@link UNMEASURED_CONFIDENCE_CEILING} —
 * so a rule nobody could check never outranks one that was checked, however
 * certain the model sounded. Without that ceiling the list sorts confident
 * guesses above counted facts, which is the exact failure this whole pass is
 * meant to prevent.
 */
export function deriveConfidence(
  adherence: ConventionAdherence | null,
  modelConfidence: number,
): number {
  if (adherence) return clamp01(adherenceRatio(adherence));
  return Math.min(clamp01(modelConfidence), UNMEASURED_CONFIDENCE_CEILING);
}

/**
 * Whether a measured rule clears the floors.
 *
 * Two floors, and both are needed. The ratio alone passes "2 conforming, 0
 * violating" at a perfect 100% off two coincidences; the occurrence count alone
 * passes a rule broken as often as it is kept. An unmeasured rule clears by
 * default — there is nothing to judge it on, and dropping every unmeasurable
 * convention would silently delete the structural ones, which are usually the
 * most valuable.
 */
export function passesFloor(
  adherence: ConventionAdherence | null,
  minAdherence = MIN_ADHERENCE,
  minOccurrences = MIN_OCCURRENCES,
): boolean {
  if (!adherence) return true;
  if (adherence.conforming < minOccurrences) return false;
  return adherenceRatio(adherence) >= minAdherence;
}

/**
 * How many of a scan's candidates to measure.
 *
 * Every measurement is two greps over the clone, so this is the one part of a
 * scan whose cost grows with how talkative the model was. Candidates are
 * measured in the order they arrive — highest self-confidence first — and the
 * rest are treated as unmeasured rather than silently dropped. The count of
 * unmeasured-by-budget is worth surfacing; a scan that measured 30 of 90 is a
 * different result from one that measured everything.
 */
export function splitForMeasurement<T>(candidates: T[]): { measured: T[]; deferred: T[] } {
  return {
    measured: candidates.slice(0, MAX_MEASURED_CANDIDATES),
    deferred: candidates.slice(MAX_MEASURED_CANDIDATES),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
