/* Stats tab — what this skill has actually done. Every figure comes from
   `run_skills`, i.e. from runs that really carried the skill, not from the
   agents that link it today. A skill with no runs shows dashes, not zeros. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarRow, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { toPercent } from "@/lib/skill";
import { s } from "./styles";

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileValue}>
        <span style={s.tileNumber}>{value}</span>
        {unit && <span style={s.tileUnit}>{unit}</span>}
      </div>
    </div>
  );
}

export function StatsTab({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.tileRow}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
        <Skeleton height={180} />
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const pull = toPercent(data.usage.pull_rate);
  const accept = toPercent(data.usage.accept_rate);
  const dash = t("card.noData");
  const maxCat = Math.max(1, ...data.findings_by_category.map((c) => c.count));

  return (
    <div style={s.wrap}>
      <div style={s.tileRow}>
        <Tile
          label={t("stats.usedBy")}
          value={String(data.usage.used_by)}
          unit={t("stats.usedByUnit", { count: data.usage.used_by })}
        />
        <Tile
          label={t("stats.pullFrequency")}
          value={pull == null ? dash : String(pull)}
          unit={pull == null ? undefined : "%"}
        />
        <Tile
          label={t("stats.acceptRate")}
          value={accept == null ? dash : String(accept)}
          unit={accept == null ? undefined : "%"}
        />
        <Tile label={t("stats.findings")} value={String(data.usage.findings_30d)} />
      </div>

      <div style={s.panelRow}>
        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Cpu size={13} />
            {t("stats.agentsUsing")}
          </div>
          {data.agents.length === 0 ? (
            <span style={s.none}>{t("stats.noAgents")}</span>
          ) : (
            data.agents.map((a) => (
              <div key={a.id} style={s.agentRow}>
                <Icon.Cpu size={14} style={s.agentIcon} />
                <span style={s.agentName}>{a.name}</span>
                <button
                  type="button"
                  onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
                  style={s.openBtn}
                >
                  {t("stats.open")}
                </button>
              </div>
            ))
          )}
        </div>

        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Tag size={13} />
            {t("stats.byCategory")}
          </div>
          {data.findings_by_category.length === 0 ? (
            <span style={s.none}>{t("stats.noFindings")}</span>
          ) : (
            data.findings_by_category.map((c) => (
              <div key={c.category} style={s.catRow}>
                <BarRow label={c.category} value={c.count} max={maxCat} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default StatsTab;
