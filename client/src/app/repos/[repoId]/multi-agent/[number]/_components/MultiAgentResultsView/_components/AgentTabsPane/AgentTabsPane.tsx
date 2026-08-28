/* AgentTabsPane — tabs mode: one tab per agent of the multi-run, one agent's
   findings at a time, full width (AC-71, AC-73, AC-104).

   **There is no merged tab.** A fifth tab combining four agents' findings would
   have to decide what "the same finding, found twice" means, and that decision
   is the disagreement block's — computed on the server, from the whole
   multi-run, and rendered below both modes. It is a recorded non-goal (N-3),
   not an omission.

   Three parts, and the reference design decides the shape of each:

   1. **The strip.** Each tab is the agent's name and that run's score, the
      score in its own band colour, and the active tab is underlined in the same
      colour. It is hand-rolled rather than the vendored `Tabs` because that
      primitive renders its `count` at a fixed size in `--text-muted` and takes
      no `style` prop — see the note in `styles.ts`.
   2. **The summary block.** A 44px score ring, the agent's name over the run's
      own summary sentence, and the trace control with the run's figures. It is
      what makes a tab worth switching to before any finding is read.
   3. **The finding card.** A severity rail on the left edge, the severity as a
      tinted glyph, then two lines: title + category, and file:line +
      confidence. Expanding adds the rationale, the fix and the three actions
      below a rule, inside the same card.

   The collapsed row is the seam the finding detail is built on: the expansion
   WRAPS it rather than replacing it, which is why the category tag is rendered
   here once rather than twice (AC-104). There is one finding renderer here and
   there must stay one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, Icon, SEV } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { formatCost, formatDurationSeconds } from "@/lib/format";
import { FindingCategoryTag } from "../FindingCategoryTag";
import { RunStatusBadge } from "../RunStatusBadge";
import { FindingDetail, findingRowStyles, type FindingDecision } from "./_components/FindingDetail";
import { confidenceColor, confidencePct, scoreColor } from "./helpers";
import { s } from "./styles";

/** A run that settled badly has no score and no summary worth trusting — its
    account is the status word and the reason it recorded (AC-68). */
function settledBadly(column: AgentColumn): boolean {
  return column.status === "failed" || column.status === "cancelled";
}

/** `"8.2s · $0.060"`, or the cost alone when the run recorded no duration —
    the same pair, in the same order, that columns mode puts in its head. */
function runMetrics(column: AgentColumn): string {
  const duration = formatDurationSeconds(column.duration_ms);
  const cost = formatCost(column.cost_usd);
  return duration ? `${duration} · ${cost}` : cost;
}

export function AgentTabsPane({
  columns,
  onOpenTrace,
}: {
  columns: readonly AgentColumn[];
  /** Opens that run's trace drawer by writing the `?trace=` search param. */
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  // Which tab the reader ASKED for — not which one is shown. The shown tab is
  // derived below, so a poll that removes a column (or a first render before
  // any click) cannot leave the pane pointing at nothing. Deriving rather than
  // syncing with an effect is the difference between one source of truth and
  // two that disagree for one frame.
  const [requestedRunId, setRequestedRunId] = React.useState<string | null>(null);
  const active = columns.find((c) => c.run_id === requestedRunId) ?? columns[0];

  if (!active) return null;

  return (
    <div style={s.wrap}>
      <div style={s.tabStrip}>
        {columns.map((column) => {
          const on = column.run_id === active.run_id;
          // Neutral, not a band colour, for a run with no score: an underline
          // in `--crit` under a run that simply never scored would read as a
          // failing verdict.
          const accent = scoreColor(column.score) ?? "var(--text-primary)";
          return (
            <button
              key={column.run_id}
              type="button"
              // Not `role="tab"`: the strip is a row of buttons that swap the
              // pane, and the tab/tabpanel pattern would owe arrow-key roving
              // focus it does not implement. `aria-current` states which one is
              // showing without claiming a widget this is not — and states it
              // in something other than the underline's colour (AC-88).
              aria-current={on ? "true" : undefined}
              onClick={() => setRequestedRunId(column.run_id)}
              style={s.tab(on, accent)}
            >
              <span style={s.tabLabel(on)}>{column.agent_name}</span>
              {/* The run's score rides on the tab (AC-71). Rendered only when
                  there is one: `0` is a verdict and its absence is not. */}
              {column.score != null && (
                <span className="tnum" style={s.tabScore(accent)}>
                  {column.score}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Named after the agent, for the same reason the columns are: the pane's
          `View trace` control is one of several identical ones on this screen
          across a session, and the group name is what identifies it.

          A `<section>`, not a `<div>`: the element is what scopes the `<footer>`
          below, and an unscoped one is a page-level `contentinfo` landmark. */}
      <section role="group" aria-label={active.agent_name} style={s.pane}>
        <PaneSummary column={active} onOpenTrace={onOpenTrace} />

        <div style={s.list}>
          {active.findings.length === 0 ? (
            <p style={s.noFindings}>{t("column.noFindings")}</p>
          ) : (
            active.findings.map((finding) => <FindingRow key={finding.id} finding={finding} />)
          )}
        </div>

        <footer style={s.foot}>
          {t("column.findingsCount", { count: active.findings.length })}
        </footer>
      </section>
    </div>
  );
}

/**
 * The block above the findings: what this agent concluded, and what the run
 * cost to conclude it.
 *
 * The agent's name takes the score's band colour, as the reference draws it —
 * the name is text, so nothing here is carried by colour alone (AC-88). A run
 * that has not reached a terminal status keeps its status WORD beside the name
 * (AC-67); `done` is the one status with no chip, because the ring beside it
 * already says the run finished, which is the rule columns mode follows too.
 */
function PaneSummary({
  column,
  onOpenTrace,
}: {
  column: AgentColumn;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  const bad = settledBadly(column);
  const accent = (bad ? "var(--crit)" : scoreColor(column.score)) ?? "var(--text-primary)";
  // The run's own reason first and the review's summary only after it: a run
  // that failed before it wrote a review row still recorded an `error`, and
  // that is exactly the case AC-68 is about.
  const reason = column.error ?? column.summary;

  return (
    <div style={s.summary(accent)}>
      <PaneScore column={column} />

      <div style={s.summaryText}>
        <div style={s.summaryHead}>
          <span style={s.agentName(accent)}>{column.agent_name}</span>
          {column.status !== "done" && <RunStatusBadge status={column.status} />}
        </div>
        {bad
          ? reason && <p style={s.reason}>{reason}</p>
          : column.summary && <p style={s.summaryBody}>{column.summary}</p>}
      </div>

      <div style={s.summaryAside}>
        {/* Present and operable whatever the status (AC-94): a failed run's log
            is the one a reader needs most, and a running run's is the only
            thing there is to read. */}
        <button
          type="button"
          className="mono"
          style={s.trace}
          onClick={() => onOpenTrace(column.run_id)}
        >
          {t("results.viewTrace")}
        </button>
        <span className="mono tnum" style={s.metrics}>
          {runMetrics(column)}
        </span>
      </div>
    </div>
  );
}

/**
 * The 44px ring, or what stands in its place.
 *
 * A run that settled badly renders nothing here — its account is the status
 * word and the reason on the left (AC-68), and an empty gauge beside them would
 * read as a score of zero. A run that settled with no score at all says so in
 * words, for the same reason.
 */
function PaneScore({ column }: { column: AgentColumn }) {
  const t = useTranslations("runs");
  if (settledBadly(column)) return null;
  if (column.score == null) return <span style={s.noScore}>{t("results.noScore")}</span>;
  return <CircularScore score={column.score} />;
}

/**
 * Severity as a tinted glyph, per the reference: the severity's colour on its
 * own 12%-tint chip, and no word beside it.
 *
 * The word is still there — `role="img"` with the severity's label as the
 * accessible name — which is how AC-88 is met without a chip wide enough to
 * spell "SUGGESTION" beside every title. This is the same treatment columns
 * mode already ships, and it is deliberately NOT `SeverityBadge compact`: that
 * variant drops the label from the accessible name too
 * (`client/INSIGHTS.md`, 2026-08-24), which would leave colour alone.
 */
function SeverityGlyph({ severity }: { severity: AgentColumnFinding["severity"] }) {
  const sev = SEV[severity];
  const Glyph = Icon[sev.icon];
  return (
    <span style={s.severityChip(sev.c, sev.bg)}>
      <Glyph size={12.5} role="img" aria-label={sev.label} />
    </span>
  );
}

/**
 * One finding: the collapsed row, and the detail it opens onto (AC-73, AC-104,
 * AC-74).
 *
 * The row is WRAPPED, not replaced. Everything inside the disclosure below is
 * the collapsed row, so the category tag and the confidence read the same
 * before and after expanding — AC-104 requires exactly that, and it is only
 * free while there is one row. The `<div>`s that hold the two lines are
 * `<span>`s because a button's content model is phrasing content;
 * `display: flex` works either way.
 */
function FindingRow({ finding }: { finding: AgentColumnFinding }) {
  const t = useTranslations("runs");
  const [expanded, setExpanded] = React.useState(false);
  /**
   * The decision recorded from THIS row, and the only state here that is not
   * derived.
   *
   * It exists because the read that produced `finding` will not run again:
   * `useMultiAgentRun` stops polling once every column is terminal, which is
   * precisely when a reader starts accepting findings, so `accepted_at` stays
   * null on the client however many times the server writes it. Keeping the
   * outcome of the press — rather than a copy of the finding — is what lets the
   * row read as decided after the panel that recorded it has been collapsed
   * away.
   */
  const [decidedHere, setDecidedHere] = React.useState<FindingDecision | null>(null);
  const accepted = finding.accepted_at != null || decidedHere === "accept";
  const dismissed = finding.dismissed_at != null || decidedHere === "dismiss";
  const pct = confidencePct(finding.confidence);

  return (
    <article style={s.finding(SEV[finding.severity].c)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        style={findingRowStyles.disclosure}
      >
        <SeverityGlyph severity={finding.severity} />

        <span style={s.findingMain}>
          <span style={s.findingTop}>
            <span style={s.findingTitle}>{finding.title}</span>
            <FindingCategoryTag category={finding.category} />
            {/* A word and a glyph, never a colour alone (AC-88): once the run
                has settled, the decision is what the reader is scanning the
                list for. */}
            {accepted && (
              <Badge icon="Check" color="var(--ok)">
                {t("detail.accepted")}
              </Badge>
            )}
            {dismissed && (
              <Badge icon="X" color="var(--text-muted)">
                {t("detail.dismissed")}
              </Badge>
            )}
          </span>

          <span style={s.findingMeta}>
            <span className="mono" style={s.findingLocation}>
              {finding.file}:{finding.start_line}
            </span>
            {/* The percentage is the statement (AC-73); the dot beside it is a
                second, redundant reading of the same number and never the only
                one. */}
            <span className="mono tnum" style={s.confidence}>
              <span style={s.confidenceDot(confidenceColor(pct))} />
              {t("detail.confidence", { pct })}
            </span>
          </span>
        </span>

        <Icon.ChevronDown size={16} style={s.chevron(expanded)} aria-hidden="true" />
      </button>

      {expanded && (
        <FindingDetail
          finding={finding}
          accepted={accepted}
          dismissed={dismissed}
          onDecided={setDecidedHere}
        />
      )}
    </article>
  );
}

export default AgentTabsPane;
