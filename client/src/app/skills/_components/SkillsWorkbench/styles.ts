import type { CSSProperties } from "react";

/** SkillsWorkbench styles — the two-column workbench (skill rail | editor).
 *  Mirrors AgentDetailView's shell so the two Skills Lab screens line up. */
export const s = {
  /** Fills the viewport below the 52px app header. */
  shell: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,

  sidebar: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  sidebarHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,

  sidebarTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,

  sidebarTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,

  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,

  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  list: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,

  listStates: { padding: "0 12px 12px", display: "grid", gap: 10 } satisfies CSSProperties,

  pane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,

  placeholder: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    padding: 40,
  } satisfies CSSProperties,

  editorSkeleton: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
