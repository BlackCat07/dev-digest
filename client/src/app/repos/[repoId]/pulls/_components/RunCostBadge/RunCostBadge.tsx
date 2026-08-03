/* RunCostBadge — a dollar cost of agent work, one run's or a whole review's.

   Rendered in three places, hence the three variants:
     compact  the PR list's COST column          "$0.019"  (SUM over agents)
     detail   a PR-detail timeline row           "9,119 tok · $0.0013"  (one run)
     inline   the verdict banner on PR detail    "$0.014 · 8.2K→1.3K"   (one run)

   A missing cost renders "—", never "$0.00": a provider that reported no cost is
   not the same as a free run (which renders "$0"). No i18n inside — this renders
   only numbers and symbols; the LABELS ("COST", "Cost") stay in messages/en at
   the call sites. */
"use client";

import React from "react";
import { formatCost, formatTokenFlow, formatTokenTotal } from "@/lib/format";
import { s } from "./styles";

export type RunCostVariant = "compact" | "detail" | "inline";

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  title,
}: {
  /** One `agent_runs.cost_usd`, or a sum of them (the PR list's COST column).
   *  null = no cost data; undefined = a pre-cost trace. */
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: RunCostVariant;
  /** Native tooltip, e.g. "Total cost of this PR's review (all agents)". */
  title?: string;
}) {
  const cost = formatCost(costUsd);
  const absent = costUsd == null;

  if (variant === "compact") {
    return (
      <span className="mono tnum" style={s.compact(absent)} title={title}>
        {cost}
      </span>
    );
  }

  // `detail` leads with the token total, `inline` leads with the cost — matching
  // the design for each surface.
  const costEl = (
    <span key="cost" style={s.cost(absent)}>
      {cost}
    </span>
  );
  const tokensEl = (
    <span key="tokens">
      {variant === "detail"
        ? formatTokenTotal(tokensIn, tokensOut)
        : formatTokenFlow(tokensIn, tokensOut)}
    </span>
  );

  return (
    <span className="mono tnum" style={s.row(variant)} title={title}>
      {variant === "detail" ? tokensEl : costEl}
      <span>·</span>
      {variant === "detail" ? costEl : tokensEl}
    </span>
  );
}
