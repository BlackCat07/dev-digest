/* SmartFileCard — one file of the reviewer-ordered diff: header, the quoted
   "what this does" line, the diff with its findings decorated, and any findings
   whose line this patch does not contain.

   A new composition rather than an extension of the diff-viewer's `FileCard`. It
   reuses that unit's parser, styles and — crucially — its `CodeLine`, so inline
   commenting cannot drift between the two cards. What it replaces is the parts
   Smart Diff redefines: `FileCard` initialises `open` from size alone and is not
   controllable, whereas this card must open on demand (a jump) and by rule (see
   `initialOpen`). */
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
  firstJumpLine,
  initialOpen,
  lineId,
  offDiffId,
  partitionFindings,
  severityByLine,
} from "../../helpers";
import { s } from "../../styles";
import type { JumpTarget, SmartFileVm } from "../../types";
import { FindingJumpBadge } from "../FindingJumpBadge";
import { SeverityTag } from "../SeverityTag";
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
  target,
  openOverride,
  onToggle,
  onJump,
}: {
  file: SmartFileVm;
  commenting?: DiffCommentApi;
  /** The viewer's current jump request; acted on only when it names this file. */
  target: JumpTarget | null;
  /** The reader's explicit choice, if they have made one; otherwise the rule decides. */
  openOverride: boolean | undefined;
  onToggle: (path: string, next: boolean) => void;
  onJump: (path: string, line: number) => void;
}) {
  const t = useTranslations("prReview");
  // The "no diff text" line belongs to the shared diff renderer, not to this
  // feature — reusing its key keeps one wording for one situation.
  const tShell = useTranslations("shell");

  // DERIVED, not state. Openness lives in the viewer because a jump has to open
  // this card and scroll to a row inside it, and holding it here would mean
  // `setOpen` in an effect — which `react-hooks/set-state-in-effect` rejects as an
  // error, not a warning. Deriving it also removes the two-render dance the first
  // implementation needed: the jump handler sets openness AND the target in one
  // batched event, so by the time the effect below runs the row is already mounted.
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

  // ---- the jump --------------------------------------------------------------
  //
  // One effect, and it touches only the DOM and a ref — which is what an effect is
  // for. It cannot open the card (that is the viewer's job, done in the same click)
  // so by the time this runs the row exists.
  //
  // The ref is the idempotence guard: `byLine` is a fresh Map whenever findings or
  // the patch change, so without it an unrelated re-render would re-scroll the page
  // out from under the reader. Keyed on the nonce, which is exactly "how many jump
  // requests have been made" — so clicking the same badge twice scrolls twice, and
  // nothing else scrolls at all.
  const scrolledNonce = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!target || target.path !== file.path || !open) return;
    if (scrolledNonce.current === target.nonce) return;
    scrolledNonce.current = target.nonce;

    const id = byLine.has(target.line) ? lineId(file.path, target.line) : offDiffId(file.path);
    // `getElementById`, never `querySelector`: a path's `/` and `.` are selector
    // syntax and would need `CSS.escape` to match anything.
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [target, open, byLine, file.path]);

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
            // `findings` is sorted worst-first, so the leader is the file's worst.
            worst={file.findings[0].severity}
            onJump={() => {
              // Prefer a real diff line; `null` still jumps, to the off-diff footer.
              onJump(file.path, firstJumpLine(file.findings, lines) ?? -1);
            }}
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
                return (
                  <CodeLine
                    key={i}
                    ln={ln}
                    path={file.path}
                    threads={threadsForLine(ln, matched)}
                    commenting={commenting}
                    id={lineNo != null ? lineId(file.path, lineNo) : undefined}
                    rowStyle={
                      severity
                        ? s.lineEdge((SEV[severity as keyof typeof SEV] ?? SEV.INFO).c)
                        : s.scrollAnchor
                    }
                    right={
                      anchored?.[0] ? (
                        <span style={s.lineBadgeWrap}>
                          {/* `findings` is sorted worst-first, so `[0]` is the worst
                              severity on this line; `count` says how many it stands
                              for, so the tags reconcile with the header's total. */}
                          <SeverityTag severity={anchored[0].severity} count={anchored.length} />
                        </span>
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
