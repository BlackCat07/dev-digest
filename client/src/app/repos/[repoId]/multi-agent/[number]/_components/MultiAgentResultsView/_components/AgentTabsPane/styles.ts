import type { CSSProperties } from "react";

/* Tabs mode. One agent at a time, full width — the mode a reviewer switches to
   when a finding's title has stopped fitting in a 300px column. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  paneHead: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  metric: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
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
  headSpacer: {
    marginLeft: "auto",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 16,
  } satisfies CSSProperties,
  noFindings: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  finding: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "11px 13px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  confidence: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    fontWeight: 600,
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  findingLocation: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  foot: {
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
