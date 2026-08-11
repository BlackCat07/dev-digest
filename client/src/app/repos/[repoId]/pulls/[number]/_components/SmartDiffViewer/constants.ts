/* Constants for the Smart Diff viewer (L03b). */
import type { Severity } from "@devdigest/shared";
import type { ViewRole } from "./types";

/**
 * Reading order of the groups.
 *
 * The server already returns `groups` in this order, so this array is not how the
 * order is decided — it is how the order is ENFORCED on the client's own view
 * model, which is built from `pr.files` rather than from the response (see
 * `buildViewModel`). `unclassified` is last because it is a fallback, not a
 * judgement about the files in it.
 */
export const GROUP_ORDER: readonly ViewRole[] = [
  "core",
  "wiring",
  "boilerplate",
  "unclassified",
];

/**
 * The swatch colour per group.
 *
 * `--accent` for core rather than a green: it is the app's "look here" colour, and
 * `--sugg` (the suggestion blue) resolves to the same hue, so a blue swatch and a
 * blue suggestion badge agree by construction. Tokens only — `var(--bg)` is not one
 * of them and an unknown custom property silently drops the whole declaration
 * (`client/INSIGHTS.md`, 2026-08-06).
 */
export const GROUP_TOKEN: Record<ViewRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
  unclassified: "var(--info)",
};

/**
 * Severity → the word the badge shows.
 *
 * Not `SEV[severity].label`, which says "Critical": the design calls a
 * CRITICAL finding a **blocker** on this screen, and `ReviewRunAccordion` already
 * renders "N blockers" a tab away, so the vocabulary is in-house rather than
 * invented here. The colour and the icon still come from `SEV` — only the noun is
 * ours, so there is no fourth copy of the severity registry.
 *
 * Keyed on `string`, not on `Severity`, deliberately. The contract enum has three
 * members but `findings.severity` is plain `text` in Postgres with no CHECK, and
 * `src/lib/severity.ts` documents the consequence: a stray value (an `INFO`, say)
 * reaches the client and lands in no bucket. A `Record<Severity, …>` would compile
 * and then throw at `SEV[severity].c` on that row, taking the whole tab down over
 * one odd finding — so the lookup tolerates the unknown and
 * {@link SEVERITY_WORD_FALLBACK} names what it degrades to. Same shape as
 * `FindingCard/constants.ts`'s `SEV_COLOR_FALLBACK`.
 */
export const SEVERITY_WORD: Record<string, "blocker" | "warning" | "suggestion" | "info"> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
  INFO: "info",
};

/** Word and `SEV` key used for a severity outside the registry. */
export const SEVERITY_WORD_FALLBACK = "info" as const;
export const SEVERITY_FALLBACK: Severity | "INFO" = "INFO";

/** Worst first, so a file's dot and its badge agree on which finding leads. */
export const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Prefix of a code row's DOM id. See `lineId` for why ids and not selectors. */
export const LINE_ID_PREFIX = "sd-line";

/** Prefix of the off-diff footer's DOM id — the jump target when no line matches. */
export const OFFDIFF_ID_PREFIX = "sd-offdiff";

/**
 * Custom property carrying the sticky header's measured height.
 *
 * A scrolled-to line has to clear `PrDetailHeader`, which is `position: sticky` at
 * the top of the `<main>` that actually scrolls. Its height is NOT a constant: it
 * grows on a merged or closed PR (the stale banner) and again when the meta row
 * wraps at a narrow width, so any single number is wrong for some PRs. The viewer
 * measures it and writes it here; every row reads it through
 * `scrollMarginTop: var(--sd-sticky-h, <fallback>)`.
 */
export const STICKY_CSS_VAR = "--sd-sticky-h";

/** Attribute the viewer measures. Set on `PrDetailHeader`'s root. */
export const STICKY_HEADER_SELECTOR = "[data-sticky-header]";

/**
 * Fallback offset, used during SSR, before the first measurement, and under jsdom
 * (where `ResizeObserver` is a no-op stub that never fires). Mid-range of the
 * header's real heights, so a scroll that happens before measurement lands close
 * rather than under the header.
 */
export const STICKY_FALLBACK_PX = 148;
