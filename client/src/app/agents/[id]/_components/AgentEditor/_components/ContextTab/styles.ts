import type { CSSProperties } from "react";

/**
 * Co-located styles for the agent editor's Context tab.
 *
 * Every custom property named here is declared in `vendor/ui/styles.css`. An
 * undefined one does not error — the declaration silently drops and the element
 * inherits — which is why none is invented locally (`INSIGHTS.md`, 2026-08-06).
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

  /**
   * The combined token total.
   *
   * `aria-live="polite"` is on the element that holds the number, not on a
   * wrapper, so a screen reader announces the new figure — and only that — when
   * a toggle changes it. The value is computed during render from the current
   * attached set, so there is nothing here to keep in sync.
   */
  total: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

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

  row: (attached: boolean, dragOver: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid " + (dragOver ? "var(--accent)" : "var(--border)"),
    background: attached ? "var(--bg-hover)" : "var(--bg-elevated)",
    // Dimmed, never the only signal: the row always carries the word "Attached"
    // or "Not attached" beside its checkbox, because attachment state may not be
    // conveyed by colour alone.
    opacity: attached ? 1 : 0.75,
  }),

  /** An inherited row is inert — no handle, no checkbox, nothing to drag. */
  inheritedRow: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px dashed var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  handle: {
    color: "var(--text-muted)",
    cursor: "grab",
    flexShrink: 0,
    background: "none",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
  } satisfies CSSProperties,

  /** Keeps the checkbox column aligned on a row that has no handle. */
  handleSpacer: { width: 14, flexShrink: 0 } satisfies CSSProperties,

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

  state: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  inherited: {
    fontSize: 11,
    color: "var(--info)",
    background: "var(--info-bg)",
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
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
} as const;
