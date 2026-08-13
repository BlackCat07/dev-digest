/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. */
"use client";

import React from "react";
import { Icon, Badge } from "@devdigest/ui";
import type { ReviewRecord, RunSummary, Verdict } from "@devdigest/shared";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner } from "../VerdictBanner";
import { RunCostBadge } from "../../../_components/RunCostBadge";
import { useDeleteReview } from "../../../../../../../lib/hooks/reviews";

const VERDICT_COLOR: Record<string, string> = {
  request_changes: "var(--crit)",
  comment: "var(--warn)",
  approve: "var(--ok)",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ReviewRunAccordion({
  review,
  run = null,
  prId,
  defaultOpen = false,
  repoFullName,
  headSha,
  targetRunId = null,
  targetNonce = 0,
  targetFindingId = null,
}: {
  review: ReviewRecord;
  /** The agent run that produced this review, joined on `run_id` by the parent.
   *  Carries the usage (tokens + cost) that `ReviewRecord` itself doesn't. */
  run?: RunSummary | null;
  prId: string;
  defaultOpen?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When this matches review.run_id, the accordion opens and scrolls into view
   *  (driven from the Timeline: clicking an agent name navigates here). */
  targetRunId?: string | null;
  targetNonce?: number;
  /** The finding `?finding=` names — set when a diff badge routed the reader here. */
  targetFindingId?: string | null;
}) {
  const findings = review.findings;
  const holdsTarget = !!targetFindingId && findings.some((f) => f.id === targetFindingId);

  /**
   * Open from the first render when this run holds the targeted finding — a LAZY
   * initial value, not an effect.
   *
   * It has to be the first render because the card below scrolls itself into view,
   * and it can only do that once it is mounted; opening from an effect would also
   * be the `react-hooks/set-state-in-effect` shape this file is already on the
   * burn-down list for. Building it at mount is safe because `FindingsTab` unmounts
   * with the tab, so arriving from the diff always constructs this state afresh.
   */
  const [open, setOpen] = React.useState(() => defaultOpen || holdsTarget);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (review.run_id && review.run_id === targetRunId) {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // targetNonce is intentionally a dependency with no use in the body: it is
    // bumped to re-trigger this effect for the same run_id.
  }, [targetRunId, targetNonce, review.run_id]);
  const del = useDeleteReview(prId);
  const blockers = findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
  const verdictColor = review.verdict ? VERDICT_COLOR[review.verdict] ?? "var(--text-muted)" : "var(--text-muted)";

  return (
    <div
      ref={rootRef}
      id={review.run_id ? `review-run-${review.run_id}` : undefined}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        marginBottom: 14,
        overflow: "hidden",
        scrollMarginTop: 16,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <Icon.Cpu size={15} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{review.agent_name ?? "Agent"}</span>
        {review.verdict && (
          <Badge color={verdictColor} bg="transparent">
            {review.verdict.replace("_", " ")}
          </Badge>
        )}
        {/* Deliberately text only — no severity counters here. The coloured
            icons live on the TIMELINE rows; this header is the textual summary.
            e2e flow 04 waits on the literal string "2 findings". */}
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {blockers > 0 ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {review.score != null && (
          <Badge mono color="var(--text-secondary)">
            {review.score}
          </Badge>
        )}
        {/* Only when the run row was joined in: a review with a null `run_id`
            (the seeded one) has no usage, and a bare "—" here would read as
            "this run was free". A run with cost_usd = null DOES show "—", which
            is the documented null-is-not-zero behaviour. */}
        {run && <RunCostBadge costUsd={run.cost_usd} />}
        <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatWhen(review.created_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete this "${review.agent_name ?? "agent"}" review run and its findings?`)) {
              del.mutate(review.id);
            }
          }}
          disabled={del.isPending}
          title="Delete this review run"
          aria-label="Delete this review run"
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
        <Icon.ChevronDown
          size={16}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--text-muted)" }}
        />
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {review.verdict && (
            <div style={{ marginBottom: 16 }}>
              <VerdictBanner
                verdict={review.verdict as Verdict}
                summary={review.summary}
                score={review.score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={review.agent_name}
                costUsd={run?.cost_usd ?? null}
                tokensIn={run?.tokens_in ?? null}
                tokensOut={run?.tokens_out ?? null}
              />
            </div>
          )}
          {/* The severity filter lives inside this panel — one chip row per run. */}
          <FindingsPanel
            findings={findings}
            prId={prId}
            repoFullName={repoFullName}
            headSha={headSha}
            targetFindingId={holdsTarget ? targetFindingId : null}
          />
        </div>
      )}
    </div>
  );
}

export default ReviewRunAccordion;
