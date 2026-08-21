import type { CSSProperties } from "react";

/**
 * Co-located styles for the skill editor's Context tab.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`. An
 * undefined one does not error — the declaration silently drops and the element
 * inherits — which is why none is invented locally, and why the recessed
 * preview block names `--bg-primary` rather than a shorter alias
 * (`INSIGHTS.md`, 2026-08-06).
 */
export const s = {
  wrap: { maxWidth: 680 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,

  hint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,

  row: (attached: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: attached ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: attached ? 1 : 0.75,
  }),

  checkbox: (on: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: 4,
    border: "1.5px solid " + (on ? "var(--accent)" : "var(--border-strong)"),
    background: on ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    cursor: "pointer",
    padding: 0,
  }),

  checkIcon: { color: "#fff" } satisfies CSSProperties,

  path: {
    fontSize: 12.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  tokens: {
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
    minWidth: 52,
    textAlign: "right",
  } satisfies CSSProperties,

  move: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  } satisfies CSSProperties,

  preview: {
    marginTop: 22,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  h3: { fontSize: 13.5, fontWeight: 700, marginBottom: 6 } satisfies CSSProperties,

  /** Recessed below the panel, the way every other code-ish block here reads. */
  previewBlock: {
    margin: 0,
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  } satisfies CSSProperties,
} as const;
