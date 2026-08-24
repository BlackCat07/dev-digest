/* Runtime constants for the brief card (L05).

   All three are RUNTIME VALUES and they live here rather than being read off the
   zod enums in `@devdigest/shared`, even though that contract declares exactly
   these sets. Client imports of that barrel must stay `import type`: it
   re-exports with ESM `.js` extensions webpack will not map back to `.ts`, so a
   value import from it resolves under `tsc` and under vitest and then 500s every
   route that transitively reaches it (`client/INSIGHTS.md`, 2026-08-03). The
   same reason `src/lib/severity.ts` and `src/lib/risk.ts` exist.

   They are the unit's own rather than `src/lib/`'s because this card is the only
   consumer — promotion happens on the second one, not in anticipation. The one
   thing already shared IS in `src/lib/risk.ts`: `riskSeverityColor`, whose three
   tokens the intent card's chips and the findings UI already use, so a `high`
   risk here and a CRITICAL finding there read as the same level of alarm. */
import type { IconName } from "@devdigest/ui";

/**
 * Icon per level / severity word — the "in addition to colour" half of AC-37 and
 * AC-39, which is why it is not optional decoration. Colour alone is invisible to
 * a large share of readers and to every screen reader, so each badge below
 * renders an icon AND the word.
 *
 * The three glyphs are the design system's own severity icons
 * (`vendor/ui/primitives/tokens.ts`, `SEV`): `AlertOctagon` for CRITICAL,
 * `AlertTriangle` for WARNING, `Info` for INFO. Matching them means one screen
 * does not carry two visual vocabularies for "how bad is this".
 */
export const SEVERITY_ICON: Record<string, IconName> = {
  high: "AlertOctagon",
  medium: "AlertTriangle",
  low: "Info",
};

/**
 * Background per level, for the headline badge only. A risk row's badge keeps the
 * neutral surface and tints just its icon and word — the reason the intent card's
 * chip row does the same: six tinted panels read as a traffic light rather than
 * as a list, and the level badge stops standing out as the card's headline.
 */
export const SEVERITY_BG: Record<string, string> = {
  high: "var(--crit-bg)",
  medium: "var(--warn-bg)",
  low: "var(--info-bg)",
};

/**
 * The three levels, worst first.
 *
 * Used to order the risk rows, not to compute the level: the stored `risk_level`
 * is DERIVED server-side as the highest severity that survived grounding
 * (AC-26), and re-deriving it here would give the badge and the list two
 * independent opinions about one pull request. What this constant buys is that
 * the first row a reader's eye lands on is the one the badge is talking about.
 */
export const RISK_LEVEL_ORDER = ["high", "medium", "low"] as const;

/**
 * Every `BriefReason` this build has a sentence for.
 *
 * The guard for AC-49: a reason outside this list gets the generic sentence,
 * because `next-intl` renders the missing KEY PATH onto the screen rather than
 * throwing, and `reason.some_new_value` on a card is worse than saying plainly
 * that the cause is unrecognised. The contract can grow a twelfth value in a
 * later lesson and this screen must not print it raw.
 *
 * Kept in the same order as the contract's enum so the two can be diffed by eye.
 */
export const KNOWN_REASONS = [
  "index_missing",
  "index_partial",
  "index_failed",
  "repo_too_large",
  "no_changed_files",
  "no_intent",
  "inputs_too_large",
  "model_failed",
  "model_timeout",
  "model_invalid",
  "restates_title",
] as const;
