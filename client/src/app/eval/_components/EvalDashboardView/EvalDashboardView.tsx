/* /eval — the workspace eval dashboard.

   Two regions over ONE read: `useEvalDashboard` returns the per-agent rows and
   the cross-agent recent batches together, so both regions share a loading and
   an error state and neither can be in flight while the other is not. That is
   why the skeletons and the inline error live inside the regions rather than as
   one early return — the shell, the sidebar and the breadcrumb stay rendered
   either way, which is the requirement a segment-level `error.tsx` cannot meet
   because it replaces the segment (and this repo deliberately has none).

   Two things this screen must not do, both of them load-bearing:

     - NO agent is ever omitted. A disabled agent and an agent that has never
       run a batch both appear, with null metrics and an empty trend, because
       omitting them leaves a reader unable to tell a disabled agent from a
       missing one. A row whose agent has since been DELETED also stays, and is
       presented as unavailable rather than removed.
     - A null metric renders `—` and a null change renders "not measured", never
       a zero. "We could not measure recall" and "recall is 0%" are different
       claims, and the contract makes every metric nullable precisely so they
       stay distinguishable this far down.

   The period filter is LOCAL state and not a URL search param, deliberately:
   `/eval` has no dynamic segment, so it is a statically prerenderable route, and
   `useSearchParams()` on one forces a client-side-rendering bailout that only a
   <Suspense> boundary silences — and a boundary here would make the server emit
   the fallback instead of the screen (`client/INSIGHTS.md`, 2026-08-04). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  SelectInput,
  Skeleton,
  Sparkline,
} from "@devdigest/ui";
import type { EvalBatch, EvalDashboardRow, EvalPeriod } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { formatAge, formatCost } from "@/lib/format";
import {
  DEFAULT_EVAL_PERIOD,
  EVAL_METRIC_KEYS,
  EVAL_PERIODS,
  formatCaseCounts,
  formatMetricPercent,
} from "@/lib/eval";
import { useEvalDashboard, useRunAllEvalBatches } from "@/lib/hooks/eval";
import {
  AGENT_COLUMN_KEYS,
  AGENT_GRID,
  RUNS_COLUMN_KEYS,
  RUNS_GRID,
  SKELETON_ROW_KEYS,
  SPARKLINE_COLOR,
  SPARKLINE_TESTID,
} from "./constants";
import { isNavigable, skipNotices, sparklineSeries } from "./helpers";
import { s } from "./styles";

/** The period filter. A real `<select>`, so it is keyboard-operable as it is. */
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

/** A table header row, from a list of catalogue keys plus one unlabelled track. */
function HeadRow({ grid, keys, trailing }: { grid: string; keys: readonly string[]; trailing?: boolean }) {
  const t = useTranslations("eval");
  return (
    <div style={s.headRow(grid)}>
      {keys.map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
      {trailing && <span />}
    </div>
  );
}

/**
 * One agent's row.
 *
 * A real `<button>` when the agent still exists — tab-reachable, with the
 * accessible name the catalogue gives it (`Open the eval history for {name}`) —
 * so activating it navigates to that agent's eval page. A row whose agent has
 * been deleted renders the same cells inside a plain `<div>`: it is still
 * readable history, and there is no page to go to.
 */
function AgentRow({ row }: { row: EvalDashboardRow }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const [hover, setHover] = React.useState(false);

  const last = row.last_batch;
  const series = sparklineSeries(row);
  const navigable = isNavigable(row);
  const name = row.agent_name;

  const cells = (
    <>
      {name ? (
        <span style={s.name}>{name}</span>
      ) : (
        <span style={s.unavailable}>{t("agentUnavailable")}</span>
      )}
      <Badge mono style={s.modelChip}>
        {row.model}
      </Badge>
      <span className="tnum" style={s.cell}>
        {last ? `v${last.agent_version}` : "—"}
      </span>
      {/* A row with no completed batch says so in words, not with a blank. */}
      <span style={s.mutedCell}>
        {last ? formatAge(last.started_at) : t("dashboard.rowNoBatch")}
      </span>
      <span className="tnum" style={s.metricCell}>
        {formatCaseCounts(last?.cases_passed, last?.cases_covered)}
      </span>
      {EVAL_METRIC_KEYS.map((key) => (
        <span key={key} className="tnum" style={s.metricCell}>
          {formatMetricPercent(last?.[key])}
        </span>
      ))}
      {/* Omitted entirely below two completed batches — a one-point sparkline is
          a dot on an empty grid, which reads as a bug. */}
      <span style={s.trendCell}>
        {series && (
          <span data-testid={SPARKLINE_TESTID} aria-hidden="true">
            <Sparkline data={series} color={SPARKLINE_COLOR} w={56} h={20} />
          </span>
        )}
      </span>
    </>
  );

  if (!navigable) {
    return <div style={s.row(false, false)}>{cells}</div>;
  }

  return (
    <button
      type="button"
      aria-label={t("dashboard.openAgent", { name: name ?? row.agent_id })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => router.push(`/eval/${row.agent_id}`)}
      style={s.row(true, hover)}
    >
      {cells}
    </button>
  );
}

/** One batch's row in the cross-agent recent-runs table. */
function RunRow({ batch }: { batch: EvalBatch }) {
  const t = useTranslations("eval");
  return (
    <div style={s.runRow}>
      {batch.agent_name ? (
        <span style={s.name}>{batch.agent_name}</span>
      ) : (
        <span style={s.unavailable}>{t("agentUnavailable")}</span>
      )}
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

/** Skeletons shaped like the rows that are coming, inside the real table frame. */
function TableSkeleton() {
  return (
    <div style={s.skeletonRows}>
      {SKELETON_ROW_KEYS.map((key) => (
        <Skeleton key={key} height={42} />
      ))}
    </div>
  );
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const [period, setPeriod] = React.useState<EvalPeriod>(DEFAULT_EVAL_PERIOD);
  const dashboard = useEvalDashboard(period);
  const runAll = useRunAllEvalBatches();

  const rows = dashboard.data?.rows ?? [];
  const recent = dashboard.data?.recent_batches ?? [];
  /* Derived from the mutation's own result, never mirrored into state: a skip is
     a fact about the last run-all, and copying it would keep reporting a skip
     after the agent has been fixed and the dashboard refetched. */
  const skips = skipNotices(runAll.data, rows);

  return (
    <AppShell
      crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}
    >
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("evalsTab.mechanicalScoring")}</p>
          </div>
          <PeriodFilter period={period} onChange={setPeriod} />
          <Button
            kind="primary"
            icon="Play"
            onClick={() => runAll.mutate()}
            aria-disabled={runAll.isPending}
          >
            {runAll.isPending ? t("dashboard.runAllAgentsRunning") : t("dashboard.runAllAgents")}
          </Button>
        </div>

        {skips.map((skip) => (
          <p key={skip.agentId} style={s.notice}>
            <Icon.Info size={13} />
            {t("dashboard.skipped", {
              name: skip.name,
              reason: t(`dashboard.skipReason.${skip.reason}`),
            })}
          </p>
        ))}

        <section style={s.section} aria-label={t("dashboard.agentsHeading")}>
          <SectionLabel icon="Cpu">{t("dashboard.agentsHeading")}</SectionLabel>
          {dashboard.isLoading && <TableSkeleton />}
          {dashboard.isError && (
            <ErrorState body={t("dashboard.error")} onRetry={() => void dashboard.refetch()} />
          )}
          {!dashboard.isLoading && !dashboard.isError && rows.length === 0 && (
            <EmptyState
              icon="FlaskConical"
              title={t("evalsTab.emptyCasesTitle")}
              body={t("evalsTab.emptyCasesBody")}
            />
          )}
          {!dashboard.isLoading && !dashboard.isError && rows.length > 0 && (
            <div style={s.table}>
              <HeadRow grid={AGENT_GRID} keys={AGENT_COLUMN_KEYS} trailing />
              {rows.map((row) => (
                <AgentRow key={row.agent_id ?? `batch-agent:${row.agent_name ?? row.model}`} row={row} />
              ))}
            </div>
          )}
        </section>

        <section style={s.section} aria-label={t("dashboard.recentRuns")}>
          <SectionLabel icon="Activity">{t("dashboard.recentRuns")}</SectionLabel>
          {dashboard.isLoading && <TableSkeleton />}
          {!dashboard.isLoading && !dashboard.isError && recent.length === 0 && (
            <p style={s.notice}>{t("dashboard.noRuns")}</p>
          )}
          {!dashboard.isLoading && !dashboard.isError && recent.length > 0 && (
            <div style={s.table}>
              <HeadRow grid={RUNS_GRID} keys={RUNS_COLUMN_KEYS} />
              {recent.map((batch) => (
                <RunRow key={batch.id} batch={batch} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export default EvalDashboardView;
