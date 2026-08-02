import type { CSSProperties } from "react";
import type { RunCostVariant } from "./RunCostBadge";

/**
 * Co-located styles for RunCostBadge. This unit owns a styles.ts even though its
 * siblings (PRRow, FilterBar) borrow the page-level `pulls/styles.ts` — it is
 * consumed from three different route subtrees, so it cannot depend on any one
 * page's style module.
 *
 * `absent` drops the colour to --text-muted so a "—" reads as missing data
 * rather than as a value.
 */
export const s = {
  compact: (absent: boolean): CSSProperties => ({
    fontSize: 12,
    whiteSpace: "nowrap",
    color: absent ? "var(--text-muted)" : "var(--text-secondary)",
  }),

  row: (variant: RunCostVariant): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: variant === "detail" ? 5 : 6,
    // `detail` sits in the timeline's 11px meta stack; `inline` in the banner.
    fontSize: variant === "detail" ? 11 : 12,
    whiteSpace: "nowrap",
    // Both halves read at the same weight — the token count and the cost are one
    // fact about the run, so emphasising only the dollar figure split them apart.
    color: "var(--text-secondary)",
  }),

  // The "·" separator carries no style of its own — it inherits `row`'s colour so
  // the whole badge reads as one unit.

  /** Only an ABSENT cost deviates: it dims to muted so "—" reads as no data. */
  cost: (absent: boolean): CSSProperties => (absent ? { color: "var(--text-muted)" } : {}),
} as const;
