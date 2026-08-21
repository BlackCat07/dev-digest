/* Unit-private pure helpers for the brief card (L05).

   Private on purpose: everything here is about how THIS card reads a
   `PrRiskBrief`, and a second consumer of any of it would be a second card
   rendering the same document. A formatter more than one route subtree needs
   goes in `src/lib/` instead — which is where `formatCost`, `formatAge` and
   `riskSeverityColor` already are, and why none of them is re-implemented here. */
import type { IconName } from "@devdigest/ui";
import type { BriefDiffStats, PrRiskBrief, Risk } from "@devdigest/shared";
import { KNOWN_REASONS, RISK_LEVEL_ORDER, SEVERITY_ICON } from "./constants";

/**
 * The icon for a level or a severity word, or a neutral one for a value this
 * build does not know.
 *
 * Total by construction, for the reason `riskIcon` in `src/lib/risk.ts` is:
 * `Icon[undefined]` in JSX is the one way a lookup like this crashes a route,
 * and while `risk_level` is a closed enum in the contract, a stored brief is read
 * back out of a jsonb column and is only as closed as whatever wrote it.
 */
export function severityIcon(value: string | null | undefined): IconName {
  return (value != null ? SEVERITY_ICON[value] : undefined) ?? "AlertTriangle";
}

/**
 * The risks, worst severity first, without mutating the stored array.
 *
 * A display order, not a reinterpretation: every risk is rendered either way and
 * none is filtered. Rank comes from `RISK_LEVEL_ORDER`, and an unrecognised
 * severity sorts last rather than first — a value this build cannot rank is not
 * evidence of urgency.
 *
 * `sort` is stable in every engine this app runs on, so risks of equal severity
 * keep the order the generation stored them in.
 */
export function risksWorstFirst(risks: Risk[]): Risk[] {
  const rank = (severity: string) => {
    const i = (RISK_LEVEL_ORDER as readonly string[]).indexOf(severity);
    return i === -1 ? RISK_LEVEL_ORDER.length : i;
  };
  return [...risks].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/**
 * How many changed files the model was never shown.
 *
 * `files_changed - files_listed`, floored at zero: the two figures are recorded
 * by the generation rather than computed together on read, so an old brief whose
 * `files_listed` outran its `files_changed` must render nothing instead of a
 * negative count.
 */
export function filesOmitted(stats: BriefDiffStats): number {
  return Math.max(0, stats.files_changed - stats.files_listed);
}

/**
 * Is this reason one this build has a sentence for? (AC-49.)
 *
 * A plain membership test rather than a `try` around `t()`: `next-intl` does not
 * throw on a missing message, it renders the key path, so there is nothing to
 * catch — the check has to happen before the lookup.
 */
export function isKnownReason(reason: string | null | undefined): boolean {
  return reason != null && (KNOWN_REASONS as readonly string[]).includes(reason);
}

/**
 * Does this brief hold anything a model wrote?
 *
 * The predicate that decides whether a running generation renders the previously
 * stored brief underneath its notice. Deliberately NOT `risks.length > 0`: a calm
 * pull request has no risks and a real brief, and branching on the list is the
 * inference this whole feature exists to prevent. `generated_at` is the fact —
 * something was stored, whatever its status.
 */
export function hasStoredBrief(brief: PrRiskBrief): boolean {
  return brief.generated_at != null;
}
