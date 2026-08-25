/* AgentTabsPane — tabs mode: one tab per agent of the multi-run, one agent's
   findings at a time, full width (AC-71, AC-73, AC-104).

   **There is no merged tab.** A fifth tab combining four agents' findings would
   have to decide what "the same finding, found twice" means, and that decision
   is the disagreement block's — computed on the server, from the whole
   multi-run, and rendered below both modes. It is a recorded non-goal (N-3),
   not an omission.

   The collapsed row below is the seam the finding detail is built on. It shows
   the severity, the CATEGORY and the confidence percentage today; the expanded
   state adds the rationale, the suggested fix and the three actions, and it
   keeps this same row above it — which is why the category tag is rendered here
   once rather than twice (AC-104). `FindingRow` was extended into an expandable
   row and the panel lives in `_components/FindingDetail`; there is still one
   finding renderer here and there must stay one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, SeverityBadge, Tabs } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { FindingCategoryTag } from "../FindingCategoryTag";
import { RunStatusBadge } from "../RunStatusBadge";
import { FindingDetail, findingRowStyles, type FindingDecision } from "./_components/FindingDetail";
import { s } from "./styles";

/** 0.82 → 82 (AC-73). Rounded, because a confidence of "81.9%" claims a
    precision the model never had. */
function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
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
      <Tabs
        pad="0 8px"
        value={active.run_id}
        onChange={setRequestedRunId}
        tabs={columns.map((column) => ({
          key: column.run_id,
          label: column.agent_name,
          // The run's score rides on the tab (AC-71). `undefined`, never 0, for
          // a run that has no score: `0` is a verdict and its absence is not.
          count: column.score ?? undefined,
        }))}
      />

      {/* Named after the agent, for the same reason the columns are: the pane's
          `View trace` control is one of several identical ones on this screen
          across a session, and the group name is what identifies it.

          A `<section>`, not a `<div>`: the element is what scopes the `<footer>`
          below, and an unscoped one is a page-level `contentinfo` landmark. */}
      <section role="group" aria-label={active.agent_name}>
        <div style={s.paneHead}>
          <RunStatusBadge status={active.status} />
          <span style={s.metric}>
            <span style={s.metricLabel}>{t("results.column.cost")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatCost(active.cost_usd)}
            </span>
          </span>
          <span style={s.headSpacer}>
            <Button
              kind="tertiary"
              size="sm"
              icon="FileText"
              onClick={() => onOpenTrace(active.run_id)}
            >
              {t("results.viewTrace")}
            </Button>
          </span>
        </div>

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
 * One finding: the collapsed row, and the detail it opens onto (AC-73, AC-104,
 * AC-74).
 *
 * The row is WRAPPED, not replaced. Everything inside the disclosure below is
 * the collapsed row exactly as it shipped, so the category tag, the severity
 * chip and the confidence read the same before and after expanding — AC-104
 * requires exactly that, and it is only free while there is one row. The
 * `<div>` that held the top line is now a `<span>` for one reason: a button's
 * content model is phrasing content, and `s.findingTop` is `display: flex`
 * either way.
 *
 * `SeverityBadge` without `compact`: the compact variant renders the icon alone
 * and drops the label (`client/INSIGHTS.md`, 2026-08-24), and nothing else on
 * this row spells the severity out.
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

  return (
    <article style={s.finding}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        style={findingRowStyles.disclosure}
      >
        <span style={s.findingTop}>
          <SeverityBadge severity={finding.severity} />
          <FindingCategoryTag category={finding.category} />
          <span className="tnum" style={s.confidence}>
            {t("detail.confidence", { pct: confidencePct(finding.confidence) })}
          </span>
          {/* A word and a glyph, never a colour alone (AC-88): once the run has
              settled, the decision is what the reader is scanning the list for. */}
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
        <span style={s.findingTitle}>{finding.title}</span>
        <span className="mono" style={s.findingLocation}>
          {finding.file}:{finding.start_line}
        </span>
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
