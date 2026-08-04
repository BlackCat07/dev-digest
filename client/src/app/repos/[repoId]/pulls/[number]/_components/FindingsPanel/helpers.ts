import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Optionally isolate one severity, optionally drop low-confidence findings, then
 * sort by severity.
 *
 * `severity` is the ISOLATE filter: a level means "show only this level", and
 * null/undefined means no filtering. The parameter is optional so the sort-only
 * and hide-low call paths are unchanged.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity?: Severity | null,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
