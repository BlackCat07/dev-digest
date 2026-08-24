/* /eval — the workspace eval dashboard.

   Two regions over ONE read: `useEvalDashboard` returns the per-agent rows and
   the cross-agent recent batches together, so both regions share a loading and
   an error state and neither can be in flight while the other is not. That is
   why the skeletons and the inline error live inside the regions rather than as
   one early return — the shell, the sidebar and the breadcrumb stay rendered
   either way, which is the requirement a segment-level `error.tsx` cannot meet
   because it replaces the segment (and this repo deliberately has none).

   Two things this screen must not do, both of them load-bearing:

     - The AGENTS section lists only agents with a completed batch, and says in
       one line how many it left out. AC-45 is a statement about the READ — the
       server still returns every agent, `skipNotices` still names every agent
       `Run all agents` skipped, and an agent with cases but no batch is still
       reachable from its editor's Evals tab. What changed is presentation: a
       screen whose first four rows all read "No completed batch" buries the one
       agent that has data. The documented worry behind AC-45 — that a reader
       cannot tell a never-run agent from a missing one — is what the count line
       answers, and it is why the agents are counted rather than silently
       dropped. A card whose agent has since been DELETED still shows, presented
       as unavailable, because it has a batch and therefore history to read.
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
  ProgressBar,
  SectionLabel,
  SelectInput,
  Skeleton,
  Sparkline,
} from "@devdigest/ui";
import type { EvalBatch, EvalDashboardRow, EvalPeriod } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { formatAge, formatCost, formatDateTime } from "@/lib/format";
import {
  DEFAULT_EVAL_PERIOD,
  EVAL_METRIC_COLOR,
  EVAL_METRIC_KEYS,
  EVAL_PERIODS,
  formatCaseCounts,
  formatMetricPercent,
} from "@/lib/eval";
import { useEvalDashboard, useRunAllEvalBatches } from "@/lib/hooks/eval";
import {
  CARD_STAT_LABEL_KEY,
  RUNS_COLUMN_KEYS,
  RUNS_GRID,
  SKELETON_ROW_KEYS,
  SPARKLINE_METRIC,
  SPARKLINE_TESTID,
} from "./constants";
import { hasBatch, isNavigable, skipNotices, sparklineSeries } from "./helpers";
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

/** The recent-runs table's header row. One caller, so no `trailing` escape. */
function HeadRow({ grid, keys }: { grid: string; keys: readonly string[] }) {
  const t = useTranslations("eval");
  return (
    <div style={s.headRow(grid)}>
      {keys.map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
    </div>
  );
}

/**
 * One agent's card.
 *
 * A card and not a table row, and the trade is worth naming: a table gave every
 * agent's numbers a shared column and a heading, which a card list does not. The
 * three stat columns are therefore FIXED-width (`s.stat`), so they still line up
 * down the stack, and each carries its own caption — that is what buys back what
 * the heading row provided.
 *
 * A real `<button>` when the agent still exists — tab-reachable, with the
 * accessible name the catalogue gives it (`Open the eval history for {name}`) —
 * so activating it navigates to that agent's eval page. A card whose agent has
 * been deleted renders the same content inside a plain `<div>`: it is still
 * readable history, and there is no page to go to.
 *
 * Only reached for an agent WITH a completed batch, so `last` is non-null by
 * construction — asserted here rather than defended against, because a card
 * rendering `—` in all three columns is the thing this section stopped showing.
 */
function AgentCard({ row }: { row: EvalDashboardRow }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const [hover, setHover] = React.useState(false);

  const last = row.last_batch!;
  const series = sparklineSeries(row);
  const navigable = isNavigable(row);
  const name = row.agent_name;

  const content = (
    <>
      <span style={s.iconBox} aria-hidden>
        <Icon.Cpu size={16} />
      </span>

      <span style={s.cardMain}>
        <span style={s.cardTitleRow}>
          {name ? (
            <span style={s.name}>{name}</span>
          ) : (
            <span style={s.unavailable}>{t("agentUnavailable")}</span>
          )}
          <Badge mono style={s.modelChip}>
            {row.model}
          </Badge>
        </span>
        {/* One sentence, so it wraps as one rather than as three fragments. */}
        <span style={s.cardMeta}>
          {t("dashboard.cardLastRun", {
            version: last.agent_version,
            /* The absolute stamp, not `formatAge`: this card exists to be read
               beside the next card down, and two runs an hour apart both read
               "1h". A date and a time tell them apart. */
            ranAt: formatDateTime(last.started_at),
            pass: formatCaseCounts(last.cases_passed, last.cases_covered),
          })}
        </span>
      </span>

      {/* Omitted entirely below two completed batches — a one-point sparkline is
          a dot on an empty grid, which reads as a bug. */}
      {series && (
        <span data-testid={SPARKLINE_TESTID} aria-hidden="true">
          <Sparkline data={series} color={EVAL_METRIC_COLOR[SPARKLINE_METRIC]} w={72} h={26} />
        </span>
      )}

      <span style={s.cardStats}>
        {EVAL_METRIC_KEYS.map((key) => (
          <span key={key} style={s.stat}>
            <span style={s.statLabel}>{t(CARD_STAT_LABEL_KEY[key])}</span>
            <span className="tnum" style={s.statValue(EVAL_METRIC_COLOR[key])}>
              {formatMetricPercent(last[key])}
            </span>
          </span>
        ))}
      </span>

      {navigable && <Icon.ChevronRight size={16} style={s.chevron} aria-hidden />}
    </>
  );

  if (!navigable) {
    return <div style={s.card(false, false)}>{content}</div>;
  }

  return (
    <button
      type="button"
      aria-label={t("dashboard.openAgent", { name: name ?? row.agent_id })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => router.push(`/eval/${row.agent_id}`)}
      style={s.card(true, hover)}
    >
      {content}
    </button>
  );
}

/**
 * One batch's row in the cross-agent recent-runs table.
 *
 * Each metric is a bar AND its number. The bar carries no information the number
 * does not — it exists so a column of six runs is comparable without reading six
 * percentages — which is why it is `aria-hidden` and why the number is never
 * dropped in its favour. A null metric renders `—` and draws a bar at zero
 * width, not a bar at zero VALUE that would read as "measured, and it is 0%".
 */
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
      <span className="tnum" style={s.versionCell}>
        v{batch.agent_version}
      </span>
      {EVAL_METRIC_KEYS.map((key) => {
        const value = batch[key];
        return (
          <span key={key} style={s.barCell}>
            <span style={s.barTrack} aria-hidden="true">
              <ProgressBar
                value={value == null ? 0 : value * 100}
                color={EVAL_METRIC_COLOR[key]}
                height={6}
              />
            </span>
            <span className="tnum" style={s.barValue}>
              {formatMetricPercent(value)}
            </span>
          </span>
        );
      })}
      <span className="tnum" style={s.passCell}>
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

  /* `rows` stays the FULL list the read returned: `skipNotices` looks an agent up
     in it by id to name a skip, so filtering here would make a skipped agent that
     has never run report as an unnamed one. Only the rendered list is narrowed. */
  const rows = dashboard.data?.rows ?? [];
  const withBatch = rows.filter(hasBatch);
  const neverRun = rows.length - withBatch.length;
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
          {/* No agent has a completed batch — including the case where the
              workspace has agents but none has ever run. The empty state names
              the step that produces the first one. */}
          {!dashboard.isLoading && !dashboard.isError && withBatch.length === 0 && (
            <EmptyState
              icon="FlaskConical"
              title={t("evalsTab.emptyCasesTitle")}
              body={t("evalsTab.emptyCasesBody")}
            />
          )}
          {!dashboard.isLoading && !dashboard.isError && withBatch.length > 0 && (
            <>
              <div style={s.cards}>
                {withBatch.map((row) => (
                  <AgentCard
                    key={row.agent_id ?? `batch-agent:${row.agent_name ?? row.model}`}
                    row={row}
                  />
                ))}
              </div>
              {/* What the list is NOT showing, counted rather than dropped in
                  silence — see the note at the top of this file. */}
              {neverRun > 0 && (
                <p style={s.hiddenNote}>{t("dashboard.neverRunCount", { count: neverRun })}</p>
              )}
            </>
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
