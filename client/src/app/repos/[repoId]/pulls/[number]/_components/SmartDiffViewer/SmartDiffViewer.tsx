/* SmartDiffViewer — the reviewer-ordered diff (L03b).

   Presentational: every input is plain data, so it mounts with
   `NextIntlClientProvider` alone and no QueryClient. `DiffTab` is the container that
   owns the queries — the same split `OverviewTab`/`IntentCard` use, and the reason
   `SmartDiffViewer.test.tsx` can assert the whole state ladder without a query
   client.

   It owns two things: the join into a view model and the group order. Where a
   finding badge LEADS is not its decision — it reports the finding's id upward and
   `PrDetailView` turns that into a route change (see `onOpenFinding`), which is
   what keeps this component free of `next/navigation`.

   It also ACCEPTS a target — a file, optionally a line — from whoever owns the
   URL, and does the two things a target implies: expand that file whatever the
   expansion rule says, and let the card scroll — to the row when a line was
   given, to the card itself when none was. It reads no search param itself, for
   the same reason it reports a finding id rather than pushing a route: this
   component knows about files and lines, not about the screen's routes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
import { useStickyOffset } from "@/lib/sticky-offset";
import { buildViewModel, groupFiles, samePath } from "./helpers";
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
  /**
   * Path of a changed file the reader was sent to, if any.
   *
   * Optional because the whole tab works without one: nothing passes it until the
   * screen that owns the URL does. The path is compared the way the view model
   * matches paths (see `samePath`), so a target that names a file this page of
   * the diff never received simply matches nothing here — `DiffTab` is what says
   * so, because it is the one that knows the file list is an excerpt.
   */
  targetFile?: string;
  /**
   * Line inside `targetFile` to reveal. **Explicitly ungrounded**: it comes from a
   * model that never saw a hunk body, so nothing checks that the number means
   * anything. A scroll to a plausible but wrong line is acceptable; landing on the
   * wrong FILE is not, which is why the file is matched and the line is not.
   *
   * Usually absent, which is why its absence is not a state that scrolls nowhere:
   * the card is the fallback anchor (see `SmartFileCard`).
   */
  targetLine?: number;
}

export function SmartDiffViewer({
  files,
  smartDiff,
  findings,
  grouped,
  commenting,
  onOpenFinding,
  targetFile,
  targetLine,
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

  /**
   * Openness of one card: the reader's own choice first, then the target, then the
   * rule (the card applies `initialOpen` when this is `undefined`).
   *
   * DERIVED from the target rather than written into `openOverrides`, and that is
   * the load-bearing part: seeding the map from a prop would need a `setState` in
   * an effect, which `react-hooks/set-state-in-effect` rejects as an **Error**
   * here and would fail `next build` (`client/INSIGHTS.md`, 2026-08-11). Deriving
   * it also means the targeted row exists in the SAME commit the target arrives
   * in, so the card's scroll effect has something to find on its first run instead
   * of needing a second render.
   *
   * The reader still wins: an explicit collapse writes `false` into the map, which
   * is checked first, so a target cannot re-open a file they just closed.
   */
  /**
   * Does the target name this file? One comparison, used by everything the target
   * drives — openness, the card's scroll and the line's — so a file cannot be the
   * target for one of them and not for another.
   */
  const isTarget = React.useCallback(
    (path: string): boolean => targetFile != null && samePath(path, targetFile),
    [targetFile],
  );

  const openOverrideFor = React.useCallback(
    (path: string): boolean | undefined =>
      openOverrides[path] ?? (isTarget(path) ? true : undefined),
    [openOverrides, isTarget],
  );

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
            openOverride={openOverrideFor(file.path)}
            targeted={isTarget(file.path)}
            targetLine={isTarget(file.path) ? targetLine : undefined}
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
              openOverride={openOverrideFor(file.path)}
              targeted={isTarget(file.path)}
              targetLine={isTarget(file.path) ? targetLine : undefined}
              onToggle={onToggle}
              onOpenFinding={onOpenFinding}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
