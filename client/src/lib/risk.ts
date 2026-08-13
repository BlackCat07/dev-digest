import type { IconName } from "@devdigest/ui";

/* Runtime values for the intent card's risk chips (L03).

   In `src/lib/` and not next to the component, and not derived from the shared
   contract, for the reason `src/lib/severity.ts` and `src/lib/scope.ts` exist:
   client imports of `@devdigest/shared` must stay TYPE-ONLY. That vendored barrel
   re-exports with ESM `.js` extensions webpack will not map back to `.ts`, so a
   runtime import from it 500s every route that transitively touches it
   (`client/INSIGHTS.md`, 2026-08-03) — which means the `Risk` zod schema's own
   enum values are not usable here even though they exist. */

/**
 * Icon per risk kind, mirroring the design mock's `RISK_ICON`.
 *
 * `Risk.kind` is an open `string` in the contract on purpose — the classifier is
 * constrained to a closed enum, but a stored row is not — so this lookup is
 * PARTIAL and every caller must fall back. `riskIcon` below is that fallback,
 * kept in one place so a sixth kind renders as a neutral chip instead of
 * crashing on `Icon[undefined]`.
 */
const RISK_ICON: Record<string, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertOctagon",
  perf: "Zap",
  deps: "Boxes",
  other: "AlertTriangle",
};

/**
 * The icon for a kind, or a neutral one for a kind we do not know.
 *
 * The fallback is `AlertTriangle`, not `Info`: lucide's `Info` is a circled "i"
 * and so is nothing else in this row, so when several risks share the fallback —
 * which happens whenever the classifier reaches for `other` — the chips became a
 * column of identical letters and the icons stopped carrying information. A
 * warning triangle at least reads as "unclassified risk" rather than as a glyph.
 */
export function riskIcon(kind: string): IconName {
  return RISK_ICON[kind] ?? "AlertTriangle";
}

/**
 * Colour per severity. Same three tokens the findings UI uses, so a `high` risk
 * and a CRITICAL finding read as the same level of alarm on one screen.
 */
const RISK_SEVERITY_COLOR: Record<string, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};

/** The colour for a severity, or the muted default for an unknown one. */
export function riskSeverityColor(severity: string): string {
  return RISK_SEVERITY_COLOR[severity] ?? "var(--text-muted)";
}
