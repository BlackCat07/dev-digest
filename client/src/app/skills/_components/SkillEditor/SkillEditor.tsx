/* SkillEditor — header + tab bar for one skill, and the five tab bodies.
   Tab state lives in ?tab= so a link into a specific tab survives a reload. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Icon, Tabs } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { SKILL_TYPE_COLOR } from "@/lib/skill";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { DEFAULT_TAB, TABS, VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();

  const raw = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(raw) ? raw : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${skill.id}?${sp.toString()}`);
  };

  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Icon.Sparkles size={18} style={s.icon} />
        <h1 className="mono" style={s.title}>
          {skill.name}
        </h1>
        <span style={s.typeBadge(SKILL_TYPE_COLOR[skill.type])}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <Badge color="var(--text-secondary)" icon="GitBranch" mono>
          {t("versions.label", { version: skill.version })}
        </Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
      </div>

      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 24px" />
      </div>

      <div style={s.body}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}

export default SkillEditor;
