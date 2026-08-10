/**
 * Convention helpers shared by the Conventions screen and its units.
 *
 * These are RUNTIME values, deliberately not imported from `@devdigest/shared`.
 * A runtime import from that package breaks `next dev`/`next build` with
 * "Can't resolve './contracts/findings.js'" while `tsc` and vitest both pass —
 * see `INSIGHTS.md` (Recurring Errors, 2026-08-03). Client imports of the
 * contracts stay `import type`; this file is the runtime mirror, exactly as
 * `skill.ts` and `severity.ts` are for theirs.
 */
import type {
  ConventionAdherence,
  ConventionCategory,
  ConventionScan,
  ExtractedConvention,
} from "@devdigest/shared";

/**
 * Display order for the category filter and the edit modal's select.
 *
 * Mirrors `SCAN_CATEGORIES` in `server/src/modules/conventions/constants.ts` —
 * change both together, or a category the server can produce becomes one the
 * filter cannot show.
 */
export const CONVENTION_CATEGORIES: readonly ConventionCategory[] = [
  "naming",
  "structure",
  "error-handling",
  "api-contract",
  "testing",
  "imports",
  "async",
  "logging",
  "typing",
  "security",
];

/**
 * Category → accent colour.
 *
 * Grouped rather than ten unrelated hues: the four "shape of the code"
 * categories share blue, the three "runtime behaviour" ones share amber, and
 * security keeps the red it has everywhere else in the app. Ten distinct colours
 * would be a rainbow nobody can read as a grouping.
 */
export const CONVENTION_CATEGORY_COLOR: Record<ConventionCategory, string> = {
  naming: "#3b82f6",
  structure: "#3b82f6",
  imports: "#3b82f6",
  typing: "#3b82f6",
  "error-handling": "#f59e0b",
  async: "#f59e0b",
  logging: "#f59e0b",
  testing: "#10b981",
  "api-contract": "#10b981",
  security: "#ef4444",
};

/** `0.74` → `74`. */
export function toPercent(rate: number): number {
  return Math.round(rate * 100);
}

/**
 * Confidence → the bar's colour.
 *
 * The thresholds are not arbitrary: 0.8 is the server's `MIN_ADHERENCE`, so
 * anything green was measured and cleared the floor. Amber is the band an
 * unmeasured rule can reach at all (its ceiling is 0.6), which makes "this was
 * counted" and "this is the model's word" visually distinct without a second
 * badge.
 */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "var(--ok)";
  if (confidence >= 0.5) return "#f59e0b";
  return "var(--text-muted)";
}

/**
 * True when this candidate's confidence is a counted figure rather than the
 * model's self-report. Drives the "measured" affordance on the card.
 */
export function isMeasured(candidate: ExtractedConvention): boolean {
  return candidate.adherence !== null;
}

/** `312 of 316 places` — the sentence under a measured candidate's bar. */
export function adherenceTotals(adherence: ConventionAdherence): {
  conforming: number;
  total: number;
} {
  return {
    conforming: adherence.conforming,
    total: adherence.conforming + adherence.violating,
  };
}

/** A scan still doing work — the screen polls while this is true. */
export function isScanning(scan: ConventionScan | null): boolean {
  return scan !== null && (scan.status === "queued" || scan.status === "running");
}

/**
 * Candidates the model proposed that never reached the screen.
 *
 * Surfaced rather than hidden: a list of five with no context reads as
 * "the repo has five conventions", when it may mean "the model proposed twelve
 * and seven could not be substantiated". The second is the more useful fact and
 * the one that builds trust in the five that remain.
 */
export function droppedTotal(scan: ConventionScan | null): number {
  if (!scan) return 0;
  return scan.dropped_unverified + scan.dropped_low_adherence;
}

