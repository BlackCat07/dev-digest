/* Evals tab — the agent's eval set, and the numbers its last batch produced.

   Three regions, and they fail independently: a dashboard read that errors must
   not take the case list down with it, so each renders its own skeletons while
   in flight and its own inline error when it fails. That is why the loading and
   error branches sit inside `MetricsRegion` / `CasesRegion` as early returns
   rather than as one early return at the top of this file.

   THREE case-count denominators appear on this screen and they are allowed to
   disagree:

     - the CASES PASSED tile reads `cases_passed` over `cases_covered` of the
       most recent COMPLETED batch;
     - the `N / M passing` chip beside the heading reads THE SAME pair, so the
       tile and the chip can never disagree — it is deliberately not
       `cases.filter(passed).length`, which would count rows the last batch never
       covered;
     - the second chip beside the heading reads the SET's current size.

   The gap is meaningful — a case added after that batch ran is in the set and
   was never covered by it — so `formatCaseCounts` is used for the first two and
   the set length for the third, and neither is ever substituted for the other.

   Every metric change is rendered from `formatMetricChange` in `src/lib/eval.ts`
   and never by this unit: a change in a metric shown as `82%` reads `+4pt`, not
   `0.04`. Note that `MetricCard`'s own `delta` prop is deliberately left UNSET —
   the vendored primitive draws it as `Math.abs(delta).toFixed(2)` with an arrow
   and no unit, which is precisely the convention this feature must not ship, and
   `client/src/vendor/ui/` is not ours to give a prop to. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconBtn,
  ProgressBar,
  SectionLabel,
  SeverityBadge,
  CategoryTag,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, EvalAgentCase } from "@devdigest/shared";
import {
  EVAL_EXPECTATION_BADGE,
  EVAL_METRIC_COLOR,
  formatCaseCounts,
  formatMetricChange,
  formatMetricPercent,
} from "@/lib/eval";
import {
  useAgentEvalBatches,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useEvalBatch,
  useEvalBatchEvents,
  useStartEvalBatch,
} from "@/lib/hooks/eval";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import {
  CASES_TILE_LABEL_KEY,
  CHANGE_TONE_COLOR,
  EVAL_DASHBOARD_HREF,
  METRIC_TILE_LABEL_KEY,
  ROW_STATUS_STYLE,
  SKELETON_ROW_KEYS,
} from "./constants";
import {
  batchRefusalKey,
  categoryChip,
  changeTone,
  completedCaseCount,
  metricTiles,
  progressPercent,
  resultsByCaseId,
  rowStatus,
  severityChip,
  type MetricTileFigures,
} from "./helpers";
import { s } from "./styles";

/**
 * The metrics section's label, with the dashboard link on the right.
 *
 * This is the screen's ONLY link to the dashboard. It used to sit beside the
 * mechanical-scoring note, with a one-line subtitle here instead; a subtitle that
 * restates the three captions directly beneath it is not information, and the
 * link is what a reader actually reaches for. Do not restore the second one —
 * two links with the same accessible name is also a broken query.
 */
function MetricsLabel() {
  const t = useTranslations("eval");
  return (
    <SectionLabel
      icon="Gauge"
      right={
        <Link href={EVAL_DASHBOARD_HREF} style={s.link}>
          {t("evalsTab.dashboardLink")}
        </Link>
      }
    >
      {t("evalsTab.metricsTitle")}
    </SectionLabel>
  );
}

/**
 * One metric tile: the caption, the value in its metric's colour, and the signed
 * change beside it.
 *
 * The change is composed here rather than handed to a primitive, for the reason
 * `styles.ts` gives on `tileChange`: the vendored `MetricCard` renders a delta as
 * an unsigned `0.02` with an arrow and no unit, and this feature's whole claim is
 * that a prompt edit moved recall by FOUR POINTS. `formatMetricChange` is the one
 * place that sentence is formatted.
 */
function MetricTile({ tile }: { tile: MetricTileFigures }) {
  const t = useTranslations("eval");
  const change = formatMetricChange(tile.change);
  const tone = changeTone(change);
  return (
    <div style={s.tile}>
      <span style={s.tileLabel}>{t(METRIC_TILE_LABEL_KEY[tile.key])}</span>
      <div style={s.tileValueRow}>
        <span className="tnum" style={s.tileValue(EVAL_METRIC_COLOR[tile.key])}>
          {formatMetricPercent(tile.value)}
        </span>
        <span style={s.tileChange(CHANGE_TONE_COLOR[tone])}>
          {change ?? t("notMeasured")}
        </span>
      </div>
    </div>
  );
}

/**
 * The four tiles, the mechanical-scoring statement and the dashboard link.
 *
 * Takes the query rather than its data, so the three states live next to each
 * other in one place instead of being threaded down as booleans.
 */
function MetricsRegion({ query }: { query: ReturnType<typeof useAgentEvalDashboard> }) {
  const t = useTranslations("eval");

  if (query.isLoading) {
    return (
      <section aria-label={t("evalsTab.metricsTitle")}>
        <MetricsLabel />
        <div style={s.tiles}>
          {/* Shaped like the tiles that are coming — the vendored Skeleton is a
              bare `div.skeleton` with no role, so it is found by class. */}
          <Skeleton height={78} />
          <Skeleton height={78} />
          <Skeleton height={78} />
          <Skeleton height={78} />
        </div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section aria-label={t("evalsTab.metricsTitle")}>
        <MetricsLabel />
        <ErrorState body={t("dashboard.error")} onRetry={() => void query.refetch()} />
      </section>
    );
  }

  const row = query.data ?? null;
  const last = row?.last_batch ?? null;
  return (
    <section aria-label={t("evalsTab.metricsTitle")}>
      <MetricsLabel />
      <div style={s.tiles}>
        {metricTiles(row).map((tile) => (
          <MetricTile key={tile.key} tile={tile} />
        ))}
        {/* The pass ratio, from the SAME batch as the three metrics beside it,
            and never over the set's current size. No change line: a ratio of two
            counts has no unit a signed delta could carry — which is also why it
            takes no hue, unlike the three percentages. */}
        <div style={s.tile}>
          <span style={s.tileLabel}>{t(CASES_TILE_LABEL_KEY)}</span>
          <div style={s.tileValueRow}>
            <span className="tnum" style={s.tileValue()}>
              {formatCaseCounts(last?.cases_passed, last?.cases_covered)}
            </span>
          </div>
        </div>
      </div>
      <div style={s.note}>
        <Icon.Code size={13} style={s.noteIcon} aria-hidden />
        <span style={s.noteText}>{t("evalsTab.mechanicalScoring")}</span>
      </div>
    </section>
  );
}

/**
 * One case row: a leading outcome mark, two lines, then the chips and controls.
 *
 * The outcome is stated ONCE. A green tick with `passed` printed beside it said
 * the same thing twice, so for `passed` and `failed` the mark is the whole
 * statement — and it is not colour-only, because it carries the word as its
 * accessible name. The two states an icon genuinely cannot express are still
 * spelled out: `never run` and `not run` are different sentences, the second
 * names a reason, and neither may be mistaken for a failure — nothing was
 * measured, rather than measured and wrong.
 */
function CaseRow({
  evalCase,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalAgentCase;
  onRun: (caseId: string) => void;
  onEdit: (caseId: string) => void;
  onDelete: (evalCase: EvalAgentCase) => void;
}) {
  const t = useTranslations("eval");
  const badge = EVAL_EXPECTATION_BADGE[evalCase.expectation];
  const status = rowStatus(evalCase);
  const look = ROW_STATUS_STYLE[status.kind];
  const StatusIcon = Icon[look.icon];
  /* `not run` names its reason and is NOT the failure icon: nothing was
     measured, rather than measured and wrong. */
  const statusLabel =
    status.kind === "not_run" && status.reason
      ? t("evalsTab.notRunWithReason", { reason: t(`notRunReason.${status.reason}`) })
      : t(look.labelKey);
  /* `passed` and `failed` are what the leading mark already says; `never` and
     `not_run` are not, and one of them carries a reason. */
  const showStatusWord = status.kind === "never" || status.kind === "not_run";
  const last = evalCase.last_execution;
  /* Both null for a case created before the snapshot columns existed, and for one
     whose severity the findings table never held in a shape the badge knows.
     Guarded rather than cast — `SeverityBadge` throws on an unknown value. */
  const severity = severityChip(evalCase.source_severity);
  const category = categoryChip(evalCase.source_category);

  return (
    <li style={s.row}>
      {/* Exactly ONE of the two carries the outcome to a screen reader, and which
          one flips with `showStatusWord`. Where the word is not drawn the mark is
          named, so `passed` is never colour-only; where the word IS drawn the mark
          is hidden, so the row is not announced twice. */}
      <span
        style={s.rowMark(look.color)}
        role={showStatusWord ? undefined : "img"}
        aria-label={showStatusWord ? undefined : statusLabel}
        aria-hidden={showStatusWord || undefined}
      >
        <StatusIcon size={14} />
      </span>

      <div style={s.rowMain}>
        <div style={s.rowTitleRow}>
          <span style={s.name}>{evalCase.name}</span>
          <Badge color={badge.color} bg={badge.bg} icon={badge.icon} style={s.rowBadge}>
            {t(badge.labelKey)}
          </Badge>
        </div>
        <div style={s.rowMeta}>
          {last && (
            <span className="tnum" style={s.counts}>
              {t("evalsTab.counts", {
                expected: last.expected_count ?? "—",
                actual: last.actual_count ?? "—",
              })}
            </span>
          )}
          {/* A negative case asserts an empty result at its anchor, which is a
              statement about the expectation and belongs beside the counts. */}
          {evalCase.expectation === "must_not_flag" && (
            <span style={s.assertEmpty}>{t("expectation.assertEmpty")}</span>
          )}
        </div>
      </div>

      <div style={s.rowRight}>
        {/* What the finding WAS, snapshotted when the case was derived.
            NOT `compact`: that variant renders `{compact ? null : s.label}`, i.e.
            the icon alone, which would make severity colour-and-glyph only. Both
            primitives carry their own word here, which is the requirement. */}
        {(severity || category) && (
          <span style={s.chips}>
            {severity && <SeverityBadge severity={severity} />}
            {category && <CategoryTag category={category} />}
          </span>
        )}
        {/* Only where the word is not a second reading of the mark beside it —
            see `styles.ts` on `status`. */}
        {showStatusWord && <span style={s.status(look.color)}>{statusLabel}</span>}
        <div style={s.rowActions}>
          <IconBtn
            icon="Play"
            label={t("evalsTab.runRow", { name: evalCase.name })}
            onClick={() => onRun(evalCase.id)}
            size={26}
          />
          {/* `Edit`, the alias `icons.tsx` exposes for lucide's Pencil — the
              union is keyed on the exported names, and `Pencil` is not one. */}
          <IconBtn
            icon="Edit"
            label={t("evalsTab.editRow", { name: evalCase.name })}
            onClick={() => onEdit(evalCase.id)}
            size={26}
          />
          <IconBtn
            icon="Trash"
            label={t("evalsTab.deleteRow", { name: evalCase.name })}
            onClick={() => onDelete(evalCase)}
            size={26}
            danger
          />
        </div>
      </div>
    </li>
  );
}

/**
 * The case set: heading, the set-size chip, the run-all control (or the live
 * progress that replaces it), and the rows.
 *
 * Owns its own writes and its own batch subscription because it is the only
 * region that renders either — state pushed down to where it is used.
 */
function CasesRegion({
  agent,
  query,
  passRatio,
  onEdit,
}: {
  agent: Agent;
  query: ReturnType<typeof useAgentEvalCases>;
  /**
   * The last COMPLETED batch's `passed / covered`, already formatted, or null
   * when no batch has completed. Passed in rather than re-read here so this chip
   * and the CASES PASSED tile can only ever show the same pair — see the note at
   * the top of this file about the three denominators.
   */
  passRatio: string | null;
  onEdit: (caseId: string) => void;
}) {
  const t = useTranslations("eval");
  const tFinding = useTranslations("prReview");
  const batches = useAgentEvalBatches(agent.id);
  const startBatch = useStartEvalBatch();
  const deleteCase = useDeleteEvalCase();

  const cases = query.data ?? [];

  /* Whether a batch of this agent is running, DERIVED and never stored. The
     history list is the source of truth once it has refetched; before that the
     acknowledgement from the start mutation is, which is what makes progress
     appear on the click rather than a poll later. Looking the acknowledged batch
     up in the list is what stops it from being reported as running forever after
     it completes. */
  const batchList = batches.data ?? [];
  const started = startBatch.data ?? null;
  const startedLive = started
    ? (batchList.find((b) => b.id === started.id) ?? started)
    : null;
  const runningBatch =
    batchList.find((b) => b.status === "running") ??
    (startedLive?.status === "running" ? startedLive : null);

  const progress = useEvalBatchEvents(runningBatch?.id ?? null);
  const done = completedCaseCount(progress.events);

  /* The server's `code`, not a sentence: the nine refusal messages live in the
     `prReview` catalogue, which is where the finding card already reads them
     from, so a refusal is phrased in exactly one place. */
  const refusalKey = batchRefusalKey(startBatch.error);

  const runAll = () => {
    if (cases.length === 0) return;
    startBatch.mutate({ agentId: agent.id });
  };

  const runOne = (caseId: string) => startBatch.mutate({ agentId: agent.id, caseId });

  const remove = (evalCase: EvalAgentCase) => {
    if (!window.confirm(t("evalsTab.deleteConfirm", { name: evalCase.name }))) return;
    deleteCase.mutate({ caseId: evalCase.id, agentId: agent.id });
  };

  return (
    <section aria-label={t("evalsTab.casesHeading")}>
      <div style={s.listHeader}>
        <span style={s.heading}>{t("evalsTab.casesHeading")}</span>
        {/* How the last completed batch went, in the batch's OWN denominator.
            Absent until a batch completes: `0 / 0 passing` on a set that has
            simply never run is a claim, and the empty state already says it. */}
        {passRatio && (
          <Badge style={s.passingBadge}>
            {t("evalsTab.passingBadge", { ratio: passRatio })}
          </Badge>
        )}
        {/* The SET's current size — a third figure, and not a denominator for
            either the tile or the chip beside it. */}
        <Badge style={s.rowBadge}>{t("evalsTab.casesCount", { count: cases.length })}</Badge>
        <div style={s.headerRight}>
          {runningBatch ? (
            <div style={s.progress}>
              <span style={s.progressLabel} aria-live="polite">
                <Icon.RefreshCw size={12} />
                {t("evalsTab.progress", { done, total: cases.length })}
              </span>
              <ProgressBar value={progressPercent(done, cases.length)} />
            </div>
          ) : (
            <Button
              kind="secondary"
              icon="Play"
              onClick={runAll}
              aria-disabled={cases.length === 0 || startBatch.isPending}
              aria-label={cases.length === 0 ? t("evalsTab.runAllDisabledNoCases") : undefined}
            >
              {startBatch.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
            </Button>
          )}
        </div>
      </div>

      {refusalKey && (
        <div style={s.refusal} role="alert">
          <Icon.AlertTriangle size={13} />
          {tFinding(refusalKey)}
        </div>
      )}

      <CaseListBody
        query={query}
        cases={cases}
        onRun={runOne}
        onEdit={onEdit}
        onDelete={remove}
      />
    </section>
  );
}

/** The list itself: skeletons, an inline error, the empty state, or the rows. */
function CaseListBody({
  query,
  cases,
  onRun,
  onEdit,
  onDelete,
}: {
  query: ReturnType<typeof useAgentEvalCases>;
  cases: readonly EvalAgentCase[];
  onRun: (caseId: string) => void;
  onEdit: (caseId: string) => void;
  onDelete: (evalCase: EvalAgentCase) => void;
}) {
  const t = useTranslations("eval");

  if (query.isLoading) {
    return (
      <div style={s.skeletonRows}>
        {SKELETON_ROW_KEYS.map((key) => (
          <Skeleton key={key} height={42} />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return <ErrorState body={t("evalsTab.loadError")} onRetry={() => void query.refetch()} />;
  }

  if (cases.length === 0) {
    return (
      <EmptyState
        icon="FlaskConical"
        title={t("evalsTab.emptyCasesTitle")}
        body={t("evalsTab.emptyCasesBody")}
      />
    );
  }

  return (
    <ul style={s.list}>
      {cases.map((evalCase) => (
        <CaseRow
          key={evalCase.id}
          evalCase={evalCase}
          onRun={onRun}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const dashboard = useAgentEvalDashboard(agent.id);
  const cases = useAgentEvalCases(agent.id);
  const [editingCaseId, setEditingCaseId] = React.useState<string | null>(null);

  /* The case being edited is DERIVED from the set by id, not copied into state:
     a save invalidates the set, and a mirrored copy would keep showing the row
     as it looked before the write landed. */
  const editing = (cases.data ?? []).find((c) => c.id === editingCaseId) ?? null;

  /* Only fetched while the editor is open, and only to answer one question the
     case list cannot: the DURATION and the COST of this case's last execution,
     which live on the batch's own per-case rows and nowhere else. */
  const lastBatchId = dashboard.data?.last_batch?.batch_id ?? null;
  const lastBatch = useEvalBatch(editing ? lastBatchId : null);

  /* The same two counts the CASES PASSED tile renders, formatted once here and
     handed to both regions — the chip beside the case list must not be able to
     disagree with the tile above it. Null until a batch has completed. */
  const completed = dashboard.data?.last_batch ?? null;
  const passRatio = completed
    ? formatCaseCounts(completed.cases_passed, completed.cases_covered)
    : null;

  return (
    <div style={s.wrap}>
      <MetricsRegion query={dashboard} />
      <CasesRegion
        agent={agent}
        query={cases}
        passRatio={passRatio}
        onEdit={setEditingCaseId}
      />
      {editing && (
        <CaseEditorModal
          key={editing.id}
          evalCase={editing}
          agentId={agent.id}
          batchResult={resultsByCaseId(lastBatch.data?.cases).get(editing.id) ?? null}
          onClose={() => setEditingCaseId(null)}
        />
      )}
    </div>
  );
}

export default EvalsTab;
