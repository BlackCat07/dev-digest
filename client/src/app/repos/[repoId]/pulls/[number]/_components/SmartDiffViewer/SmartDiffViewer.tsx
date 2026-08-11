/* SmartDiffViewer — the reviewer-ordered diff (L03b).

   Presentational: every input is plain data, so it mounts with
   `NextIntlClientProvider` alone and no QueryClient. `DiffTab` is the container that
   owns the queries — the same split `OverviewTab`/`IntentCard` use, and the reason
   `SmartDiffViewer.test.tsx` can assert the whole state ladder without a query
   client.

   It owns three things: the join into a view model, the group order, and the jump
   target. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
import { STICKY_CSS_VAR, STICKY_HEADER_SELECTOR } from "./constants";
import { buildViewModel, groupFiles } from "./helpers";
import { s } from "./styles";
import type { JumpTarget } from "./types";
import { SmartDiffGroupHeader } from "./_components/SmartDiffGroupHeader";
import { SmartFileCard } from "./_components/SmartFileCard";

export interface SmartDiffViewerProps {
  files: PrFile[];
  /** The grouping. `null` degrades to a flat, ungrouped render — never a blank tab. */
  smartDiff: SmartDiff | null | undefined;
  findings: FindingRecord[];
  /** False renders the same cards in `pr.files` order with no group headers. */
  grouped: boolean;
  commenting?: DiffCommentApi;
}

/**
 * Publish the sticky header's measured height as a CSS variable on this subtree.
 *
 * A scrolled-to line has to clear `PrDetailHeader`, which is `position: sticky` at
 * the top of the `<main>` that actually scrolls (not the window). Its height varies —
 * taller on a merged PR, taller again when the meta row wraps — so a constant
 * `scrollMarginTop` is wrong for some PRs, which is why this is measured rather than
 * chosen. `ResizeObserver` is stubbed as a no-op under jsdom, so the fallback in
 * `styles.ts` is what tests and the first paint use.
 */
function useStickyOffset(ref: React.RefObject<HTMLDivElement | null>): void {
  React.useEffect(() => {
    const header = document.querySelector(STICKY_HEADER_SELECTOR);
    const root = ref.current;
    if (!header || !root) return;

    const apply = () => {
      root.style.setProperty(STICKY_CSS_VAR, `${Math.round(header.getBoundingClientRect().height)}px`);
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [ref]);
}

export function SmartDiffViewer({
  files,
  smartDiff,
  findings,
  grouped,
  commenting,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useStickyOffset(rootRef);

  const [target, setTarget] = React.useState<JumpTarget | null>(null);
  /**
   * Per-path openness, but only where the reader has overridden the rule.
   *
   * Held here rather than in each card because a jump has to open the target card
   * AND scroll inside it: doing that from the card would mean `setOpen` in an
   * effect, which `react-hooks/set-state-in-effect` rejects as an error. Setting
   * both from one click handler is also simply better — React batches them, so the
   * card's scroll effect runs after a single commit in which the row already exists.
   *
   * A sparse override map, not a full state: a path absent from it falls back to
   * `initialOpen`, so the expansion RULE stays the single source of truth for a file
   * nobody has touched.
   */
  const [openOverrides, setOpenOverrides] = React.useState<Record<string, boolean>>({});

  const onToggle = React.useCallback((path: string, next: boolean) => {
    setOpenOverrides((prev) => ({ ...prev, [path]: next }));
  }, []);

  const onJump = React.useCallback((path: string, line: number) => {
    setOpenOverrides((prev) => ({ ...prev, [path]: true }));
    // The nonce is bumped rather than the target replaced, so clicking the same
    // badge twice really scrolls twice.
    setTarget((prev) => ({ path, line, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const model = React.useMemo(
    () => buildViewModel(files, smartDiff, findings),
    [files, smartDiff, findings],
  );

  if (model.length === 0) {
    return <div style={s.empty}>{t("smartDiff.noFiles")}</div>;
  }

  // Ungrouped: the same cards, the same badges, the same decoration — the toggle
  // changes the ORDER and nothing else.
  if (!grouped) {
    return (
      <div ref={rootRef} style={s.list}>
        {model.map((file) => (
          <SmartFileCard
            key={file.path}
            file={file}
            commenting={commenting}
            target={target}
            openOverride={openOverrides[file.path]}
            onToggle={onToggle}
            onJump={onJump}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={s.list}>
      {groupFiles(model).map((group) => (
        <section key={group.role} style={s.group}>
          <SmartDiffGroupHeader role={group.role} count={group.files.length} />
          {group.files.map((file) => (
            <SmartFileCard
              key={file.path}
              file={file}
              commenting={commenting}
              target={target}
              openOverride={openOverrides[file.path]}
              onToggle={onToggle}
              onJump={onJump}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
