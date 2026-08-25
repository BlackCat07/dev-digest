/* CI tab — where this agent runs in CI, and the wizard that puts it there.

   Reads TWO namespaces, and both must be provided wherever it is mounted: `ci`
   for its own framing and `agents` for the `config.ciFailOnOptions.*` label the
   gate section reuses. Mounting with one missing does not fail — next-intl
   renders the key path and logs `IntlError: MISSING_MESSAGE` to stderr while the
   assertion passes (`client/INSIGHTS.md`, 2026-08-11).

   The gate section DISPLAYS `ci_fail_on` and adds no control that writes it:
   AC-49 allows one editor for that field and the Config tab already ships it,
   with all four `CiFailOn` values selectable. A second editor here would be two
   places to change one thing.

   No repository connected means no export entry point AT ALL (AC-47), not a
   disabled one — a control that cannot work is a promise with no date.

   Installation rows state the status and age of that installation's MOST RECENT
   CI run, not the date it was installed: "did my agent run, and did it pass" is
   the question the tab exists to answer. An installation that has never run says
   so in words, because that is the ordinary state right after an export and not
   an error. (`ciTab.installed` is left in the catalogue, orphaned, deliberately.)

   No edit and no delete control on a row (N13). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, CiInstallation } from "@devdigest/shared";
import { ciStatusCell } from "@/lib/ci";
import { formatAge } from "@/lib/format";
import { useAgentCiInstallations } from "@/lib/hooks/ci";
import { useRepos } from "@/lib/hooks/core";
import { ExportWizard } from "./_components/ExportWizard";
import { INSTALL_SKELETON_KEYS } from "./constants";
import { s } from "./styles";

/**
 * A run status as a DOT plus a WORD — never colour alone, and never
 * `SeverityBadge`'s `compact`, which renders the icon and drops the label.
 */
function StatusCell({ status }: { status: string | null }) {
  const t = useTranslations("ci");
  const cell = ciStatusCell(status);
  if (cell.kind === "never") {
    return (
      <Badge dot color="var(--text-muted)" bg="transparent">
        {t("ciTab.neverRun")}
      </Badge>
    );
  }
  return (
    <Badge dot color={cell.color} bg="transparent">
      {cell.kind === "known" ? t(cell.labelKey) : cell.text}
    </Badge>
  );
}

/** One installation: repository, target, and its latest run's status and age. */
function InstallationRow({ install }: { install: CiInstallation }) {
  const t = useTranslations("ci");
  return (
    <li style={s.row}>
      <span className="mono" style={s.rowRepo}>
        {install.repo}
      </span>
      <Badge color="var(--text-secondary)">{t(`exportWizard.targets.${install.target_type}`)}</Badge>
      <StatusCell status={install.last_run_status} />
      {install.last_run_at && (
        <span style={s.rowAge}>{t("ciTab.ranAgo", { age: formatAge(install.last_run_at) })}</span>
      )}
    </li>
  );
}

/** The gate this agent's exported workflow will enforce. Read-only, by AC-49. */
function GateSection({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");
  return (
    <div style={s.gate}>
      <SectionLabel icon="Shield">{t("ciTab.gateLabel")}</SectionLabel>
      <div style={s.gateValue}>{tAgents(`config.ciFailOnOptions.${agent.ci_fail_on}`)}</div>
      <div style={s.gateBody}>{t("ciTab.gateBody")}</div>
    </div>
  );
}

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const repos = useRepos();
  const installs = useAgentCiInstallations(agent.id);
  const [wizard, setWizard] = React.useState<{ repo: string } | null>(null);

  const hasRepo = (repos.data ?? []).length > 0;
  const installations = installs.data ?? [];

  const heading = (
    <div style={s.header}>
      <div>
        <h2 style={s.h2}>{t("ciTab.heading")}</h2>
        <p style={s.sub}>{t("ciTab.subtitle")}</p>
      </div>
      {hasRepo && (
        <div style={s.headerActions}>
          <Badge color="var(--text-secondary)">{t("ciTab.activeIn", { count: installations.length })}</Badge>
          {installations[0] && (
            <Button icon="RefreshCw" onClick={() => setWizard({ repo: installations[0]!.repo })}>
              {t("ciTab.update")}
            </Button>
          )}
          <Button kind="primary" icon="Upload" onClick={() => setWizard({ repo: "" })}>
            {t("ciTab.exportToCi")}
          </Button>
        </div>
      )}
    </div>
  );

  // The repository list decides whether this feature is reachable at all, so it
  // is answered BEFORE the installations read — a "connect a repository" state
  // shown while that list is still in flight is a lie the user acts on.
  if (repos.isLoading) {
    return (
      <div style={s.wrap}>
        {heading}
        <Skeleton height={54} />
      </div>
    );
  }

  if (!hasRepo) {
    return (
      <div style={s.wrap}>
        {heading}
        <EmptyState icon="GitBranch" title={t("ciTab.noRepo")} body={t("ciTab.noRepoBody")} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {heading}
      <div>
        <SectionLabel icon="Workflow">{t("ciTab.reposLabel")}</SectionLabel>
        {installs.isLoading ? (
          <div style={s.list}>
            {INSTALL_SKELETON_KEYS.map((k) => (
              <Skeleton key={k} height={44} />
            ))}
          </div>
        ) : installs.isError ? (
          <div role="alert" style={s.inlineError}>
            <span style={s.inlineErrorTitle}>{t("ciTab.loadFailed")}</span>
            <span style={s.inlineErrorBody}>{installs.error.message}</span>
          </div>
        ) : installations.length === 0 ? (
          <EmptyState icon="Workflow" title={t("ciTab.empty")} />
        ) : (
          <ul style={s.list}>
            {installations.map((install) => (
              <InstallationRow key={install.id} install={install} />
            ))}
          </ul>
        )}
        <button type="button" style={{ ...s.addRow, marginTop: 8 }} onClick={() => setWizard({ repo: "" })}>
          <Icon.Plus size={14} />
          {t("ciTab.addRepo")}
        </button>
      </div>
      <GateSection agent={agent} />
      {wizard && (
        <ExportWizard agent={agent} initialRepo={wizard.repo} onClose={() => setWizard(null)} />
      )}
    </div>
  );
}
