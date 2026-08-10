import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 12,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    // A disabled skill stays legible but visibly inert — it is linked to nothing
    // and reaches no prompt until it is switched on.
    opacity: enabled ? 1 : 0.55,
    marginBottom: 10,
  }),

  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,

  iconBox: (color: string): CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color,
    background: color + "1a",
  }),

  name: {
    fontSize: 12.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  toggleWrap: { display: "flex", alignItems: "center" } satisfies CSSProperties,

  description: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    lineHeight: 1.4,
    marginTop: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  } satisfies CSSProperties,

  typeBadge: (color: string): CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 7px",
    borderRadius: 4,
  }),

  sourceRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  vetting: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg, rgba(234,179,8,0.12))",
    padding: "1px 6px",
    borderRadius: 4,
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingTop: 9,
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  accept: { color: "var(--ok)" } satisfies CSSProperties,
} as const;
