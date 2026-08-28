import type { CSSProperties } from "react";

/* A segmented control on its own recessed track: the group carries the surface
   and the 2px inset, and the ACTIVE option is the raised tile inside it —
   which is why the active background is `--bg-elevated` (above the track) and
   not `--bg-hover`. Weight is 600 in both states, so the strip does not reflow
   by a pixel when the choice changes. */
export const s = {
  group: {
    display: "inline-flex",
    height: 27.5,
    padding: 2,
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-surface)",
    flexShrink: 0,
  } satisfies CSSProperties,
  option: (active: boolean): CSSProperties => ({
    padding: "4px 12px",
    fontSize: 11.5,
    fontWeight: 600,
    textTransform: "capitalize",
    border: "none",
    borderRadius: 5,
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: active ? "default" : "pointer",
  }),
} as const;
