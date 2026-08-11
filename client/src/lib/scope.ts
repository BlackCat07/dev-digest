/**
 * Scope helpers for the out-of-scope badge and its filter.
 *
 * Lives in `src/lib/` rather than a unit's `helpers.ts` because two units need
 * it — `ScopeFilter/` renders the chip row, `FindingsPanel/` applies the
 * predicate — and a helpers file is private to its unit under the barrel
 * convention. Same reason `src/lib/severity.ts` exists, and same hard
 * constraint: these are RUNTIME values, so they cannot come off the vendored Zod
 * enum. A runtime import from `@devdigest/shared` pulls that barrel's
 * `.js`-suffixed re-exports into the webpack bundle and 500s every route, while
 * `tsc` and `vitest` both stay green (client/INSIGHTS.md, 2026-08-03).
 */
import type { FindingScope } from "@devdigest/shared";

/** Display order: the job the PR set out to do first. */
export const SCOPE_VALUES: readonly FindingScope[] = ["in_scope", "out_of_scope"];

/** Tally of findings per scope label. */
export type FindingsByScope = Record<FindingScope, number>;

/**
 * Tally findings by scope.
 *
 * An UNLABELLED finding (`scope` null or absent — which is every finding written
 * before the Intent Layer) counts in neither bucket, so these two can sum to
 * less than `findings.length`. That is deliberate: the counters describe what
 * was labelled, and the filter's null default keeps unlabelled findings visible.
 */
export function countByScope(findings: { scope?: string | null }[]): FindingsByScope {
  const counts: FindingsByScope = { in_scope: 0, out_of_scope: 0 };
  for (const f of findings) {
    if (f.scope === "in_scope" || f.scope === "out_of_scope") counts[f.scope] += 1;
  }
  return counts;
}
