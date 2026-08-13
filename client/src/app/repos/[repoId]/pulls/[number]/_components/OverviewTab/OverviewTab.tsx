/* OverviewTab — the PR Overview tab: the derived INTENT card, then the PR's own
   description.

   This is the CONTAINER for the intent: it owns both queries and hands
   `IntentCard` plain props, so the card stays presentational and mountable
   without a QueryClient. The card sits ABOVE the description on purpose — it is
   what the system understood, and the description is the raw claim it was
   derived from. */
"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { useDeriveIntent, usePrIntent } from "@/lib/hooks";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  /** Row uuid of the PR; null until the number → uuid lookup resolves. */
  prId: string | null;
  /** Current head of the PR — the card compares it against the stored SHA. */
  headSha: string | null | undefined;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, headSha, prBody }: OverviewTabProps) {
  const intent = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  // A fragment, not a wrapper: `PrDetailView`'s `s.tabColumn` is the flex column
  // that spaces these two sections, and an extra div would swallow its gap.
  return (
    <>
      <IntentCard
        intent={intent.data ?? null}
        isLoading={intent.isLoading}
        isDeriving={derive.isPending}
        error={intent.isError ? intent.error : null}
        headSha={headSha}
        onRederive={() => derive.mutate()}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
