/* OverviewTab — the PR Overview tab: the derived INTENT and BLAST RADIUS cards side
   by side, then the PR's own description.

   This is the CONTAINER for both: it owns every query and hands each card plain
   props, so they stay presentational and mountable without a QueryClient. The two
   cards share a row because they answer the two halves of the same question — what
   this change means to do (intent), and what else it could reach (blast) — and both
   sit ABOVE the description, which is the raw claim they were derived from. */
"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { useDeriveIntent, usePrIntent } from "@/lib/hooks";
import { usePrBlast } from "@/lib/hooks/blast";
import { usePriorPrs } from "@/lib/hooks/prior-prs";
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
}

export function OverviewTab({
  prId,
  headSha,
  prBody,
  repoFullName,
  repoId,
}: OverviewTabProps) {
  const intent = usePrIntent(prId);
  const derive = useDeriveIntent(prId);
  const blast = usePrBlast(prId);
  // A second query behind one card, deliberately: `GET /pulls/:id/prior-prs` is a
  // history read over `pr_files`, not a read of the codebase index, and giving it
  // its own request keeps the impact map painting the moment it arrives.
  const priorPrs = usePriorPrs(prId);

  // A fragment, not a wrapper: `PrDetailView`'s `s.tabColumn` is the flex column
  // that spaces these sections, and an extra div would swallow its gap.
  return (
    <>
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
