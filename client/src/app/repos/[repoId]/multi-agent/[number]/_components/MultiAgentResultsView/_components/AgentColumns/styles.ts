import type { CSSProperties } from "react";

/* Columns mode. The row scrolls horizontally rather than shrinking the columns
   below readability: a fan-out is capped at 8 agents (AC-8) and eight 300px
   columns do not fit any laptop, so something has to give and it is the
   viewport, not the finding titles.

   `var(--bg)` is not a token — the base background is `var(--bg-primary)`, and
   an unknown custom property drops silently (`client/INSIGHTS.md`, 2026-08-06). */
export const s = {
  row: {
    display: "flex",
    gap: 14,
    alignItems: "stretch",
    overflowX: "auto",
    paddingBottom: 6,
  } satisfies CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    flex: "0 0 300px",
    minWidth: 300,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } satisfies CSSProperties,
  agentName: {
    fontSize: 13.5,
    fontWeight: 700,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  metrics: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  metric: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  noScore: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /* The failure reason takes the score's place (AC-68). It wraps rather than
     clipping: it is the only account of why the column is empty. */
  reason: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--crit)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    flex: 1,
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  finding: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "9px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  findingLocation: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  foot: {
    padding: "9px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
