/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score.

   Two deliberate departures from the first port:

     - **No agent badge.** The banner names a VERDICT, not who produced it. On the
       Overview tab it renders the latest run, and the agent that ran is already
       the subject of `Agent runs`; inside `ReviewRunAccordion` the row header
       above it opens with that agent's name and a Cpu glyph, so the badge said
       the same word twice. Both call sites still know the agent — they just no
       longer hand it here.
     - **The run's receipt sits under the score, not under the summary.** The
       cost and the token flow are figures about the run that produced this
       verdict, the same kind of fact as the score, so they belong in the same
       rail with a rule between the judgement and its price.

   The card is TWO ROWS, not one. The verdict word and the findings badge own the
   top line; the summary and the score rail are siblings on a second line beneath
   it. As one row the paragraph was boxed in between the icon gutter and the rail
   and ended up the narrowest element on a full-width card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { VERDICT_META } from "./constants";
import { s } from "./styles";
import { RunCostBadge } from "../../../_components/RunCostBadge";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  costUsd,
  tokensIn,
  tokensOut,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  /** Usage of the run that produced this review; joined in by the parent. */
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  const hasCost = costUsd != null;
  // The rail carries either figure alone: a review whose run row is gone has a
  // score and no cost, and a pre-score review can still have cost. Only when
  // BOTH are absent does the rail go away rather than render an empty column.
  const hasRail = score != null || hasCost;
  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <div style={s.iconBox(m.bg, m.c)}>
          <VIcon size={18} />
        </div>
        <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
        <Badge color="var(--text-secondary)" style={s.countBadge}>
          {t("verdict.findingsCount", { count: findingsCount })}
          {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
        </Badge>
      </div>
      <div style={s.body}>
        {summary && <p style={s.summary}>{summary}</p>}
        {hasRail && (
          <div style={s.scoreCol}>
            {score != null && (
              <>
                <CircularScore score={score} size={48} stroke={4} />
                <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
              </>
            )}
            {hasCost && (
              <>
                {/* Only between the two — a rule above a lone cost line would be
                    a divider separating it from nothing. */}
                {score != null && <div style={s.scoreRule} />}
                <div style={s.costRow}>
                  <RunCostBadge
                    costUsd={costUsd}
                    tokensIn={tokensIn}
                    tokensOut={tokensOut}
                    variant="inline"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
