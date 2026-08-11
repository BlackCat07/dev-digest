/* DiffTab — the "Files changed" tab.

   The CONTAINER: it owns the queries (inline comments, the role grouping) and picks
   which of three renderings the tab gets. `SmartDiffViewer` below it is
   presentational and takes plain props, the same split `OverviewTab`/`IntentCard`
   use.

   The degradation ladder is the part worth reading. Smart Diff is an ordering, and an
   ordering has no partial state — so:

     loading  → the header and a skeleton, NOT the flat diff. Painting the wrong
                order for 200ms and then rearranging it under the reader's cursor is
                worse than a moment of nothing, because order is the whole feature.
     error    → a muted inline notice AND the original flat `DiffViewer`, with inline
                commenting intact. The tab falls back to exactly what it was before
                this feature existed; it is never blank.
     ok       → the grouped viewer.

   `pr.files_count` and `pr.files.length` can legitimately differ — GitHub caps the
   file list on a very large PR, which is why this component has always taken both.
   The summary line reports `files_count` (the truth about the PR) while the list can
   only render what arrived. */
"use client";

import React from "react";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { usePrSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile, ReviewRecord } from "@devdigest/shared";
import {
  DiffOrderToggle,
  SmartDiffViewer,
  latestFindingsPerAgent,
  type DiffOrder,
} from "../SmartDiffViewer";
import { SKELETON_ROWS } from "./constants";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** The PR's own totals, for the summary line — no request needed. */
  additions: number;
  deletions: number;
  /**
   * The PR's review rows, NEWEST-FIRST, not a flat findings list.
   *
   * The tab needs the rows rather than `PrDetailView`'s `allFindings` because it has
   * to reduce them to the newest review per agent — see `latestFindingsPerAgent`.
   * Handed the flat list, the badge counted every superseded re-run and grew each
   * time an agent was re-run.
   */
  reviews: ReviewRecord[];
  order: DiffOrder;
  onOrderChange: (next: DiffOrder) => void;
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  additions,
  deletions,
  reviews,
  order,
  onOrderChange,
  canComment,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const smartDiff = usePrSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  // The newest review per agent, so a re-run REPLACES a file's badge instead of
  // adding to it — the same reduction `modules/smart-diff/findings.ts` does server
  // side, which is what keeps this count equal to the response's `finding_lines`.
  const findings = React.useMemo(() => latestFindingsPerAgent(reviews), [reviews]);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const degraded = smartDiff.isError || (!smartDiff.isLoading && !smartDiff.data);
  const loading = smartDiff.isLoading;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? t("smartDiff.hideComments") : t("smartDiff.showComments")} (
              {commentCount})
            </Button>
          ) : undefined
        }
      >
        {t("smartDiff.label")}
      </SectionLabel>

      <div style={s.metaRow}>
        <span className="tnum" style={s.summary}>
          {t("smartDiff.summary", { files: filesCount, additions, deletions })}
        </span>
        <DiffOrderToggle
          value={degraded ? "original" : order}
          onChange={onOrderChange}
          smartDisabled={degraded || loading}
        />
      </div>

      {degraded && <div style={s.notice}>{t("smartDiff.unavailable")}</div>}

      {loading ? (
        <div style={s.skeletons} aria-label={t("smartDiff.grouping")}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      ) : degraded ? (
        <DiffViewer files={files} commenting={commenting} />
      ) : (
        <SmartDiffViewer
          files={files}
          smartDiff={smartDiff.data}
          findings={findings}
          grouped={order === "smart"}
          commenting={commenting}
        />
      )}
    </section>
  );
}
