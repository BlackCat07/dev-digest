import type { FindingRecord, FindingScope, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Optionally isolate one severity, optionally isolate one scope, optionally drop
 * low-confidence findings, then sort by severity.
 *
 * `severity` and `scope` are independent ISOLATE filters: a value means "show
 * only this one", and null/undefined means no filtering on that axis. Both
 * parameters are optional so the sort-only and hide-low call paths are
 * unchanged.
 *
 * Isolating `in_scope` therefore also hides UNLABELLED findings (`scope` null —
 * every finding written before the Intent Layer), which is what "show only
 * in-scope" means. With no scope filter set they all render.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity?: Severity | null,
  scope?: FindingScope | null,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity);
  if (scope) shown = shown.filter((f) => f.scope === scope);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
