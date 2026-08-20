/* PR Detail screen — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab and open-trace state live in the URL (?tab, ?trace, ?finding, ?order, and
   ?file/?line for the file a review-focus row sent the reader to).

   No `<Suspense>` boundary around any of this despite `useSearchParams`: that rule is
   about STATICALLY prerendered routes, and this one is dynamic because of `[repoId]`,
   so the hook costs nothing here — while a boundary makes the server emit the fallback
   INSTEAD of the screen. That shipped a blank first paint once, with typecheck,
   `next build` and every unit test green (`client/INSIGHTS.md`, 2026-08-04). */
"use client";

import React from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { usePullDetail, usePulls } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
} from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";
import { PrDetailHeader } from "../PrDetailHeader";
import { OverviewTab } from "../OverviewTab";
import { FindingsTab } from "../FindingsTab";
import { DiffTab } from "../DiffTab";
import type { DiffOrder } from "../SmartDiffViewer";
import RunTraceDrawer from "../RunTraceDrawer";
import { s } from "./styles";

export function PrDetailView({ repoId, number }: { repoId: string; number: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // The finding the screen was asked to land on (L03b review follow-up). Set by a
  // badge in the diff, read by the Agent-runs tab, which opens the run holding it
  // and scrolls its card into view. In the URL like every other bit of this
  // screen's state, so the landing is linkable and survives a reload.
  const targetFindingId = search.get("finding");
  /* The file — and optionally the line — the reader was sent to read (L05, AC-40).
     Set by a review-focus row on the brief card, consumed by the diff tab, which
     expands that file and scrolls to the line. In the URL for the same reason as
     everything else here: the landing survives a reload and a shared link.

     The line is parsed defensively because a URL is user input: a non-numeric or
     non-positive `?line=` costs the reader the scroll and nothing else, which is
     the right outcome for a value that is explicitly ungrounded anyway — the model
     never sees a hunk body, so nothing ever checked that the number means
     something. `?file=` needs no such guard: an unknown path is a real state the
     diff tab already reports (AC-43). */
  const targetFile = search.get("file") ?? undefined;
  const lineParam = Number(search.get("line"));
  const targetLine =
    Number.isInteger(lineParam) && lineParam > 0 ? lineParam : undefined;

  const href = (sp: URLSearchParams) =>
    `/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`;
  // Several keys at once, because two sequential single-key calls would each build
  // from the SAME stale `search` and the second would silently drop the first.
  const paramsWith = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    return sp;
  };
  const setParam = (key: string, val: string | null) => {
    router.replace(href(paramsWith({ [key]: val })));
  };
  // Switching tabs by hand drops the finding target — AND the file target, for the
  // same reason: the landing belongs to the navigation that asked for it, not to the
  // tab. Without this, coming back to `Files changed` later would re-open and
  // re-scroll to a file nobody asked about, and the diff tab would keep announcing
  // a missing target long after the row that named it was forgotten.
  const setTab = (t: string) =>
    router.replace(href(paramsWith({ tab: t, finding: null, file: null, line: null })));

  /**
   * A findings badge in the diff → that finding's card in the Agent-runs tab.
   *
   * `push`, not `replace`: this is a real navigation across tabs, so Back has to
   * return the reader to the file they were reading. Standard app routing rather
   * than a modal or a github.com link — the card is a first-class part of this
   * screen, with the rationale, the suggested fix and the accept/dismiss actions.
   */
  const openFinding = (findingId: string) => {
    router.push(href(paramsWith({ tab: "findings", finding: findingId })));
  };

  /**
   * A review-focus row on the brief card → that file in the `Files changed` tab
   * (AC-40).
   *
   * `push`, not `replace`, exactly as `openFinding` above: this is a real
   * navigation across tabs, so Back has to return the reader to the card they
   * came from. One `paramsWith` call rather than two sequential `setParam`s,
   * because each of those would build from the SAME stale `search` and the second
   * would silently drop the first.
   *
   * A row with no line clears `?line` instead of leaving the previous row's number
   * behind — a stale line would scroll the reader into the middle of a file they
   * were told to read from the top.
   */
  const openFile = (path: string, line?: number | null) => {
    router.push(
      href(paramsWith({ tab: "diff", file: path, line: line != null ? String(line) : null })),
    );
  };
  // The diff's grouping (L03b). In the URL, like `?tab` and `?trace`, so a link to
  // this tab carries the reader's choice. The default is OMITTED rather than
  // written as `?order=smart`, so an untouched URL stays clean; any unrecognised
  // value falls back to `smart` rather than rendering nothing.
  const order: DiffOrder = search.get("order") === "original" ? "original" : "smart";
  const setOrder = (next: DiffOrder) => setParam("order", next === "smart" ? null : next);

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  // Totals count kind==='review' rows ONLY, matching the PR list's FINDINGS
  // rollup, which filters the same way. `reviewsForPull` does not filter `kind`,
  // so without this the tab badge would drift from the list column the moment
  // anything starts writing kind:'summary' reviews.
  const allFindings: FindingRecord[] = React.useMemo(
    () => (reviews ?? []).filter((r) => r.kind === "review").flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → the repo-scoped 404 boundary
  // (app/repos/[repoId]/not-found.tsx). See PullsView for why this cannot fire
  // on a loading flash.
  if (repoNotFound) notFound();

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loadingColumn}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={
            error instanceof ApiError
              ? error.message
              : `PR #${number} could not be loaded.`
          }
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={s.tabColumn}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            headSha={pr.head_sha}
            prBody={pr.body}
            repoFullName={repoFullName}
            repoId={repoId}
            onOpenFile={openFile}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            targetFindingId={targetFindingId}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            additions={pr.additions}
            deletions={pr.deletions}
            // The review ROWS, not `allFindings`: the diff tab reduces them to the
            // newest review per agent so a re-run replaces a file's badge rather
            // than adding to it. `allFindings` deliberately sums every run, because
            // the Agent-runs badge above must equal the PR list's FINDINGS column.
            reviews={runs}
            order={order}
            onOrderChange={setOrder}
            canComment={pr.status === "open"}
            onOpenFinding={openFinding}
            // The URL's file target, straight through. The tab expands the file and
            // scrolls to the line; it says so plainly when the target is a real
            // changed file this page of the diff never received (AC-43).
            targetFile={targetFile}
            targetLine={targetLine}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}

export default PrDetailView;
