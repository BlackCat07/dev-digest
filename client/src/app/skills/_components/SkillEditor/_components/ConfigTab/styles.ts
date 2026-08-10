import type { CSSProperties } from "react";

/** Co-located styles for the skill Config tab. */
export const s = {
  wrap: { maxWidth: 860, paddingBottom: 8 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  } satisfies CSSProperties,

  h2: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,

  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  actions: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,

  /** Right-aligned status beside the buttons: the version a save would create. */
  saveHint: {
    marginLeft: "auto",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  danger: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginTop: 28,
    paddingTop: 20,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  dangerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  dangerTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--crit)",
  } satisfies CSSProperties,

  dangerBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 4,
  } satisfies CSSProperties,
} as const;
