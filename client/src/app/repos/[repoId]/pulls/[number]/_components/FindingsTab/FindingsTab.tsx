"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { useStickyOffset } from "@/lib/sticky-offset";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { useCancelRun } from "@/lib/hooks";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /** Derived from the hook the parent actually passes, so the four type
   *  parameters cannot drift out of sync with it. */
  cancelMutation: ReturnType<typeof useCancelRun>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * The finding `?finding=` names, if any — the landing of a badge press in the
   * diff. The run holding it opens itself and its card scrolls into view.
   *
   * Matched against a finding ID rather than a run: the reader clicked one problem,
   * and which run happens to have reported it is not something they know.
   */
  targetFindingId?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  targetFindingId,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  // A targeted card scrolls itself into view, and has to clear the sticky PR
  // header to be readable — the same measured offset the diff introduced, which is
  // why the hook now lives in `src/lib/` rather than inside Smart Diff.
  const rootRef = React.useRef<HTMLElement | null>(null);
  useStickyOffset(rootRef);

  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  // A ReviewRecord carries the verdict/findings but no usage; the matching
  // RunSummary carries tokens + cost. Both arrays are already here, and
  // `review.run_id` is the join key — cheaper than widening the review contract.
  const runByRunId = React.useMemo(
    () => new Map((prRuns ?? []).map((r) => [r.run_id, r])),
    [prRuns],
  );

  // The timeline's findings, keyed by run. `RunSummary` carries only a total, so
  // the findings are joined in from the reviews by `run_id` — the same key
  // `runByRunId` uses, in the other direction. Reviews with a null `run_id` (the
  // seeded review, and any pre-run_id row) simply contribute no entry, so the
  // timeline renders no counters and no hover target for them.
  //
  // Passing the findings rather than pre-aggregated counts keeps one source of
  // truth: `RunHistory` derives the counters from them AND feeds the same array
  // to the hover panel, so the two can never disagree.
  const findingsByRunId = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const review of runs) {
      if (!review.run_id || review.kind !== "review") continue;
      const prev = m.get(review.run_id);
      if (prev) prev.push(...review.findings);
      else m.set(review.run_id, [...review.findings]);
    }
    return m;
  }, [runs]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  return (
    <section ref={rootRef}>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRunId={findingsByRunId}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            run={review.run_id ? runByRunId.get(review.run_id) ?? null : null}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
            targetFindingId={targetFindingId ?? null}
          />
        ))
      )}
    </section>
  );
}
