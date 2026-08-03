/* FindingsHoverCard — the floating panel behind every severity counter strip,
   plus the hover mechanics that position it.

   Two exports:
     FindingsHoverTrigger  wraps a counter strip; owns open state + positioning
     FindingsHoverPanel    the panel body (presentational: findings/loading/error)

   Positioning is `fixed`, not `absolute`: the PR list's table card sets
   `overflow: hidden`, so an absolutely-positioned panel is clipped by it. That
   means the panel does NOT travel with a scroll, so a capture-phase scroll
   listener closes it — the app scrolls an inner <main>, not the window, so a
   bubbling listener on window would never fire. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineLabel, sortBySeverity, stripMarkdown } from "./helpers";
import { FLIP_MARGIN, PANEL_WIDTH, s } from "./styles";

/** Delay before opening, so sweeping the cursor across a table is quiet. */
const HOVER_INTENT_MS = 120;
/** Grace period before closing, so the gap to the panel can be crossed. */
const CLOSE_GRACE_MS = 180;

export function FindingsHoverPanel({
  findings,
  loading,
  error,
  onFindingClick,
}: {
  findings: FindingRecord[];
  loading?: boolean;
  error?: boolean;
  /** When given, each row becomes clickable. Omitted on the PR detail page,
   *  where the findings are already on screen and there is nowhere to go. */
  onFindingClick?: (finding: FindingRecord) => void;
}) {
  const t = useTranslations("prReview");
  const sorted = React.useMemo(() => sortBySeverity(findings), [findings]);

  if (loading) return <span style={s.status}>{t("findingsPanel.loading")}</span>;
  if (error) return <span style={s.status}>{t("findingsPanel.error")}</span>;
  if (sorted.length === 0) return <span style={s.status}>{t("findingsPanel.empty")}</span>;

  return (
    <>
      <div style={s.header}>
        <Icon.AlertOctagon size={12} />
        {t("findingsPanel.heading", { count: sorted.length })}
      </div>
      <div style={s.list}>
        {sorted.map((f, i) => (
          <div
            key={f.id}
            style={s.item(i < sorted.length - 1, !!onFindingClick)}
            {...(onFindingClick
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => onFindingClick(f),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") onFindingClick(f);
                  },
                }
              : {})}
          >
            <div style={s.itemHead}>
              <SeverityBadge severity={f.severity as Severity} compact />
              <span style={s.itemTitle}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={s.itemMeta}>
              <span className="mono" style={s.itemFile}>
                {f.file}:{lineLabel(f)}
              </span>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={s.itemBody}>{stripMarkdown(f.rationale)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function FindingsHoverTrigger({
  children,
  panel,
  onOpen,
}: {
  /** The counter strip the panel hangs off. */
  children: React.ReactNode;
  /** Rendered ONLY while open — mount-based laziness, so a data-fetching panel
   *  registers no query until the user actually hovers. */
  panel: () => React.ReactNode;
  onOpen?: () => void;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [at, setAt] = React.useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const cancelTimers = React.useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = React.useCallback(() => {
    cancelTimers();
    setAt(null);
  }, [cancelTimers]);

  /**
   * Closing is DELAYED. The panel is offset from the trigger, so travelling to it
   * crosses a gap where the pointer is over neither element — an immediate close
   * there makes the panel unreachable, and the click that follows lands on the
   * row underneath (which navigates). The grace period lets the pointer arrive.
   */
  const closeSoon = React.useCallback(() => {
    cancelTimers();
    closeTimer.current = setTimeout(() => setAt(null), CLOSE_GRACE_MS);
  }, [cancelTimers]);

  const open = React.useCallback(() => {
    cancelTimers();
    openTimer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      // Flip above the trigger when there isn't room below it, so a row near the
      // bottom of a long list doesn't push the panel off-screen.
      const below = window.innerHeight - rect.bottom > FLIP_MARGIN;
      setAt({
        left: Math.min(rect.left, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
        ...(below
          ? { top: rect.bottom + 8 }
          : { bottom: Math.max(8, window.innerHeight - rect.top + 8) }),
      });
      onOpen?.();
    }, HOVER_INTENT_MS);
  }, [cancelTimers, onOpen]);

  // A fixed panel can't follow the scrolling container, so close instead of
  // drifting. Capture phase is required (the scroll happens on an inner <main>
  // and scroll events don't bubble to window) — but capture also catches the
  // panel's OWN overflow:auto list, which would slam it shut the moment the user
  // tried to scroll a long findings list. Ignore scrolls that start inside it.
  React.useEffect(() => {
    if (!at) return;
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [at, close]);

  React.useEffect(() => cancelTimers, [cancelTimers]);

  return (
    <span
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={closeSoon}
      onFocus={open}
      onBlur={closeSoon}
      style={s.trigger}
    >
      {children}
      {at && (
        <div
          ref={panelRef}
          style={s.panel(at)}
          // Keep it open while the pointer is in it — the panel scrolls and is
          // clickable, so it has to survive the trip across the gap.
          onMouseEnter={cancelTimers}
          onMouseLeave={closeSoon}
          // The PR list row navigates on click; the panel sits inside it.
          onClick={(e) => e.stopPropagation()}
        >
          {panel()}
        </div>
      )}
    </span>
  );
}
