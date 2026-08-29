/* /ci-runs — every agent review this workspace ran inside CI.

   THREE data states, told apart rather than collapsed into one empty table
   (AC-63), and all three rendered INSIDE the section rather than as an early
   return: the shell, the sidebar and the breadcrumb stay rendered either way,
   which is the requirement a segment-level `error.tsx` cannot meet because it
   replaces the segment (and this repo deliberately has none).

     - in flight  → skeleton rows shaped like the table, inside the real frame
     - no runs    → the empty-state copy, naming the step that produces the first
     - failed     → the failure inline beside the table, with a retry

   Every status cell is a DOT plus a WORD (AC-64). Never `SeverityBadge`'s
   `compact`, which renders the icon ALONE and drops the label — turning the one
   primitive whose docstring promises "always icon + label (WCAG AA: never color
   alone)" into exactly colour-and-glyph (`client/INSIGHTS.md`, 2026-08-24). The
   word comes from `ciStatusCell`, so a fifth `CiRunStatus` member added to the
   contract is a compile error in `src/lib/ci.ts` rather than a coloured dot with
   nothing beside it.

   A run whose artifact could not be read is still a ROW here, carrying its own
   named reason — the read-back records four of them, and reporting a CI run that
   happened as a CI run that did not is the failure this screen must not have. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { ciStatusCell, isHttpUrl } from "@/lib/ci";
import { formatCost, formatDateTime } from "@/lib/format";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { NO_VALUE, RUNS_COLUMN_KEYS, RUNS_GRID, SKELETON_ROW_KEYS } from "./constants";
import { s } from "./styles";

/**
 * A run's status as a DOT plus a WORD.
 *
 * `reason` first: a run that produced no result carries the named reason the
 * read-back recorded, and that reason IS the status a reader needs. A run with
 * neither renders `—` and no dot — there is no colour to be alone with, and
 * "no outcome recorded" is not "never run".
 */
function StatusCell({ run }: { run: CiRun }) {
  const t = useTranslations("ci");
  const cell = ciStatusCell(run.reason ?? run.status);
  if (cell.kind === "never") {
    return <span style={s.mutedCell}>{NO_VALUE}</span>;
  }
  return (
    <Badge dot color={cell.color} bg="transparent">
      {cell.kind === "known" ? t(cell.labelKey) : cell.text}
    </Badge>
  );
}

/**
 * Where the run happened: `owner/name #12`, linked to the Actions job when there
 * is one.
 *
 * The protocol is checked before the anchor is rendered at all — both URLs on
 * this row arrive from the engine, and a `javascript:` URL in an `href` is script
 * execution that React does not stop.
 */
function PullRequestCell({ run }: { run: CiRun }) {
  const label =
    run.pr_number == null ? (run.repo ?? NO_VALUE) : `${run.repo ?? NO_VALUE} #${run.pr_number}`;
  if (!isHttpUrl(run.github_url)) {
    return (
      <span className="mono" style={s.prCell}>
        {label}
      </span>
    );
  }
  return (
    <span className="mono" style={s.prCell}>
      <a href={run.github_url ?? undefined} target="_blank" rel="noopener noreferrer" style={s.prLink}>
        {label}
        <Icon.ExternalLink size={12} aria-hidden />
      </a>
    </span>
  );
}

/** One run. Six cells, in the order `RUNS_COLUMN_KEYS` names them. */
function RunRow({ run }: { run: CiRun }) {
  return (
    <div style={s.row(RUNS_GRID)}>
      <span className="tnum" style={s.mutedCell}>
        {formatDateTime(run.ran_at)}
      </span>
      <PullRequestCell run={run} />
      <span style={s.cell}>{run.source ?? NO_VALUE}</span>
      <span className="tnum" style={s.cell}>
        {run.findings_count == null ? NO_VALUE : String(run.findings_count)}
      </span>
      <span className="tnum" style={s.cell}>
        {formatCost(run.cost_usd)}
      </span>
      <StatusCell run={run} />
    </div>
  );
}

/** The table's header row. */
function HeadRow() {
  const t = useTranslations("ci");
  return (
    <div style={s.headRow(RUNS_GRID)}>
      {RUNS_COLUMN_KEYS.map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
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

export function CiRunsView() {
  const t = useTranslations("ci");
  const runs = useCiRuns();
  const refresh = useRefreshCiRuns();

  /* Derived, never mirrored into state: the list belongs to the query cache, and
     a copy would keep rendering the runs the last read returned. */
  const rows = runs.data ?? [];

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={() => refresh.mutate()}
            aria-disabled={refresh.isPending}
          >
            {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>

        <section style={s.section} aria-label={t("runs.title")}>
          <div style={s.table}>
            <HeadRow />
            {runs.isLoading && <TableSkeleton />}
            {/* Inline, beside the table the failure belongs to — the sidebar,
                the breadcrumb and every nav link stay usable. */}
            {runs.isError && (
              <ErrorState body={t("runs.loadFailed")} onRetry={() => void runs.refetch()} />
            )}
            {!runs.isLoading && !runs.isError && rows.length === 0 && (
              <EmptyState icon="Play" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
            )}
            {!runs.isLoading &&
              !runs.isError &&
              rows.map((run) => <RunRow key={run.id} run={run} />)}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export default CiRunsView;
