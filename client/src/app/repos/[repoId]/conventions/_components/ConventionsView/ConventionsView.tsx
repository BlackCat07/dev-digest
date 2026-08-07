/* ConventionsView — the Conventions screen: run a scan, triage what it found,
   and see what it threw away. */
"use client";

import React from "react";
import { notFound, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
} from "@devdigest/ui";
import type {
  ConventionCategory,
  ConventionScan,
  ExtractedConvention,
} from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import {
  useConventions,
  useResetConventionTriage,
  useStartConventionScan,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { CONVENTION_CATEGORIES, droppedTotal, isScanning } from "@/lib/conventions";
import { formatCost } from "@/lib/format";
import { CategoryFilter } from "../CategoryFilter";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { compactCount, isAllDropped, relativeAge } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const { data, isLoading, isError } = useConventions(repoId);
  const repoNotFound = useRepoNotFound(repoId);
  const { reposLoaded } = useActiveRepo();
  const startScan = useStartConventionScan(repoId);
  const updateConvention = useUpdateConvention(repoId);
  const resetTriage = useResetConventionTriage(repoId);

  const [category, setCategory] = React.useState<ConventionCategory | "all">("all");
  const [confirming, setConfirming] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  // A :repoId that matches no repo — a deleted repo, or a stale id the sidebar
  // still points at — belongs to the repo-scoped 404 boundary that owns that
  // copy for every screen below /repos, exactly as the PR list does it. Without
  // this the screen answered a missing repo with its own generic load error.
  if (repoNotFound) notFound();

  // The conventions request 404s for that same missing repo, and it can resolve
  // before the repos list does. Holding the error until the list has loaded is
  // what stops a generic error flashing in front of the 404 boundary.
  if (isLoading || (isError && !reposLoaded)) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={34} width={360} />
          <div style={{ height: 20 }} />
          <Skeleton height={120} />
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState title={t("page.loadError")} />
        </div>
      </AppShell>
    );
  }

  const { scan, budget, candidates, repo } = data;
  const scanning = isScanning(scan);
  const acceptedCandidates = candidates.filter((c) => c.status === "accepted");
  const accepted = acceptedCandidates.length;
  const triaged = candidates.filter((c) => c.status !== "pending");
  const dropped = droppedTotal(scan);

  const visible =
    category === "all" ? candidates : candidates.filter((c) => c.category === category);

  const runScan = () => {
    setConfirming(false);
    // Options stay empty here: the extractor's own defaults are the right ones
    // for a first run, and every knob has a home in the settings popover rather
    // than in a modal the user only sees when a repo is large.
    startScan.mutate({});
  };

  /** Large repos get the estimate first; small ones just run. */
  const onScanClick = () => {
    if (budget.capped_by !== null) setConfirming(true);
    else runScan();
  };

  const triage = (candidate: ExtractedConvention, status: "accepted" | "rejected") => {
    // Clicking the state a candidate is already in clears it, so a mis-click is
    // one click to undo rather than a dead end.
    const next = candidate.status === status ? "pending" : status;
    updateConvention.mutate({ id: candidate.id, patch: { status: next } });
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headRow}>
          <h1 style={s.heading}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repo.full_name || t("page.repoFallback")}
            </span>
          </h1>
          {budget.can_scan && (
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={scanning || startScan.isPending}
              disabled={scanning || startScan.isPending}
              onClick={onScanClick}
            >
              {scanning
                ? t("page.scanning")
                : scan
                  ? t("page.rescan")
                  : t("page.runExtraction")}
            </Button>
          )}
        </div>

        <ScanNotes scan={scan} dropped={dropped} />

        {/* A repo that cannot be scanned right now may still have candidates
            from when it could. Blocking is about the SCAN, so it takes the
            button away and says why — it must not take away work already done,
            which is still triageable and still generates a skill. */}
        {budget.blocked_reason && candidates.length > 0 && (
          <div style={s.notes}>
            <div style={s.note("warn")}>{t(`blocked.${budget.blocked_reason}.title`)}</div>
          </div>
        )}

        {budget.blocked_reason && candidates.length === 0 && !scanning ? (
          <div style={s.blocked}>
            <div style={s.blockedTitle}>{t(`blocked.${budget.blocked_reason}.title`)}</div>
            <div style={s.blockedBody}>{t(`blocked.${budget.blocked_reason}.body`)}</div>
          </div>
        ) : candidates.length === 0 ? (
          isAllDropped(scan, candidates.length) ? (
            <EmptyState
              icon="Filter"
              title={t("page.allDropped.title")}
              body={t("page.allDropped.body", { proposed: scan?.proposed ?? 0 })}
              cta={t("page.rescan")}
              onCta={onScanClick}
              ctaLoading={scanning || startScan.isPending}
            />
          ) : (
            <EmptyState
              icon="ListChecks"
              title={t("page.empty.title")}
              body={t("page.empty.body")}
              cta={t("page.empty.cta")}
              onCta={onScanClick}
              ctaLoading={scanning || startScan.isPending}
            />
          )
        ) : (
          <>
            <div style={s.toolbarPrimary}>
              <CategoryFilter
                value={category}
                ariaLabel={t("page.allCategories")}
                onChange={(value) => setCategory(value as ConventionCategory | "all")}
                options={[
                  { value: "all", label: t("page.allCategories") },
                  ...CONVENTION_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`category.${c}`),
                  })),
                ]}
              />
              <Button
                kind="secondary"
                icon="X"
                disabled={triaged.length === 0 || resetTriage.isPending}
                loading={resetTriage.isPending}
                onClick={() => resetTriage.mutate(triaged.map((c) => c.id))}
              >
                {t("page.deselectAll")}
              </Button>
              <span style={s.triage}>
                {t("page.triage", { accepted, total: candidates.length })}
              </span>
              <div style={s.spacer} />
              <Button
                kind="primary"
                icon="Sparkles"
                disabled={accepted === 0}
                title={accepted === 0 ? t("create.none") : undefined}
                onClick={() => setCreating(true)}
              >
                {t("create.open")}
              </Button>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon="Search"
                title={t("page.noMatch.title")}
                body={t("page.noMatch.body")}
              />
            ) : (
              visible.map((candidate) => (
                <ConventionCard
                  key={candidate.id}
                  candidate={candidate}
                  repoFullName={repo.full_name}
                  sha={repo.sha}
                  busy={updateConvention.isPending}
                  onAccept={() => triage(candidate, "accepted")}
                  onReject={() => triage(candidate, "rejected")}
                  onEdit={(patch) => updateConvention.mutate({ id: candidate.id, patch })}
                />
              ))
            )}
          </>
        )}
      </div>

      {confirming && (
        <Modal
          width={520}
          title={t("budget.title")}
          subtitle={t("budget.large")}
          onClose={() => setConfirming(false)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="ghost" onClick={() => setConfirming(false)}>
                {t("budget.cancel")}
              </Button>
              <Button kind="primary" onClick={runScan}>
                {t("budget.confirm")}
              </Button>
            </div>
          }
        >
          <div style={s.budgetBody}>
            <div style={s.budgetGrid}>
              <div style={s.budgetCell}>
                <div style={s.budgetValue}>{budget.planned_sample}</div>
                <div style={s.budgetLabel}>{t("budget.files", { count: budget.planned_sample })}</div>
              </div>
              <div style={s.budgetCell}>
                <div style={s.budgetValue}>{compactCount(budget.planned_tokens)}</div>
                <div style={s.budgetLabel}>
                  {t("budget.tokens", { count: compactCount(budget.planned_tokens) })}
                </div>
              </div>
              <div style={s.budgetCell}>
                <div style={s.budgetValue}>{budget.planned_calls}</div>
                <div style={s.budgetLabel}>
                  {t("budget.calls", { count: budget.planned_calls })}
                </div>
              </div>
              <div style={s.budgetCell}>
                <div style={s.budgetValue}>
                  {budget.estimated_cost_usd == null
                    ? "—"
                    : formatCost(budget.estimated_cost_usd)}
                </div>
                <div style={s.budgetLabel}>
                  {budget.estimated_cost_usd == null
                    ? t("budget.costUnknown")
                    : t("budget.cost", { cost: formatCost(budget.estimated_cost_usd) })}
                </div>
              </div>
            </div>
            {budget.capped_by && (
              <div style={s.note("warn")}>
                {budget.capped_by === "tokens"
                  ? t("budget.cappedTokens")
                  : t("budget.cappedFiles")}
              </div>
            )}
          </div>
        </Modal>
      )}

      {creating && (
        <CreateSkillModal
          repoId={repoId}
          repoFullName={repo.full_name}
          accepted={acceptedCandidates}
          onClose={() => setCreating(false)}
          onCreated={(skills) => {
            setCreating(false);
            // Straight to the thing they just made: the point of this screen is
            // the hand-off to the Skills Lab, and making them go and find it
            // breaks the loop the lesson is about.
            const first = skills[0];
            if (first) router.push(`/skills/${first.id}`);
          }}
        />
      )}
    </AppShell>
  );
}

/**
 * The line under the subtitle: what the last scan looked at, and what it threw
 * away.
 *
 * The dropped counts are the point. A list of five with no context reads as
 * "this repo has five conventions"; "twelve proposed, seven could not be
 * substantiated" is the more useful fact and the one that makes the five
 * credible.
 */
function ScanNotes({ scan, dropped }: { scan: ConventionScan | null; dropped: number }) {
  const t = useTranslations("conventions");
  if (!scan) return null;

  const age = relativeAge(scan.finished_at ?? scan.started_at);

  return (
    <div style={s.notes}>
      <div style={s.note("muted")}>
        {t("scan.detectedFrom", { count: scan.sampled_files })} ·{" "}
        {t("scan.lastScan", { when: t(`scan.${age.key}`, { count: age.count }) })}
        {scan.cost_usd != null && ` · ${t("scan.cost", { cost: formatCost(scan.cost_usd) })}`}
      </div>

      {scan.status === "partial" && (
        <div style={s.note("warn")}>
          {t("scan.partial", {
            sampled: scan.sampled_files,
            eligible: scan.eligible_files,
          })}
        </div>
      )}

      {dropped > 0 && (
        <div style={s.note("muted")}>
          {t("scan.dropped", { dropped })} —{" "}
          {t("scan.droppedDetail", {
            unverified: scan.dropped_unverified,
            lowAdherence: scan.dropped_low_adherence,
          })}
        </div>
      )}

      {scan.status === "failed" && scan.error && (
        <div style={s.note("crit")}>{t("scan.failed", { error: scan.error })}</div>
      )}
    </div>
  );
}

export default ConventionsView;
