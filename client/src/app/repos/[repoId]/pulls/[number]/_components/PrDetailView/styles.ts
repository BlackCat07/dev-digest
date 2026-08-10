import type { CSSProperties } from "react";

/** PrDetailView styles. The two containers below were duplicated inline in the
 *  route file — same 1080px centred column, different vertical padding. */
export const s = {
  /** Skeleton column shown while the PR resolves. */
  loadingColumn: {
    padding: "28px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,

  /** The tab body column. */
  tabColumn: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
};
