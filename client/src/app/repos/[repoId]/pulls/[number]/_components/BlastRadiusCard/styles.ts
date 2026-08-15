import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard.
 *
 *  Tokens only, and only tokens `vendor/ui/styles.css` actually defines: there is no
 *  `--text-tertiary` and no `--bg` in this design system, and an unknown custom
 *  property does not error — the declaration silently drops and the value falls back
 *  to inherited (`client/INSIGHTS.md`, 2026-08-06 and 2026-08-14). Muted text here is
 *  `--text-muted`, dimmer still is `--text-secondary`.
 *
 *  The card deliberately mirrors `IntentCard/styles.ts` — same border, radius,
 *  background and 18px padding — because the two sit side by side in the Overview
 *  grid and any difference reads as a mistake rather than a distinction. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    // The card is a grid child; without this it grows to its widest mono path and
    // pushes the Intent column narrower.
    minWidth: 0,
  } satisfies CSSProperties,

  /** BLAST RADIUS (left) — matches IntentCard's header line exactly. */
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  headerLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    // `SectionLabel`'s own scale — see the note in IntentCard/styles.ts. `vendor/ui`
    // is do-not-touch, so this is the side that has to agree.
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    lineHeight: 1,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** The four figures, then the tree/graph toggle pushed right. */
  statRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 16,
  } satisfies CSSProperties,
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    lineHeight: 1,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** The number itself carries the weight; the unit stays muted beside it. */
  statValue: {
    fontWeight: 700,
    fontSize: 15,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statIcon: { color: "var(--text-secondary)", display: "flex" } satisfies CSSProperties,

  /** Segmented tree|graph control. */
  toggle: {
    display: "flex",
    marginLeft: "auto",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
    lineHeight: 1.4,
    border: "none",
    cursor: active ? "default" : "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),

  /** One collapsible changed-symbol row. */
  symbolList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  symbolRow: {
    border: "1px solid transparent",
    borderRadius: 6,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", display: "flex", flexShrink: 0 } satisfies CSSProperties,
  symbolIcon: { color: "var(--accent)", display: "flex", flexShrink: 0 } satisfies CSSProperties,
  symbolName: {
    fontFamily: "var(--font-mono)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** The declaring file, shown only when the symbol name repeats in this map. */
  symbolFile: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flexShrink: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  /** "4 callers" at the far right of the symbol row. */
  symbolCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,

  /** The expanded body: callers, then the endpoint/cron badges. */
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "0 12px 12px 12px",
  } satisfies CSSProperties,
  callerList: {
    display: "flex",
    flexDirection: "column",
    // A rule down the left of the caller list, so the ↳ rows read as children of
    // the symbol above them rather than as siblings.
    borderLeft: "1px solid var(--border)",
    marginLeft: 8,
    paddingLeft: 4,
  } satisfies CSSProperties,
  /** file:line — a real link, because it opens the code on GitHub. */
  callerLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 8px",
    borderRadius: 4,
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    textDecoration: "none",
    minWidth: 0,
  } satisfies CSSProperties,
  callerArrow: {
    color: "var(--text-muted)",
    display: "flex",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerPath: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  truncatedNote: {
    padding: "4px 8px 0 8px",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Small caption above the map-level badge row. */
  looseLabel: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,

  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  /** Endpoints read as accent, crons as warn — the design's two badge colours. */
  badge: (kind: "endpoint" | "cron"): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.4,
    background: kind === "cron" ? "var(--warn-bg)" : "var(--accent-bg)",
    color: kind === "cron" ? "var(--warn)" : "var(--accent-text)",
  }),

  /** A caveat that sits ABOVE the data it qualifies, never below it. */
  notice: (tone: "warn" | "muted"): CSSProperties => ({
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-surface)",
    color: tone === "warn" ? "var(--warn)" : "var(--text-muted)",
  }),
  noticeIcon: { flexShrink: 0, marginTop: 1, display: "flex" } satisfies CSSProperties,
  noticeTitle: { fontWeight: 600, display: "block" } satisfies CSSProperties,
  noticeHint: { color: "var(--text-muted)", display: "block" } satisfies CSSProperties,

  loadingColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  /** The mermaid graph needs its own scroll box; a wide fan-out must not widen the page. */
  graphBox: {
    overflowX: "auto",
    padding: 4,
  } satisfies CSSProperties,
} as const;
