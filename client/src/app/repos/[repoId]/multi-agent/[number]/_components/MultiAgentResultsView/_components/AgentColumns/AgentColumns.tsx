/* AgentColumns — columns mode: one column per agent of the multi-run, read side
   by side (AC-62…AC-69).

   Three rules are easy to lose in a refactor and each is pinned by a test:

   1. **A non-terminal column says "Running" as a word** (AC-67), not as a
      spinner and not as a colour. `RunStatusBadge` is the shared unit that
      guarantees it in both modes.
   2. **A failed or cancelled column shows the reason IN PLACE OF a score**
      (AC-68) — not beside it, and not with an empty gauge. The reason is the
      column's `error`, which is the RUN's own — a run that failed before it
      wrote a review row still has one — and `summary` is the fallback for the
      older shape where the review row carried the account.
   3. **A column with no findings says so and its footer reads 0** (AC-69). An
      empty body is indistinguishable from a column that failed to render.

   The column is a `role="group"` named after its agent. That is not decoration:
   with four columns on screen there are four identical `View trace` controls,
   and the group name is what lets a reader — and a test — say WHICH one. */
"use client";

import { useTranslations } from "next-intl";
import { Button, CircularScore, SeverityBadge } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { FindingCategoryTag } from "../FindingCategoryTag";
import { RunStatusBadge } from "../RunStatusBadge";
import { s } from "./styles";

export function AgentColumns({
  columns,
  onOpenTrace,
}: {
  columns: readonly AgentColumn[];
  /** Opens that run's trace drawer by writing the `?trace=` search param. */
  onOpenTrace: (runId: string) => void;
}) {
  return (
    <div style={s.row}>
      {columns.map((column) => (
        <AgentResultColumn key={column.run_id} column={column} onOpenTrace={onOpenTrace} />
      ))}
    </div>
  );
}

function AgentResultColumn({
  column,
  onOpenTrace,
}: {
  column: AgentColumn;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");

  return (
    // A `<section>` carrying `role="group"` rather than a `<div>`: the explicit
    // role keeps four columns out of the landmark list (four `region`s would be
    // noise), while the SECTION element still scopes the `<header>` and
    // `<footer>` below, which inside a `<div>` would each become a page-level
    // `banner` / `contentinfo` landmark — four times over.
    <section role="group" aria-label={column.agent_name} style={s.column}>
      <header style={s.head}>
        <div style={s.headTop}>
          <span style={s.agentName}>{column.agent_name}</span>
          <RunStatusBadge status={column.status} />
        </div>

        <div style={s.metrics}>
          <ScoreOrReason column={column} />
          <div style={s.metric}>
            <span style={s.metricLabel}>{t("results.column.cost")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatCost(column.cost_usd)}
            </span>
          </div>
        </div>

        {/* Present and operable whatever the status (AC-94): a failed run's log
            is the one a reader needs most, and a running run's is the only
            thing there is to read. The drawer decides which tab to land on. */}
        <Button kind="tertiary" size="sm" icon="FileText" onClick={() => onOpenTrace(column.run_id)}>
          {t("results.viewTrace")}
        </Button>
      </header>

      <div style={s.body}>
        {column.findings.length === 0 ? (
          <p style={s.noFindings}>{t("column.noFindings")}</p>
        ) : (
          column.findings.map((finding) => (
            <ColumnFindingRow key={finding.id} finding={finding} />
          ))
        )}
      </div>

      <footer style={s.foot}>
        {t("column.findingsCount", { count: column.findings.length })}
      </footer>
    </section>
  );
}

/**
 * The score, or — for a failed or cancelled run — what happened instead
 * (AC-68).
 *
 * Three outcomes, and the middle one is the one that gets dropped: a run that
 * settled with no score at all is not a zero. `runs.results.noScore` says so in
 * words rather than drawing a gauge at 0, which would read as "this agent
 * scored the pull request 0 out of 100".
 *
 * The OUTCOME half of AC-68 is the status badge two lines above, which is
 * always present and always a word; this slot carries the reason and nothing
 * else. Spelling "Failed" out a second time here would put the same word twice
 * in one small header, which reads as a rendering bug rather than as emphasis.
 *
 * The reason is read from `error` FIRST and from `summary` only after it.
 * `error` is the run's own record of what went wrong and survives a run that
 * failed before it wrote a review row — which is the case the criterion is
 * about, and the one where `summary` is null. Only a run that settled badly
 * *after* writing a review has a summary at all, and then it is the fallback.
 * Neither present is still possible (a cancellation with no note), and then the
 * badge is the whole account — an empty slot rather than an invented sentence.
 */
function ScoreOrReason({ column }: { column: AgentColumn }) {
  const t = useTranslations("runs");
  const settledBadly = column.status === "failed" || column.status === "cancelled";

  if (settledBadly) {
    const reason = column.error ?? column.summary;
    return reason ? <p style={s.reason}>{reason}</p> : null;
  }

  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{t("results.column.score")}</span>
      {column.score == null ? (
        <span style={s.noScore}>{t("results.noScore")}</span>
      ) : (
        <CircularScore score={column.score} size={34} stroke={3} />
      )}
    </div>
  );
}

/**
 * One finding of one column: severity, title, category and file:line (AC-63).
 *
 * `SeverityBadge` WITHOUT `compact`. The compact variant renders the icon alone
 * and drops the label (`client/INSIGHTS.md`, 2026-08-24), and this chip is the
 * only statement of severity on the row — dropping the word would make colour
 * and glyph the sole carrier, which AC-88 forbids.
 */
function ColumnFindingRow({ finding }: { finding: AgentColumnFinding }) {
  return (
    <article style={s.finding}>
      <div style={s.findingTop}>
        <SeverityBadge severity={finding.severity} />
        <FindingCategoryTag category={finding.category} />
      </div>
      <span style={s.findingTitle}>{finding.title}</span>
      <span className="mono" style={s.findingLocation}>
        {finding.file}:{finding.start_line}
      </span>
    </article>
  );
}

export default AgentColumns;
