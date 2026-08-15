import type { CSSProperties } from "react";

export const s = {
  root: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    background: "var(--bg-primary)",
    borderBottom: "1px solid var(--border)",
    padding: "18px 32px 0",
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 18,
  } satisfies CSSProperties,
  titleCol: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  prNumber: {
    fontSize: 18,
    color: "var(--text-muted)",
    fontWeight: 500,
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginTop: 10,
    marginBottom: 14,
    fontSize: 13,
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  authorChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  branchChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  branchMono: {
    fontSize: 12,
  } satisfies CSSProperties,
  idChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  idLabel: {
    color: "var(--text-muted)",
    fontSize: 12,
  } satisfies CSSProperties,
  idValue: {
    fontSize: 12,
    color: "var(--text-muted)",
    // Selectable on its own so a double-click grabs the whole uuid and nothing
    // else — the clipboard button is the fast path, this is the fallback.
    userSelect: "all",
  } satisfies CSSProperties,
  idCopy: (copied: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 3,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: copied ? "var(--ok)" : "var(--text-muted)",
    cursor: "pointer",
  }),
  actions: {
    display: "flex",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  staleBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
