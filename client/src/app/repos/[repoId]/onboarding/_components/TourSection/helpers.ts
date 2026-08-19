/**
 * Private helpers for TourSection — with one deliberate exception, re-exported
 * through the unit's barrel and named below.
 */
import type { OnboardingSectionKind } from "@devdigest/shared";

/**
 * The DOM id of one section's heading.
 *
 * **Exported through this unit's barrel on purpose**, and it is the only symbol here
 * that is. The on-this-page rail lives on the screen and the heading lives in this
 * card, so the two must agree on one string; a rail that builds its own `#id` from the
 * same kind is a hand-synced invariant with nothing tying the halves together, and the
 * failure mode is a link that silently scrolls nowhere. One function, one caller each
 * side.
 *
 * Prefixed rather than bare, because `kind` values like `architecture` are plausible
 * ids for something else on a page that also renders a shell.
 */
export function sectionHeadingId(kind: OnboardingSectionKind): string {
  return `onboarding-section-${kind}`;
}
