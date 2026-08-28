/* MultiAgentResultsView — the results screen at /repos/:repoId/multi-agent/:number.

   What one agent found, next to what the others found, in whichever of two
   shapes the reader wants: columns side by side, or one agent at a time in
   tabs. Below both, the locations the agents did not agree on.

   Five things here are load-bearing and each is easy to undo by accident:

   1. **A 404 is the NO-RUN state, not the error state** (AC-83).
      `useMultiAgentRun` deliberately surfaces it as an `ApiError` instead of
      swallowing it into `undefined`, so a view that branched on `data == null`
      alone would render "something went wrong" at a pull request that has
      simply never been fanned out. The branch is on the error CODE.
   2. **This view opens no `EventSource`** (AC-66). Live updates for the columns
      are the query's own 2 000 ms poll, which `useMultiAgentRun` turns on only
      while a column is non-terminal and off again on the read in which the last
      one settles. A second timer here would double the traffic and disagree
      about when to stop. The only stream on this screen is the trace drawer's,
      and only while a drawer is open.
   3. **`isColumnTerminal` is imported, never re-derived.** The poll rule and the
      "is this column still going" rendering must be one definition; two copies
      is how a column polls forever, or stops on `cancelled`.
   4. **`?trace=` is validated against this multi-run's own columns.** A search
      param is user input: a run id belonging to another pull request opens
      nothing and is treated as absent, not as an error (AC-93).
   5. **Several URL keys move in ONE `router.replace`.** Two sequential
      single-key calls each build from the same stale `search`, and the second
      silently drops the first.

   No <Suspense> around any of this despite `useSearchParams`: the bailout rule
   is about statically prerendered routes and this one is dynamic, so a boundary
   would make the server emit the fallback INSTEAD of the screen
   (`client/CLAUDE.md`; `client/INSIGHTS.md`, 2026-08-04). */
"use client";

import React from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { useAgents, usePulls } from "@/lib/hooks";
import { isColumnTerminal, useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { AgentColumns } from "./_components/AgentColumns";
import { AgentTabsPane } from "./_components/AgentTabsPane";
import { DisagreementBlock } from "./_components/DisagreementBlock";
import { ModeToggle } from "./_components/ModeToggle";
import {
  AGENTS_ROUTE,
  DEFAULT_RESULTS_MODE,
  MODE_PARAM,
  RESULTS_MODES,
  TRACE_PARAM,
  type ResultsMode,
} from "./constants";
import {
  findPrId,
  findPrTitle,
  formatTotalSeconds,
  isNoRunError,
  parsePrNumber,
  toFindingRecords,
} from "./helpers";
import { s } from "./styles";

export function MultiAgentResultsView({ repoId, number }: { repoId: string; number: string }) {
  const t = useTranslations("runs");
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // The route is keyed by the pull request's NUMBER; every pull-request API is
  // keyed by the row's uuid. Resolved through the same cached list the PR
  // screens use, so the two cannot disagree about which row a number means.
  const prNumber = parsePrNumber(number);
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = findPrId(pulls, prNumber);
  const prTitle = findPrTitle(pulls, prNumber);

  const { data: run, isLoading: runLoading, error, refetch } = useMultiAgentRun(prId);
  const { data: agents } = useAgents();

  // Both bits of screen state live in the URL, so a reload and a shared link
  // restore the same screen (AC-61, AC-93). Neither is mirrored into React
  // state: a copy would be a second source of truth that goes stale the moment
  // the reader uses the back button.
  const mode: ResultsMode =
    RESULTS_MODES.find((m) => m === search.get(MODE_PARAM)) ?? DEFAULT_RESULTS_MODE;
  const requestedTraceRunId = search.get(TRACE_PARAM);
  // AC-93: validated against THIS multi-run's columns. An unknown run id is
  // absent, not an error — the reader followed a stale link, and the screen
  // they asked for still renders.
  const traceColumn =
    (run?.columns ?? []).find((c) => c.run_id === requestedTraceRunId) ?? null;

  const href = (sp: URLSearchParams) => {
    const qs = sp.toString();
    return `/repos/${repoId}/multi-agent/${number}${qs ? `?${qs}` : ""}`;
  };
  /** Several keys at once — see rule 5 in the file header. */
  const setParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) sp.delete(key);
      else sp.set(key, value);
    }
    router.replace(href(sp));
  };
  const setMode = (next: ResultsMode) =>
    // The default is omitted rather than written out, so an untouched link stays
    // clean and `?mode=columns` is never something a reader has to see.
    setParams({ [MODE_PARAM]: next === DEFAULT_RESULTS_MODE ? null : next });
  const openTrace = (runId: string) => setParams({ [TRACE_PARAM]: runId });
  const closeTrace = () => setParams({ [TRACE_PARAM]: null });

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    { label: `#${number}`, mono: true },
  ];

  // A :repoId matching no repo belongs to the repo-scoped 404 boundary that owns
  // that copy for every screen under /repos. After the hooks, never before.
  if (repoNotFound) notFound();

  if (pullsLoading || (prId != null && runLoading)) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loadingColumn}>
          <Skeleton height={28} width={360} />
          <Skeleton height={16} width={280} />
          <Skeleton height={260} />
        </div>
      </AppShell>
    );
  }

  // The number in the URL matches no pull request of this repository. Not the
  // repo-scoped 404 boundary — that one's copy says the REPOSITORY is unknown,
  // which would be untrue and would send the reader looking for the wrong
  // thing.
  if (prId == null) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen />
      </AppShell>
    );
  }

  // AC-83 / AC-84. Order matters: a workspace with no agents cannot have a
  // multi-run, and offering "choose agents to run" there sends the reader to a
  // screen with nothing to choose.
  if (isNoRunError(error)) {
    if (agents?.length === 0) {
      return (
        <AppShell crumb={crumb}>
          <EmptyState
            icon="Users"
            title={t("page.noAgents.title")}
            body={t("page.noAgents.body")}
            cta={t("page.noAgents.cta")}
            onCta={() => router.push(AGENTS_ROUTE)}
          />
        </AppShell>
      );
    }
    return (
      <AppShell crumb={crumb}>
        <EmptyState
          icon="Layers"
          title={t("page.noRun.title")}
          body={t("page.noRun.bodyReady")}
          cta={t("page.noRun.cta")}
          onCta={() => router.push(`/repos/${repoId}/multi-agent`)}
        />
      </AppShell>
    );
  }

  if (error || !run) {
    return (
      <AppShell crumb={crumb}>
        {/* Anything that is not a `not_found`. The server's own message is
            shown where there is one; the title is the design system's, so no
            copy is invented in this unit. */}
        <ErrorState
          fullScreen
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {/* Two rows, as the reference draws them. Row 1 is the screen: the way
            back, its name, what the run is, and the mode toggle. Row 2 is the
            subject: which pull request, and what the fan-out cost. The rule
            under row 2 is what separates the header from the results. */}
        <header style={s.header}>
          {/* The way back to Configure-run, which is the screen that starts a
              fan-out. Without it the pair is one-directional: Configure pushes
              here, and here offered nothing back. */}
          <Button
            kind="secondary"
            size="sm"
            icon="Settings"
            style={s.backButton}
            onClick={() => router.push(`/repos/${repoId}/multi-agent`)}
          >
            {t("results.backToConfigure")}
          </Button>
          <h1 style={s.title}>{t("page.title")}</h1>
          <span style={s.meta}>{t("results.selectedAgents", { count: run.agent_count })}</span>
          <span style={s.headerSpacer} />
          <ModeToggle value={mode} onChange={setMode} />
        </header>

        <div style={s.subBar}>
          {prNumber != null && (
            <span className="mono" style={s.subBarNumber}>
              #{prNumber}
            </span>
          )}
          {prTitle != null && prTitle !== "" && <span style={s.subBarTitle}>{prTitle}</span>}
          <span style={s.subBarStats}>
            {/* The agents glyph, the same one the Agents screen and the sidebar
                entry use (`vendor/ui/nav.ts` keys that entry to `Cpu`), so one
                icon means "agent" everywhere in the product. */}
            <Icon.Cpu size={14} style={s.subBarIcon} />
            <span>
              {t("page.meta", {
                count: run.agent_count,
                duration: formatTotalSeconds(run.total_duration_ms),
                cost: formatCost(run.total_cost_usd),
              })}
            </span>
          </span>
        </div>

        <div style={s.results}>
          {mode === "columns" ? (
            <AgentColumns columns={run.columns} onOpenTrace={openTrace} />
          ) : (
            <AgentTabsPane columns={run.columns} onOpenTrace={openTrace} />
          )}

          {/* Below the results, OUTSIDE the mode branch, so it renders once in
              columns mode and once in tabs mode from one mount point (AC-77).
              Its groups, stances and totals arrive computed on the server in
              `run.conflicts`; nothing about them is derived in the browser. */}
          <DisagreementBlock groups={run.conflicts} />
        </div>
      </div>

      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          agentName={traceColumn.agent_name}
          prNumber={prNumber}
          findings={toFindingRecords(traceColumn.findings)}
          // AC-95/AC-96: a still-running column's drawer opens on the live-log
          // tab and streams; a settled one's opens on the trace tab. This one
          // prop is the whole difference, and it is why the terminal set is
          // imported rather than re-listed here.
          running={!isColumnTerminal(traceColumn)}
          onClose={closeTrace}
        />
      )}
    </AppShell>
  );
}

export default MultiAgentResultsView;
