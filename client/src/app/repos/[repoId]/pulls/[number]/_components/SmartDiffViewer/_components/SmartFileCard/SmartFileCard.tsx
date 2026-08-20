/* SmartFileCard — one file of the reviewer-ordered diff: header, the quoted
   "what this does" line, the diff with its findings decorated, and any findings
   whose line this patch does not contain.

   A new composition rather than an extension of the diff-viewer's `FileCard`. It
   reuses that unit's parser, styles and — crucially — its `CodeLine`, so inline
   commenting cannot drift between the two cards. What it replaces is the parts
   Smart Diff redefines: `FileCard` initialises `open` from size alone and is not
   controllable, whereas this card opens by rule (see `initialOpen`) and by the
   reader's own toggle.

   Every badge in here is a link to a finding's CARD, not to a place in this file:
   the header badge stands for the file's worst finding, a row's tag for the worst
   finding on that row, and both report an id the container routes on. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import {
  CodeLine,
  OutdatedComments,
  buildThreads,
  chevronFor,
  diffStyles,
  keysForLine,
  parsePatch,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
  type Line,
} from "@/components/diff-viewer";
import {
  initialOpen,
  lineId,
  offDiffId,
  partitionFindings,
  severityByLine,
} from "../../helpers";
import { s } from "../../styles";
import type { SmartFileVm } from "../../types";
import { FindingJumpBadge } from "../FindingJumpBadge";
import { FindingLineBadge } from "../FindingLineBadge";
import { s as cardStyles } from "./styles";

/** Threads anchored to a given parsed line — mirrors the diff-viewer's own helper. */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function SmartFileCard({
  file,
  commenting,
  openOverride,
  targetLine,
  onToggle,
  onOpenFinding,
}: {
  file: SmartFileVm;
  commenting?: DiffCommentApi;
  /** The reader's explicit choice, if they have made one; otherwise the rule decides. */
  openOverride: boolean | undefined;
  /**
   * The line to reveal, set only when the tab's target names THIS file — the
   * viewer does the path matching, so this card never compares paths itself.
   */
  targetLine?: number;
  onToggle: (path: string, next: boolean) => void;
  onOpenFinding: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  // The "no diff text" line belongs to the shared diff renderer, not to this
  // feature — reusing its key keeps one wording for one situation.
  const tShell = useTranslations("shell");

  // DERIVED, not state: openness is the rule unless the reader has overridden it,
  // and the override lives in the viewer so one map covers every card.
  const open = openOverride ?? initialOpen(file);

  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const { byLine, offDiff } = React.useMemo(
    () => partitionFindings(file.findings, lines),
    [file.findings, lines],
  );
  const edgeSeverity = React.useMemo(
    () => severityByLine(file.findings, lines),
    [file.findings, lines],
  );

  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  // ---- the target ------------------------------------------------------------
  //
  // ONE effect, and it touches only the DOM and a ref — which is what an effect is
  // for. It cannot open this card: openness is derived from the target one level
  // up (see `openOverrideFor`), so the row already exists in the commit this runs
  // after. Written as two effects — one to open, one to scroll — it would be
  // `react-hooks/set-state-in-effect`, an **Error** in this package that fails
  // `next build` (`client/INSIGHTS.md`, 2026-08-11).
  //
  // The ref is the idempotence guard. Without it any later re-render that happens
  // to re-run this effect would scroll the page out from under a reader who has
  // since scrolled somewhere else. Keyed on the line, so a new target scrolls and
  // the same one never scrolls twice.
  //
  // A line the patch does not render resolves to no element and the scroll is a
  // no-op: the number is explicitly ungrounded (the model never saw a hunk body),
  // so landing on the file is the promise and landing on the line is the
  // convenience.
  const scrolledLine = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (targetLine == null || !open) return;
    if (scrolledLine.current === targetLine) return;
    scrolledLine.current = targetLine;
    // `getElementById`, never `querySelector`: a path's `/` and `.` are legal in an
    // id but are selector syntax, so a selector needs `CSS.escape` and silently
    // matches nothing without it.
    document
      .getElementById(lineId(file.path, targetLine))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [targetLine, open, file.path]);

  return (
    <div style={diffStyles.fileCard}>
      <div style={s.fileHeader}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(file.path, !open)}
          style={s.disclosure}
        >
          <Icon.ChevronRight size={13} style={chevronFor(open)} />
          <Icon.FileText size={14} style={diffStyles.fileIcon} />
          <span className="mono" style={diffStyles.filePath}>
            {file.path}
          </span>
          {file.hasBlockers && (
            // Redundant with the badge's icon + word, so it is decoration only.
            <span aria-hidden="true" title={t("smartDiff.hasBlockers")} style={s.blockerDot} />
          )}
        </button>

        {file.summary && (
          <span style={cardStyles.pill}>
            <Icon.Sparkles size={11} />
            {t("smartDiff.summaryPill")}
          </span>
        )}

        <span className="mono tnum" style={diffStyles.fileStat}>
          <span style={diffStyles.addText}>+{file.additions}</span>{" "}
          <span style={diffStyles.delText}>−{file.deletions}</span>
        </span>

        {file.findings[0] && (
          <FindingJumpBadge
            path={file.path}
            count={file.findings.length}
            // `findings` is sorted worst-first, so the leader is the file's worst —
            // and it is the one the badge opens. It needs no line: a finding whose
            // line this patch never rendered still has a card.
            worst={file.findings[0].severity}
            onOpen={() => onOpenFinding(file.findings[0]!.id)}
          />
        )}
      </div>

      {open && (
        <>
          {file.summary && (
            <div style={s.summaryRow}>
              <Icon.Sparkles size={12} style={s.summaryIcon} />
              <span>
                <span style={s.summaryLabel}>{t("smartDiff.whatThisDoes")}</span>{" "}
                <span className="mono">{file.summary}</span>
              </span>
            </div>
          )}

          <div style={diffStyles.fileBody}>
            {lines.length === 0 ? (
              <div style={diffStyles.noDiff}>{tShell("diffViewer.noDiffText")}</div>
            ) : (
              lines.map((ln, i) => {
                const lineNo = ln.kind === "add" || ln.kind === "ctx" ? ln.newNo : undefined;
                const severity = lineNo != null ? edgeSeverity.get(lineNo) : undefined;
                const anchored = lineNo != null ? byLine.get(lineNo) : undefined;
                const edge = severity
                  ? s.lineEdge((SEV[severity as keyof typeof SEV] ?? SEV.INFO).c)
                  : undefined;
                // The scroll margin goes on the row the target names, and on no
                // other: it is what keeps that row clear of the sticky header.
                const isTarget = targetLine != null && lineNo === targetLine;
                return (
                  <CodeLine
                    key={i}
                    ln={ln}
                    path={file.path}
                    threads={threadsForLine(ln, matched)}
                    commenting={commenting}
                    id={lineNo != null ? lineId(file.path, lineNo) : undefined}
                    rowStyle={isTarget ? { ...edge, ...s.targetRow } : edge}
                    right={
                      anchored?.[0] ? (
                        /* `findings` is sorted worst-first, so `[0]` is the worst
                           severity on this line; `count` says how many it stands
                           for, so the tags reconcile with the header's total. */
                        <FindingLineBadge
                          severity={anchored[0].severity}
                          count={anchored.length}
                          onOpen={() => onOpenFinding(anchored[0]!.id)}
                        />
                      ) : undefined
                    }
                  />
                );
              })
            )}

            {offDiff.length > 0 && (
              <div id={offDiffId(file.path)} style={s.offDiff}>
                <Icon.AlertTriangle size={12} />
                {t("smartDiff.lineOffDiff", { count: offDiff.length })}
              </div>
            )}

            {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          </div>
        </>
      )}
    </div>
  );
}
