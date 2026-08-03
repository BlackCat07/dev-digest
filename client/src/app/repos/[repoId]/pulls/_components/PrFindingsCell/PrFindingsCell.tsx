/* PrFindingsCell — the PR list's FINDINGS column: severity counters from the
   list payload, plus a hover panel with the findings themselves.

   The counters come free with the row (`PrMeta.findings_by_severity`), but the
   panel needs each finding's title/file/rationale, which the list endpoint
   doesn't carry. So the panel FETCHES on hover, through the same
   `GET /pulls/:id/reviews` the detail page uses — same query key, so hovering
   warms the detail page's cache and vice versa.

   The fetch lives in a child that only MOUNTS while the panel is open. That
   keeps a 50-row list from registering 50 idle queries, and keeps `PRRow`
   itself free of TanStack Query (its test renders without a QueryClientProvider). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { SeverityCounters } from "../SeverityCounters";
import { FindingsHoverPanel, FindingsHoverTrigger } from "../FindingsHoverCard";
import { totalOf } from "@/lib/severity";

function PrFindingsHoverBody({
  prId,
  onFindingClick,
}: {
  prId: string;
  onFindingClick?: () => void;
}) {
  const { data, isLoading, isError } = usePrReviews(prId);
  // Only kind==='review' rows, matching the server's rollup for the counters.
  const findings = React.useMemo(
    () => (data ?? []).filter((r) => r.kind === "review").flatMap((r) => r.findings),
    [data],
  );
  return (
    <FindingsHoverPanel
      findings={findings}
      loading={isLoading}
      error={isError}
      {...(onFindingClick ? { onFindingClick } : {})}
    />
  );
}

export function PrFindingsCell({
  pr,
  repoId,
  title,
}: {
  pr: PrMeta;
  repoId: string;
  title?: string;
}) {
  const router = useRouter();
  const counts = pr.findings_by_severity;
  const prId = pr.id;

  // Nothing to reveal: no findings, or no id to fetch them with.
  if (totalOf(counts) === 0 || !prId) {
    return <SeverityCounters counts={counts} zero="dash" title={title} />;
  }

  return (
    <FindingsHoverTrigger
      panel={() => (
        <PrFindingsHoverBody
          prId={prId}
          // Straight to the tab the findings live on. The row's own click goes to
          // the PR's default tab (Overview), which is not where you were looking.
          onFindingClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}?tab=findings`)}
        />
      )}
    >
      <SeverityCounters counts={counts} zero="dash" dotted title={title} />
    </FindingsHoverTrigger>
  );
}
