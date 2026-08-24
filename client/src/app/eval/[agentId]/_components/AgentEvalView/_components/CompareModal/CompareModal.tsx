/* The comparison modal — two batches of one agent, side by side.

   Four cards, and the fourth is deliberately not a metric: recall, precision and
   citation accuracy are 0–1 ratios rendered as percentages with their change in
   PERCENTAGE POINTS, while cost carries currency and takes the currency
   formatter. Both formatters come from `src/lib/eval.ts`, which is the single
   place this feature's delta convention is defined; a local one here would put
   two conventions on one screen.

   Three rules the modal exists to keep:

     - A null change says "not measured" and never renders a zero. A change is
       null whenever either side was never measured, and `0pt` would claim the
       metric held still.
     - Where both batches ran the same agent config version, the prompt region
       states that the prompt is unchanged and renders NO diff body. The server
       answers `same_config` for exactly this, so the region never has to draw an
       empty box and call it a diff.
     - Promotion reports the agent's RESULTING version, not the promoted one.
       Version history is immutable, so promoting v6 while v7 is current produces
       v8; a UI that said "now on v6" would lie about the history it just showed.
       The number therefore comes off the mutation's RESPONSE and never off its
       input. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalComparison } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import {
  EVAL_METRIC_KEYS,
  EVAL_METRIC_LABEL_KEY,
  formatCostChange,
  formatMetricChange,
  formatMetricPercent,
} from "@/lib/eval";
import { useEvalComparison, usePromoteAgentVersion } from "@/lib/hooks/eval";
import { CHANGE_TONE_COLOR } from "../../constants";
import { changeTone, promotableVersions } from "../../helpers";
import { s } from "./styles";

/** One side-by-side card: the earlier value, the later value, and the change. */
function CompareCard({
  label,
  earlier,
  later,
  change,
}: {
  label: string;
  earlier: string;
  later: string;
  /** Already formatted with its unit, or null when nothing was measured. */
  change: string | null;
}) {
  const t = useTranslations("eval");
  const tone = changeTone(change);
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div className="tnum" style={s.cardValues}>
        <span style={s.earlier}>{earlier}</span>
        <span style={s.arrow}>→</span>
        <span style={s.later}>{later}</span>
      </div>
      <div style={s.sideLabels}>
        <span>{t("compare.earlier")}</span>
        <span>·</span>
        <span>{t("compare.later")}</span>
      </div>
      {/* "not measured" in place of the change — never a zero. */}
      <div style={s.change(CHANGE_TONE_COLOR[tone])}>
        {t("compare.change")}: {change ?? t("notMeasured")}
      </div>
    </div>
  );
}

/** The prompt region: the unchanged sentence, or the two snapshots. */
function PromptRegion({ comparison }: { comparison: EvalComparison }) {
  const t = useTranslations("eval");

  if (comparison.same_config) {
    return (
      <p style={s.unchanged}>
        {t("compare.promptUnchanged", { version: comparison.earlier_agent_version })}
      </p>
    );
  }

  return (
    <div style={s.prompts}>
      <div style={s.promptPane}>
        <div style={s.promptHead}>
          {t("compare.promptSide", { version: comparison.earlier_agent_version })}
        </div>
        <pre style={s.promptBody}>{comparison.earlier_system_prompt}</pre>
      </div>
      <div style={s.promptPane}>
        <div style={s.promptHead}>
          {t("compare.promptSide", { version: comparison.later_agent_version })}
        </div>
        <pre style={s.promptBody}>{comparison.later_system_prompt}</pre>
      </div>
    </div>
  );
}

export function CompareModal({
  agentId,
  earlierBatchId,
  laterBatchId,
  onClose,
}: {
  agentId: string;
  earlierBatchId: string;
  laterBatchId: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const comparison = useEvalComparison(earlierBatchId, laterBatchId);
  const promote = usePromoteAgentVersion();

  const data = comparison.data;

  /* The agent's RESULTING version, read off the mutation's response. Derived,
     not stored: re-reading it from `promote.data` is what keeps the sentence
     true after a second promotion, where a copy taken on the first success
     would keep naming the old number. */
  const promotedTo = promote.data?.version ?? null;

  return (
    <Modal
      width={760}
      title={t("compare.title")}
      subtitle={
        data
          ? t("compare.subtitle", {
              earlier: data.earlier_agent_version,
              later: data.later_agent_version,
            })
          : undefined
      }
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {data &&
            promotableVersions(data.earlier_agent_version, data.later_agent_version).map(
              (version) => (
                <Button
                  key={version}
                  kind="secondary"
                  icon="ArrowUp"
                  onClick={() => promote.mutate({ agentId, version })}
                  aria-disabled={promote.isPending}
                >
                  {promote.isPending
                    ? t("compare.promoting")
                    : t("compare.promote", { version })}
                </Button>
              ),
            )}
          {promotedTo != null && (
            <span style={s.promoted} role="status">
              {t("compare.promoted", { version: promotedTo })}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      {comparison.isLoading && (
        <div style={s.skeletons}>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
      )}
      {comparison.isError && (
        <ErrorState body={t("agentPage.error")} onRetry={() => void comparison.refetch()} />
      )}
      {data && (
        <div style={s.body}>
          <div style={s.cards}>
            {EVAL_METRIC_KEYS.map((key) => (
              <CompareCard
                key={key}
                label={t(EVAL_METRIC_LABEL_KEY[key])}
                earlier={formatMetricPercent(data[key].earlier)}
                later={formatMetricPercent(data[key].later)}
                change={formatMetricChange(data[key].change)}
              />
            ))}
            {/* The fourth card: currency, not a 0–1 ratio, so it takes the cost
                formatter and its change is a signed amount rather than points. */}
            <CompareCard
              label={t("compare.cost")}
              earlier={formatCost(data.cost_usd.earlier)}
              later={formatCost(data.cost_usd.later)}
              change={formatCostChange(data.cost_usd.change)}
            />
          </div>

          <div style={s.section}>
            <div style={s.cardLabel}>{t("compare.promptHeading")}</div>
            <div style={s.sectionBody}>
              <PromptRegion comparison={data} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default CompareModal;
