/* /eval/:agentId — one agent's eval history.

   Three regions, and they fail independently: the metric cards and the trend
   come from the agent's dashboard read, the recent-runs table from its batch
   history, and a failure in one must not take the other down. That is why the
   skeletons and the inline errors live inside the regions as early returns rather
   than as one early return at the top — the sidebar and the breadcrumb stay
   rendered either way, which a segment-level `error.tsx` cannot do because it
   replaces the segment (and this repo deliberately has none).

   Four rules this screen carries:

     - The alert strip comes from the PAYLOAD's `alert` and never from a
       client-side comparison. The server decides which metric regressed and by
       how much; the client owns only the wording and the unit, which is why
       `alert.regression` is a template over a formatted change rather than a
       sentence off the wire.
     - Every metric change is rendered from `formatMetricChange` — `+4pt`, not
       `0.04`. `MetricCard`'s own `delta` prop is left UNSET on purpose: the
       vendored primitive draws it as `Math.abs(delta).toFixed(2)` with an arrow
       and no unit, which is exactly the convention this feature must not ship,
       and `vendor/ui` is not ours to give a prop to.
     - `Compare` is enabled if and only if EXACTLY two runs are selected, and in
       every disabled state — zero, one, three or more — its accessible name
       states the two-run precondition. A control that is merely greyed out tells
       a screen-reader user nothing about why.
     - A null metric renders `—` and a null change renders "not measured". Never
       a zero: "we could not measure recall" and "recall is 0%" are different
       claims.

   The period filter is LOCAL state rather than a URL search param, matching the
   workspace dashboard next door: this route is dynamic, so `useSearchParams()`
   would be free here, but one screen reading the window off the URL while its
   sibling reads it off state is a difference nobody would expect and neither
   needs. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  ErrorState,
  Icon,
  LineChart,
  MetricCard,
  SectionLabel,
  SelectInput,
  Skeleton,
  type ChartSeries,
} from "@devdigest/ui";
import type { EvalBatch, EvalPeriod } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { formatAge, formatCost } from "@/lib/format";
import {
  DEFAULT_EVAL_PERIOD,
  EVAL_METRIC_KEYS,
  EVAL_METRIC_LABEL_KEY,
  EVAL_PERIODS,
  formatCaseCounts,
  formatMetricChange,
  formatMetricPercent,
} from "@/lib/eval";
import { useAgentEvalBatches, useAgentEvalDashboard } from "@/lib/hooks/eval";
import { CompareModal } from "./_components/CompareModal";
import {
  CHANGE_TONE_COLOR,
  METRIC_CARD_LABEL_KEY,
  METRIC_COLOR,
  METRIC_LEGEND_KEY,
  RUNS_COLUMN_KEYS,
  SKELETON_ROW_KEYS,
} from "./constants";
import {
  changeTone,
  chartPoints,
  comparePair,
  hasTrend,
  metricCards,
  toggleSelection,
  type MetricCardFigures,
} from "./helpers";
import { s } from "./styles";

/** The period filter. A real `<select>`, keyboard-operable as it is. */
function PeriodFilter({
  period,
  onChange,
}: {
  period: EvalPeriod;
  onChange: (period: EvalPeriod) => void;
}) {
  const t = useTranslations("eval");
  return (
    <label style={s.headerControls}>
      <span style={s.periodLabel}>{t("period.label")}</span>
      <SelectInput
        mono={false}
        value={period}
        onChange={(v) => onChange(v as EvalPeriod)}
        options={EVAL_PERIODS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
      />
    </label>
  );
}

/**
 * One metric card: the value with its signed change on the same baseline, and the
 * sparkline the primitive draws from the trend.
 *
 * The change goes THROUGH `value` as a node rather than into `delta`, and
 * `styles.ts` explains why on `cardChange` — in short, `delta` renders an
 * unsigned `0.02` with no unit, and this screen's whole job is to say a prompt
 * edit moved recall by four points. The sparkline stays: this is the analytical
 * screen, and the agent editor's compact tab is the one that drops it.
 */
function MetricCardWithChange({ figures }: { figures: MetricCardFigures }) {
  const t = useTranslations("eval");
  const change = formatMetricChange(figures.change);
  const tone = changeTone(change);
  return (
    <div style={s.card}>
      <MetricCard
        label={t(METRIC_CARD_LABEL_KEY[figures.key])}
        value={
          <>
            {formatMetricPercent(figures.value)}
            <span style={s.cardChange(CHANGE_TONE_COLOR[tone])}>
              {change ?? t("notMeasured")}
            </span>
          </>
        }
        color={METRIC_COLOR[figures.key]}
        trend={figures.trend ?? undefined}
      />
    </div>
  );
}

/** The three cards and the metric-trend chart, from the agent's dashboard read. */
function MetricsRegion({ query }: { query: ReturnType<typeof useAgentEvalDashboard> }) {
  const t = useTranslations("eval");

  if (query.isLoading) {
    return (
      <>
        <div style={s.cards}>
          {/* Shaped like the cards that are coming — the vendored Skeleton is a
              bare `div.skeleton` with no role, so it is found by class. */}
          <Skeleton height={104} />
          <Skeleton height={104} />
          <Skeleton height={104} />
        </div>
        <div style={s.section} />
        <Skeleton height={200} />
      </>
    );
  }

  if (query.isError) {
    return <ErrorState body={t("agentPage.error")} onRetry={() => void query.refetch()} />;
  }

  const row = query.data ?? null;
  const points = chartPoints(row);
  const series: ChartSeries[] = EVAL_METRIC_KEYS.map((key) => ({
    name: t(METRIC_LEGEND_KEY[key]),
    color: METRIC_COLOR[key],
    // Non-null by construction: `chartPoints` keeps only fully measured points.
    data: points.map((p) => p[key] ?? 0),
  }));

  return (
    <>
      {row?.alert && (
        <p style={s.alert} role="status">
          <Icon.TrendingDown size={15} />
          <span>
            <span style={s.alertTitle}>{t("alert.title")}</span>
            {t("alert.regression", {
              metric: t(EVAL_METRIC_LABEL_KEY[row.alert.metric]),
              /* The unit is the client's, from the one formatter this feature
                 has. The server sent a signed number and nothing else. */
              change: formatMetricChange(row.alert.change) ?? t("notMeasured"),
            })}
          </span>
        </p>
      )}

      <section style={s.section} aria-label={t("evalsTab.metricsTitle")}>
        <div style={s.cards}>
          {metricCards(row).map((figures) => (
            <MetricCardWithChange key={figures.key} figures={figures} />
          ))}
        </div>
      </section>

      <section style={s.section} aria-label={t("agentPage.trendHeading")}>
        <SectionLabel icon="Activity">{t("agentPage.trendHeading")}</SectionLabel>
        {hasTrend(points) ? (
          <div style={s.chart}>
            {/* `ResponsiveContainer` renders at zero size under jsdom, so nothing
                asserts on the chart's internals — the named legend below is the
                accessible channel for which series is which. */}
            <LineChart series={series} h={200} />
            <div style={s.legend}>
              {EVAL_METRIC_KEYS.map((key) => (
                <span key={key} style={s.legendItem}>
                  <span style={s.legendSwatch(METRIC_COLOR[key])} />
                  {t(METRIC_LEGEND_KEY[key])}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p style={s.note}>{t("agentPage.noTrend")}</p>
        )}
      </section>
    </>
  );
}

/** One batch's row, with its selection checkbox. */
function RunRow({
  batch,
  selected,
  onToggle,
}: {
  batch: EvalBatch;
  selected: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.row(selected)}>
      {/* The selection control carries a NAME and not a visible caption: an
          unnamed checkbox is invisible to a screen reader, while the same
          sentence repeated down every row would drown the numbers the row
          exists to show. `Checkbox`'s `label` takes a node, so the name is
          supplied visually-hidden — no vendored primitive gains a prop. */}
      <Checkbox
        checked={selected}
        onChange={onToggle}
        label={<span style={s.srOnly}>{t("agentPage.selectRun")}</span>}
      />
      <span style={s.mutedCell}>{formatAge(batch.started_at)}</span>
      <span className="tnum" style={s.cell}>
        v{batch.agent_version}
      </span>
      {EVAL_METRIC_KEYS.map((key) => (
        <span key={key} className="tnum" style={s.metricCell}>
          {formatMetricPercent(batch[key])}
        </span>
      ))}
      <span className="tnum" style={s.metricCell}>
        {formatCaseCounts(batch.cases_passed, batch.cases_covered)}
      </span>
      <span className="tnum" style={s.cell}>
        {formatCost(batch.cost_usd)}
      </span>
    </div>
  );
}

/**
 * The recent-runs table, its selection, and the `Compare` control.
 *
 * The selection lives here rather than in the parent — it is used by this region
 * and by the modal this region opens, and nothing above needs it.
 */
function RunsRegion({
  agentId,
  query,
}: {
  agentId: string;
  query: ReturnType<typeof useAgentEvalBatches>;
}) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<readonly string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const batches = query.data ?? [];
  /* Derived on every render, never mirrored into state: the pair is a function
     of the selection and the rows, and a stored copy would survive a refetch
     that removed one of the two batches from the window. */
  const pair = comparePair(selected, batches);

  return (
    <section style={s.section} aria-label={t("agentPage.runsHeading")}>
      <SectionLabel
        icon="Clock"
        right={
          <div style={s.runsHeader}>
            <span style={s.selectionCount}>
              {t("agentPage.selectedRuns", { count: selected.length })}
            </span>
            <Button
              kind="secondary"
              icon="BarChart"
              onClick={() => pair && setComparing(true)}
              aria-disabled={pair === null}
              /* The precondition is in the accessible NAME in every disabled
                 state — at zero, at one and at three or more selections — and
                 not merely in a tooltip or a colour. */
              aria-label={pair === null ? t("compare.openDisabled") : undefined}
            >
              {t("compare.open")}
            </Button>
          </div>
        }
      >
        {t("agentPage.runsHeading")}
      </SectionLabel>

      {query.isLoading && (
        <div style={s.skeletonRows}>
          {SKELETON_ROW_KEYS.map((key) => (
            <Skeleton key={key} height={40} />
          ))}
        </div>
      )}
      {query.isError && (
        <ErrorState body={t("agentPage.error")} onRetry={() => void query.refetch()} />
      )}
      {!query.isLoading && !query.isError && batches.length === 0 && (
        <p style={s.note}>{t("dashboard.noRuns")}</p>
      )}
      {!query.isLoading && !query.isError && batches.length > 0 && (
        <div style={s.table}>
          <div style={s.headRow}>
            <span />
            {RUNS_COLUMN_KEYS.map((key) => (
              <span key={key}>{t(key)}</span>
            ))}
          </div>
          {batches.map((batch) => (
            <RunRow
              key={batch.id}
              batch={batch}
              selected={selected.includes(batch.id)}
              onToggle={() => setSelected((prev) => toggleSelection(prev, batch.id))}
            />
          ))}
        </div>
      )}

      {comparing && pair && (
        <CompareModal
          agentId={agentId}
          earlierBatchId={pair.earlierBatchId}
          laterBatchId={pair.laterBatchId}
          onClose={() => setComparing(false)}
        />
      )}
    </section>
  );
}

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const [period, setPeriod] = React.useState<EvalPeriod>(DEFAULT_EVAL_PERIOD);
  const dashboard = useAgentEvalDashboard(agentId, period);
  const batches = useAgentEvalBatches(agentId, period);

  const row = dashboard.data ?? null;
  /* A batch outlives its agent, so this page stays readable after the agent is
     gone — with the agent presented as unavailable rather than as a blank. */
  const name = row?.agent_name ?? t("agentUnavailable");

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard"), href: "/eval" },
        { label: name },
      ]}
    >
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{name}</h1>
            <p style={s.subtitle}>
              {row && (
                <Badge mono style={s.modelChip}>
                  {row.model}
                </Badge>
              )}
              <span>{t("evalsTab.casesCount", { count: row?.cases_total ?? 0 })}</span>
            </p>
          </div>
          <PeriodFilter period={period} onChange={setPeriod} />
        </div>

        <MetricsRegion query={dashboard} />
        <RunsRegion agentId={agentId} query={batches} />
      </div>
    </AppShell>
  );
}

export default AgentEvalView;
