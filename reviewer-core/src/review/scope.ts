import type { Finding } from '@devdigest/shared';
import { FULL_FILE_KINDS } from '../grounding.js';

/**
 * The deterministic scope floor.
 *
 * Scope is a LABEL, not a filter: the review annotates each finding as
 * `in_scope` / `out_of_scope` relative to the PR's derived intent, and nothing
 * is ever removed for being out of scope. But the label feeds a UI filter, and
 * the model's labelling is soft — unlike grounding there is no mechanical check
 * on it. So the requirement "a serious problem outside the PR's scope still
 * leaves one signal" is implemented HERE, in code, rather than trusted to a
 * prompt the model may not follow: a CRITICAL finding, or a finding from a
 * full-file scanner (`FULL_FILE_KINDS`), cannot even be *labelled*
 * `out_of_scope`, so no filter can hide it.
 *
 * The other half of the safety argument is membership: this pass mutates labels
 * and only labels. `output.findings.length === input.length`, always, in the
 * same order, with nothing dropped and nothing merged — which is what makes
 * "annotate instead of drop" a no-op for the grounding summary and for every
 * score derived from these findings.
 *
 * PRECONDITION — an intent block was supplied to the review. Every finding that
 * comes out of here carries an explicit `scope`, including the `in_scope`
 * default for unlabelled ones, and that default is only defensible once
 * something actually stated the PR's scope. With no intent the contract says
 * `Finding.scope` is absent ("Absent/null when no intent was available",
 * `@devdigest/shared` contracts/findings.ts), so `reviewPullRequest` does not
 * call this at all rather than back-fill a judgement nobody made.
 */

/** Findings kept fresh per call; the input array and its objects are untouched. */
export interface ScopeGuardResult {
  /** Same findings, same order, same count — every one carrying an explicit scope. */
  findings: Finding[];
  /** How many labels the floor owns rather than the model (CRITICAL / full-file). */
  forced: number;
  inScope: number;
  outOfScope: number;
}

/**
 * Why the floor owns this finding's label, or `null` if the model's label (or
 * the `in_scope` default) stands. Exported so the caller can name the reason in
 * its progress log without restating the rule — this is the one definition.
 */
export function scopeFloorReason(finding: Finding): string | null {
  if (finding.severity === 'CRITICAL') return 'CRITICAL severity';
  if (finding.kind && FULL_FILE_KINDS.has(finding.kind)) {
    return `full-file kind '${finding.kind}'`;
  }
  return null;
}

/**
 * Apply the scope floor to a set of findings, in this order:
 *
 * 1. CRITICAL or a full-file kind ⇒ forced to `in_scope`, whatever the model said;
 * 2. any remaining finding with no scope ⇒ normalised to `in_scope`;
 * 3. everything else keeps the model's label.
 */
export function applyScopeGuard(findings: Finding[]): ScopeGuardResult {
  const out: Finding[] = [];
  let forced = 0;
  let inScope = 0;
  let outOfScope = 0;

  for (const finding of findings) {
    const floored = scopeFloorReason(finding) !== null;
    if (floored) forced += 1;
    const scope = floored ? 'in_scope' : (finding.scope ?? 'in_scope');
    if (scope === 'in_scope') inScope += 1;
    else outOfScope += 1;
    out.push({ ...finding, scope });
  }

  return { findings: out, forced, inScope, outOfScope };
}
