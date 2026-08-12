/* The measured height of the PR screen's sticky header, published as a CSS
   custom property so anything that scrolls itself into view can clear it.

   Lives in `src/lib/` rather than in one feature because two route subtrees now
   need it: `SmartDiffViewer` measured it first (L03b) and the Agent-runs tab needs
   the same figure to land a finding card below the header instead of under it.

   Why it is measured rather than chosen: `AppFrame` scrolls an inner `<main>`, not
   the window, and `PrDetailHeader` is `position: sticky` at the top of it — roughly
   128px, ~156px on a merged or closed PR (the stale banner) and taller again when
   the meta row wraps at a narrow width. Any single `scrollMarginTop` therefore
   lands some PRs under the header (`client/INSIGHTS.md`, 2026-08-11). */
"use client";

import React from "react";

/** Custom property carrying the sticky header's measured height. */
export const STICKY_CSS_VAR = "--dd-sticky-h";

/** Attribute the hook measures. Set on `PrDetailHeader`'s root. */
export const STICKY_HEADER_SELECTOR = "[data-sticky-header]";

/**
 * Fallback offset, used during SSR, before the first measurement, and under jsdom
 * (where `src/test/setup.ts` stubs `ResizeObserver` as a no-op that never fires).
 * Mid-range of the header's real heights, so a scroll that happens before the
 * first measurement lands close rather than underneath.
 */
export const STICKY_FALLBACK_PX = 148;

/** `scrollMarginTop` value for anything that scrolls itself into view. */
export const STICKY_SCROLL_MARGIN = `var(${STICKY_CSS_VAR}, ${STICKY_FALLBACK_PX}px)`;

/**
 * Publish the sticky header's measured height on `ref`'s subtree.
 *
 * An attribute rather than a shared constant identifies the header, because the
 * measurer lives in a different route subtree from the element it measures and
 * that header owns no module it could import.
 */
export function useStickyOffset(ref: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const header = document.querySelector(STICKY_HEADER_SELECTOR);
    const root = ref.current;
    if (!header || !root) return;

    const apply = () => {
      root.style.setProperty(
        STICKY_CSS_VAR,
        `${Math.round(header.getBoundingClientRect().height)}px`,
      );
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [ref]);
}
