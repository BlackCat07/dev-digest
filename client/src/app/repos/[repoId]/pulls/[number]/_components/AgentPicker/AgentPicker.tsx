/* AgentPicker — the pull-request page's run control (SPEC-05, AC-45…AC-51).

   Replaces the run-review dropdown this route used to mount. That menu offered
   "all enabled agents" or one specific agent and started a single-agent review;
   this one lets the reviewer tick an arbitrary subset, shows what each agent's
   last ten successful runs took, and fans the pull request out to exactly that
   subset in one POST.

   Mounted from `PrDetailHeader` with the same four props the dropdown took
   (`prId`, `warnMerged`, `onRunStart`, `onRunsStarted`), so `PrDetailView` needs
   no edit.

   Three things are deliberate and easy to undo by accident:

   - **Every workspace agent is listed, not only the enabled ones** (AC-46). The
     dropdown did the same, and a specific agent has always been runnable
     regardless of its `enabled` flag — that flag governs "run all", a flow this
     screen no longer offers.
   - **No estimate renders as a dash, never as `0.0s`.** `mean_duration_ms: null`
     with `sample_size: 0` means the agent has never completed a run; rounding
     that to zero would advertise an instant agent.
   - **The primary action reports `aria-disabled`, not `disabled`** (AC-48), so it
     stays focusable and a screen reader can still read the count out of its
     accessible name. The handler guards the empty selection itself. */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useStartMultiRun } from "@/lib/hooks/multi-agent";
import { formatDurationSeconds } from "@/lib/format";
import { resultsRoute } from "@/lib/multi-agent-routes";
import { AGENTS_ROUTE } from "./constants";
import { refusalReason } from "@/lib/api-errors";
import { s } from "./styles";

/** Stable empty list, so `agents` is not a new array on every render. */
const NO_AGENTS: Agent[] = [];

export interface AgentPickerProps {
  /** The pull request's row uuid — the fan-out is keyed by it, not by the number. */
  prId: string;
  /** PR is already merged/closed — dim the trigger, but still allow the run (EC-21). */
  warnMerged?: boolean;
  /** Fired the moment the fan-out is kicked off (before it completes). */
  onRunStart?: () => void;
  /** The `agent_runs` ids the fan-out created, one per selected agent. */
  onRunsStarted?: (runIds: string[]) => void;
}

export function AgentPicker({
  prId,
  warnMerged = false,
  onRunStart,
  onRunsStarted,
}: AgentPickerProps) {
  const t = useTranslations("runs");
  const router = useRouter();
  // The header is handed `pr` and `prId`, not the route segments — the results
  // route is derived from the path this component is already mounted under.
  const pathname = usePathname();
  const { data: agentData } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const start = useStartMultiRun();

  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<string[]>([]);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const agents = agentData ?? NO_AGENTS;

  // Derived, not stored: an agent deleted between two reads drops out of the
  // selection here rather than travelling to the server as a stale id, and the
  // wire order is the list's order rather than click order.
  const selectedIds = agents.filter((a) => checked.includes(a.id)).map((a) => a.id);
  const count = selectedIds.length;

  // Closing on an outside click / Escape synchronises with the document, which
  // is what a `useEffect` is for. Bound only while the panel is open.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (agentId: string) =>
    setChecked((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );

  const durationLabel = (agentId: string): string => {
    const estimate = estimates?.find((e) => e.agent_id === agentId);
    return formatDurationSeconds(estimate?.mean_duration_ms) ?? t("picker.noEstimate");
  };

  const run = async () => {
    // The guard, not `disabled`: the control is focusable while empty and must
    // still issue nothing when it is activated (AC-48).
    if (count === 0 || start.isPending) return;
    onRunStart?.();
    try {
      const created = await start.mutateAsync({ prId, agentIds: selectedIds });
      onRunsStarted?.(created.columns.map((c) => c.run_id));
      setOpen(false);
      const href = resultsRoute(pathname);
      if (href) router.push(href);
    } catch {
      // Swallowed rather than left to reject unhandled — the panel stays open
      // with the selection intact and the refusal is RENDERED below off
      // `start.error`. It used to be swallowed and never shown, which made a
      // `422 too_many_agents` or a `409 multi_agent_run_in_flight` look
      // identical to a mis-click: spinner, then nothing.
    }
  };

  return (
    <div ref={rootRef} style={s.root}>
      <Button
        kind="primary"
        size="sm"
        icon="Sparkles"
        iconRight="ChevronDown"
        aria-haspopup="true"
        aria-expanded={open}
        style={warnMerged ? s.triggerMerged : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {t("picker.trigger")}
      </Button>

      {open && (
        <div style={s.panel}>
          <div style={s.title}>{t("picker.title")}</div>

          {/* AC-84: the copy and a way out, and no picker — no list, no Clear,
              no run action, because there is nothing to select. Gated on the
              read having answered, so a workspace that HAS agents never flashes
              "there are none" for the width of the first fetch. */}
          {agentData !== undefined && agents.length === 0 && (
            <p style={s.empty}>{t("picker.noAgents")}</p>
          )}

          {agents.length > 0 && (
            <>
              <ul style={s.list} aria-label={t("picker.title")}>
                {agents.map((a) => {
                  const isChecked = checked.includes(a.id);
                  return (
                    <li key={a.id} style={s.row}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-label={a.name}
                        onClick={() => toggle(a.id)}
                        style={s.checkbox(isChecked)}
                      >
                        {isChecked && <Icon.Check size={11} style={s.checkIcon} />}
                      </button>
                      <span style={s.name}>{a.name}</span>
                      <span className="tnum" style={s.estimate}>
                        {durationLabel(a.id)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div style={s.footer}>
                <Button kind="ghost" size="sm" onClick={() => setChecked([])}>
                  {t("picker.clear")}
                </Button>
                <span style={s.spacer} />
                <Button
                  kind="primary"
                  size="sm"
                  icon="Play"
                  loading={start.isPending}
                  aria-disabled={count === 0}
                  style={count === 0 ? s.runDisabled : undefined}
                  onClick={() => void run()}
                >
                  {t("picker.run", { count })}
                </Button>
              </div>
            </>
          )}

          {start.isError && (
            <p role="alert" style={s.error}>
              {refusalReason(start.error) ?? t("startFailed")}
            </p>
          )}

          <div style={s.manageRow}>
            <Icon.Settings size={13} />
            <Link href={AGENTS_ROUTE}>{t("picker.manageAgents")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
