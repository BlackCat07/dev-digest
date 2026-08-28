"use client";

import React, { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@devdigest/ui";
import { useMultiAgentRun } from "@/lib/hooks";
import { resultsRoute } from "@/lib/multi-agent-routes";
import { AgentPicker } from "../AgentPicker";
import { s } from "./styles";
import type { PrDetail } from "@/lib/types";

interface PrDetailHeaderProps {
  pr: PrDetail;
  prId: string | null;
  tab: string;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: string) => void;
  onRunStart: () => void;
  onRunsStarted: () => void;
}

/**
 * The pull request's row uuid, shown and copyable.
 *
 * The route addresses a PR as `/repos/:repoId/pulls/:number`, so this id appears
 * in no URL — yet it is what the MCP tools take as `pr_id`. Without this chip the
 * only way to obtain one is a query against the API, which is not something a
 * reader of this screen should have to do.
 *
 * Local rather than its own folder, matching `ConventionCard`'s `CopySnippet`: it
 * has one caller, and the "copied" flash is state only this button owns.
 */
function PrIdChip({ prId }: { prId: string }) {
  const [copied, setCopied] = React.useState(false);
  const label = copied ? "Copied" : "Copy pull request id";

  return (
    <span style={s.idChip}>
      <span style={s.idLabel}>id</span>
      <span className="mono" style={s.idValue}>
        {prId}
      </span>
      <button
        type="button"
        title={label}
        aria-label={label}
        style={s.idCopy(copied)}
        onClick={() => {
          // Optional-chained: jsdom and non-secure origins have no clipboard, and
          // a missing one must not throw inside the header.
          void navigator.clipboard?.writeText(prId);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
      </button>
    </span>
  );
}

export function PrDetailHeader({
  pr,
  prId,
  tab,
  findingsCount,
  githubUrl,
  onSetTab,
  onRunStart,
  onRunsStarted,
}: PrDetailHeaderProps) {
  const t = useTranslations("runs");
  const router = useRouter();
  // Same derivation the picker uses: this header is handed `pr` and `prId`, not
  // the route segments.
  const multiAgentHref = resultsRoute(usePathname());
  /* The standing way back into a fan-out's results. Before this, the ONLY
     navigation into `/repos/:repoId/multi-agent/:number` was the picker's
     `router.push` the moment a run started — leave the page and the results
     were reachable by typing the URL and no other way, even though the read
     still answered.

     Gated on the read having SUCCEEDED, not on the absence of an error: a 404
     is the routine "this pull request was never fanned out" answer
     (`useMultiAgentRun` surfaces it rather than swallowing it), and it must
     leave the row exactly as it was — never an error, never a dead control. */
  const { data: multiRun } = useMultiAgentRun(prId);

  const handleRunStart = useCallback(() => {
    onRunStart();
  }, [onRunStart]);

  const handleRunsStarted = useCallback(() => {
    onRunsStarted();
  }, [onRunsStarted]);

  const statusColor =
    pr.status === "merged"
      ? "var(--ok)"
      : pr.status === "closed"
        ? "var(--stale)"
        : "var(--warn)";

  return (
    // `data-sticky-header` is read by the Smart Diff viewer (L03b), which measures
    // this element's height so a scrolled-to diff line clears it. An attribute
    // rather than a shared constant because the measurer is in another route
    // subtree and this header owns no module the viewer could import.
    <div data-sticky-header style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
              <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
            </span>
            <Badge dot bg="transparent" color={statusColor}>
              {pr.status}
            </Badge>
            {prId && <PrIdChip prId={prId} />}
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind="ghost"
            size="sm"
            icon="ExternalLink"
            disabled={!githubUrl}
            onClick={() =>
              githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")
            }
          >
            View on GitHub
          </Button>
          {multiRun && multiAgentHref && (
            <Button
              kind="secondary"
              size="sm"
              icon="Users"
              onClick={() => router.push(multiAgentHref)}
            >
              {t("results.openFromPr")}
            </Button>
          )}
          {prId && (
            <AgentPicker
              prId={prId}
              warnMerged={pr.status === "merged" || pr.status === "closed"}
              onRunStart={handleRunStart}
              onRunsStarted={handleRunsStarted}
            />
          )}
        </div>
      </div>
      {(pr.status === "merged" || pr.status === "closed") && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>
            This PR is already {pr.status} — running a review is informational and won't affect the
            merged code.
          </span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: "Overview", icon: "FileText" },
          { key: "findings", label: "Agent runs", icon: "AlertOctagon", count: findingsCount || undefined },
          { key: "diff", label: "Files changed", icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
