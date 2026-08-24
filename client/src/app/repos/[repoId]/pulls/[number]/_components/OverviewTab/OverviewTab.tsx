/* OverviewTab — the PR Overview tab: the BRIEF card, then the derived INTENT and
   BLAST RADIUS cards side by side, then the PR's own description.

   This is the CONTAINER for all three: it owns every query and hands each card plain
   props, so they stay presentational and mountable without a QueryClient. Intent and
   blast share a row because they answer the two halves of the same question — what
   this change means to do (intent), and what else it could reach (blast) — and the
   brief sits above both because it is the reading a reviewer starts from and the only
   one written in their own terms. All three sit ABOVE the description, which is the
   raw claim they were derived from.

   The verdict banner IS here, at the top, where the design draws it — it reports the
   LAST agent run's verdict and score, which is that gauge's own rule. It renders only
   once something has run: a pull request nobody has reviewed has no verdict, and an
   empty headline is worse than none. The brief keeps its own risk level regardless,
   because a brief exists before any agent does. */
"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewRecord, RunSummary, Verdict } from "@devdigest/shared";
import { useDeriveIntent, useGenerateBrief, usePrBrief, usePrIntent } from "@/lib/hooks";
import { usePrBlast } from "@/lib/hooks/blast";
import { usePriorPrs } from "@/lib/hooks/prior-prs";
import { VerdictBanner } from "../VerdictBanner";
import { BriefCard } from "../BriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  /** Row uuid of the PR; null until the number → uuid lookup resolves. */
  prId: string | null;
  /** Current head of the PR — the card compares it against the stored SHA. */
  headSha: string | null | undefined;
  prBody: string | null | undefined;
  /** `owner/name`, for the blast card's github.com caller links. */
  repoFullName: string | null | undefined;
  /** Repository uuid, for the in-app links in the card's PRIOR PRS footer. */
  repoId: string;
  /**
   * Where a review-focus row on the brief card leads: the `Files changed` tab
   * with that file targeted (AC-40).
   *
   * Threaded from `PrDetailView`, which owns the URL. This tab knows which file
   * was chosen, not how the screen routes — and the card below knows about paths,
   * not about routes at all.
   */
  onOpenFile: (path: string, line?: number | null) => void;
  /**
   * The newest `kind: 'review'` row for this pull request, or null when no agent
   * has run. Derived in `PrDetailView` so "the last run" has one definition on
   * this screen, and passed in rather than queried here so this tab keeps handing
   * its cards plain props.
   */
  latestReview: ReviewRecord | null;
  /** That review's `agent_runs` row, for the banner's cost and token figures. */
  latestRun: RunSummary | null;
}

export function OverviewTab({
  prId,
  headSha,
  prBody,
  repoFullName,
  repoId,
  onOpenFile,
  latestReview,
  latestRun,
}: OverviewTabProps) {
  const brief = usePrBrief(prId);
  const generateBrief = useGenerateBrief(prId);
  const intent = usePrIntent(prId);
  const derive = useDeriveIntent(prId);
  const blast = usePrBlast(prId);
  // A second query behind one card, deliberately: `GET /pulls/:id/prior-prs` is a
  // history read over `pr_files`, not a read of the codebase index, and giving it
  // its own request keeps the impact map painting the moment it arrives.
  const priorPrs = usePriorPrs(prId);

  const blockers =
    latestReview?.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length ?? 0;

  // A fragment, not a wrapper: `PrDetailView`'s `s.tabColumn` is the flex column
  // that spaces these sections, and an extra div would swallow its gap.
  return (
    <>
      {/* The verdict of the LAST agent run, where the design puts it. Absent
          until something has run — a pull request nobody has reviewed has no
          verdict, and an empty banner would be a headline about nothing. That is
          why the brief below carries its own risk level rather than borrowing
          this gauge: the two answer different questions, and the brief exists
          before any agent does. */}
      {latestReview ? (
        <VerdictBanner
          verdict={latestReview.verdict as Verdict}
          summary={latestReview.summary}
          score={latestReview.score}
          findingsCount={latestReview.findings.length}
          blockers={blockers}
          costUsd={latestRun?.cost_usd ?? null}
          tokensIn={latestRun?.tokens_in ?? null}
          tokensOut={latestRun?.tokens_out ?? null}
        />
      ) : null}

      {/* ABOVE the grid, not inside it: the brief is one full-width reading of the
          whole pull request, while the grid's two cards are a pair that reflows to
          one column together. Neither of those cards moves. */}
      <BriefCard
        brief={brief.data ?? null}
        isLoading={brief.isLoading}
        isGenerating={generateBrief.isPending}
        error={brief.isError ? brief.error : null}
        generateError={generateBrief.isError ? generateBrief.error : null}
        onGenerate={() => generateBrief.mutate()}
        onOpenFile={onOpenFile}
      />

      <div style={s.overviewGrid}>
        <IntentCard
          intent={intent.data ?? null}
          isLoading={intent.isLoading}
          isDeriving={derive.isPending}
          error={intent.isError ? intent.error : null}
          headSha={headSha}
          onRederive={() => derive.mutate()}
        />

        <BlastRadiusCard
          blast={blast.data ?? null}
          isLoading={blast.isLoading}
          error={blast.isError ? blast.error : null}
          repoFullName={repoFullName}
          repoId={repoId}
          priorPrs={priorPrs.data ?? null}
          priorPrsLoading={priorPrs.isLoading}
          priorPrsError={priorPrs.isError ? priorPrs.error : null}
        />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
