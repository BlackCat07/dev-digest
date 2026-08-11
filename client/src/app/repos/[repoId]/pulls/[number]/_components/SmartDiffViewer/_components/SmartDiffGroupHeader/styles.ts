import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    padding: "0 2px 2px",
  } satisfies CSSProperties,
  swatch: (token: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: token,
    flexShrink: 0,
    // `baseline` alignment on the row would drop a bare span to the text baseline;
    // nudging it up centres the swatch against the cap height of the label.
    alignSelf: "center",
  }),
  label: { fontSize: 13.5, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  description: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
