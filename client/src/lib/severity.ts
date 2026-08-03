/**
 * Severity helpers shared by the PR list and the PR detail page.
 *
 * Lives in `src/lib/` rather than beside a component because two route subtrees
 * need it: `pulls/_components/*` (the list column + hover panel) and
 * `pulls/[number]/_components/*` (the timeline, accordion headers, filter).
 *
 * The colour/icon/label registry is NOT here — that is `SEV` in
 * `@devdigest/ui` (`vendor/ui/primitives/tokens.ts`), the single source of truth.
 * Don't add a fourth copy of it.
 */
import type { FindingsBySeverity, Severity } from "@devdigest/shared";

/**
 * Display order: worst first. Matches `SEVERITY_ORDER` in
 * `FindingsPanel/constants.ts`, which additionally ranks `INFO` for sorting —
 * this list is only the three levels the contract enum defines, i.e. the three
 * that get a counter and a filter chip.
 */
export const SEVERITY_LEVELS: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** All-zero counts — what a PR or run with no findings reports. */
export const EMPTY_SEVERITY_COUNTS: FindingsBySeverity = Object.freeze({
  CRITICAL: 0,
  WARNING: 0,
  SUGGESTION: 0,
});

/**
 * Tally findings by severity. Mirrors the server's `countFindingsBySeverity`
 * (`server/src/modules/pulls/status.ts`) including its blind spot: a severity
 * outside the three contract levels (e.g. a stray `INFO`) lands in NO bucket, so
 * these three can sum to less than `findings.length`.
 */
export function countBySeverity(findings: { severity: string }[]): FindingsBySeverity {
  const counts: FindingsBySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL" || f.severity === "WARNING" || f.severity === "SUGGESTION") {
      counts[f.severity] += 1;
    }
  }
  return counts;
}

/** Total across the three levels. Absent counts read as zero. */
export function totalOf(counts: FindingsBySeverity | null | undefined): number {
  if (!counts) return 0;
  return counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
}

/** Sum two count objects (e.g. rolling every run of a PR into one total). */
export function addCounts(
  a: FindingsBySeverity,
  b: FindingsBySeverity,
): FindingsBySeverity {
  return {
    CRITICAL: a.CRITICAL + b.CRITICAL,
    WARNING: a.WARNING + b.WARNING,
    SUGGESTION: a.SUGGESTION + b.SUGGESTION,
  };
}
