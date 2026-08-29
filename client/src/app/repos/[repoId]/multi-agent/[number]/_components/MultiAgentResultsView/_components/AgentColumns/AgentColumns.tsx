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
import { CircularScore, Icon, SEV } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { formatCost, formatDurationSeconds } from "@/lib/format";
import { RunStatusBadge } from "../RunStatusBadge";
import { FindingCategoryTag } from "../FindingCategoryTag";
import { s } from "./styles";

/**
 * The head's one metric line — `"8.2s · $0.060"`, or the cost alone when the
 * run recorded no duration.
 *
 * Both figures on one mono line rather than two labelled blocks: at 281px the
 * column head has room for the agent's name, its outcome and its gauge, and a
 * pair of uppercase "COST" / "SCORE" labels spends that room on words the
 * numbers already imply. `formatDurationSeconds` returns `null` rather than
 * `"0.0s"` for an absent figure, which is why the duration is the optional half.
 */
function headMetrics(column: AgentColumn): string {
  const duration = formatDurationSeconds(column.duration_ms);
  const cost = formatCost(column.cost_usd);
  return duration ? `${duration} · ${cost}` : cost;
}

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
        <div style={s.headText}>
          <div style={s.headTop}>
            <span style={s.agentName}>{column.agent_name}</span>
            {/* `done` is the ONE status that carries no chip: the score ring
                beside it already says the run finished, and the reference draws
                no chip at all. Every other status keeps its word — AC-67 needs
                a running column to read "running", and AC-68 needs a failed one
                to state its outcome. Dropping the badge outright would fail
                both. */}
            {column.status !== "done" && <RunStatusBadge status={column.status} />}
          </div>
          <span className="mono tnum" style={s.headMetrics}>
            {headMetrics(column)}
          </span>
          {/* AC-68's sentence stays under the figures, on the left, where it has
              room to wrap — it is prose, not a figure, and the right-hand slot
              is sized for a 32px ring. */}
          <RunReason column={column} />
        </div>

        <HeadScore column={column} />
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
        {/* Present and operable whatever the status (AC-94): a failed run's log
            is the one a reader needs most, and a running run's is the only
            thing there is to read. The drawer decides which tab to land on. */}
        <button
          type="button"
          className="mono"
          style={s.trace}
          onClick={() => onOpenTrace(column.run_id)}
        >
          {t("results.viewTrace")}
        </button>
        <span style={s.count}>
          {t("column.findingsCount", { count: column.findings.length })}
        </span>
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
function RunReason({ column }: { column: AgentColumn }) {
  const settledBadly = column.status === "failed" || column.status === "cancelled";
  if (!settledBadly) return null;
  const reason = column.error ?? column.summary;
  return reason ? <p style={s.reason}>{reason}</p> : null;
}

/**
 * The right-hand half of the head: the score, spanning both of the left half's
 * lines. A run that settled badly has none — its account is the status word and
 * the reason on the left — so this renders nothing rather than an empty ring.
 */
function HeadScore({ column }: { column: AgentColumn }) {
  const t = useTranslations("runs");
  const settledBadly = column.status === "failed" || column.status === "cancelled";
  if (settledBadly) return null;

  if (column.score == null) {
    return <span style={s.noScore}>{t("results.noScore")}</span>;
  }

  return <CircularScore score={column.score} size={32} stroke={3} />;
}

/**
 * Severity as a bare 12px glyph in the severity colour — the design's finding
 * row carries no severity WORD, only the icon, the title and the location.
 * The category tag stays: AC-63 requires each column row to carry it, and an
 * approved acceptance criterion outranks the reference export, which omits it.
 *
 * The glyph is `role="img"` with the severity's own label as its accessible
 * name, so the word is still there for a screen reader; colour and shape are
 * the visual carrier, and the name is the non-visual one. `SeverityBadge`
 * cannot be used here even with `compact`: that variant drops the label
 * entirely (`client/INSIGHTS.md`, 2026-08-24), which would leave colour alone.
 */
function SeverityIcon({ severity }: { severity: AgentColumnFinding["severity"] }) {
  const sev = SEV[severity];
  const Glyph = Icon[sev.icon];
  return <Glyph size={12} color={sev.c} role="img" aria-label={sev.label} />;
}

/** One finding of one column: severity, title, category and file:line (AC-63). */
function ColumnFindingRow({ finding }: { finding: AgentColumnFinding }) {
  return (
    <article style={s.finding(SEV[finding.severity].c)}>
      <div style={s.findingTop}>
        <SeverityIcon severity={finding.severity} />
        <span style={s.findingTitle}>{finding.title}</span>
        <FindingCategoryTag category={finding.category} />
      </div>
      <span className="mono" style={s.findingLocation}>
        {finding.file}:{finding.start_line}
      </span>
    </article>
  );
}

export default AgentColumns;
