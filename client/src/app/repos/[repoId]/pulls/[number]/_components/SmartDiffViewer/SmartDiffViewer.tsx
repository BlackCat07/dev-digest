/* SmartDiffViewer — the reviewer-ordered diff (L03b).

   Presentational: every input is plain data, so it mounts with
   `NextIntlClientProvider` alone and no QueryClient. `DiffTab` is the container that
   owns the queries — the same split `OverviewTab`/`IntentCard` use, and the reason
   `SmartDiffViewer.test.tsx` can assert the whole state ladder without a query
   client.

   It owns two things: the join into a view model and the group order. Where a
   finding badge LEADS is not its decision — it reports the finding's id upward and
   `PrDetailView` turns that into a route change (see `onOpenFinding`), which is
   what keeps this component free of `next/navigation`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
import { useStickyOffset } from "@/lib/sticky-offset";
import { buildViewModel, groupFiles } from "./helpers";
import { s } from "./styles";
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
  /**
   * Called with the id of the finding a badge stands for.
   *
   * The badges are the tab's navigation: a file's badge reports that file's worst
   * finding, a line's tag reports the worst finding on that line, and the container
   * routes to that finding's card in the Agent-runs tab. Deliberately an id and not
   * a URL — this component knows about findings, not about the PR screen's routes.
   */
  onOpenFinding: (findingId: string) => void;
}

export function SmartDiffViewer({
  files,
  smartDiff,
  findings,
  grouped,
  commenting,
  onOpenFinding,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  // Publishes the sticky header's measured height on this subtree, which the
  // badges read as `scrollMarginTop`. Nothing in this tab scrolls itself any
  // more, but anything that scrolls a BADGE into view — Tab-focus, an automated
  // click — otherwise parks it under that header, where it cannot be clicked.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useStickyOffset(rootRef);

  /**
   * Per-path openness, but only where the reader has overridden the rule.
   *
   * A sparse override map, not a full state: a path absent from it falls back to
   * `initialOpen`, so the expansion RULE stays the single source of truth for a
   * file nobody has touched.
   */
  const [openOverrides, setOpenOverrides] = React.useState<Record<string, boolean>>({});

  const onToggle = React.useCallback((path: string, next: boolean) => {
    setOpenOverrides((prev) => ({ ...prev, [path]: next }));
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
            openOverride={openOverrides[file.path]}
            onToggle={onToggle}
            onOpenFinding={onOpenFinding}
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
              openOverride={openOverrides[file.path]}
              onToggle={onToggle}
              onOpenFinding={onOpenFinding}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
