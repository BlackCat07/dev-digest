/* SkillCard — one skill in the Skills Lab rail: name + enable toggle, its
   description, type/source badges, and the usage figures. Rendered by the
   workbench on both /skills and /skills/:id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { SKILL_SOURCE_ICON, SKILL_TYPE_COLOR, needsVetting, toPercent } from "@/lib/skill";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: SkillWithUsage;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = SKILL_TYPE_COLOR[skill.type];
  const SourceIcon = Icon[SKILL_SOURCE_ICON[skill.source]];
  const untrusted = needsVetting(skill.source);
  const pull = toPercent(skill.usage.pull_rate);
  const accept = toPercent(skill.usage.accept_rate);

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <span style={s.iconBox(color)}>
          <Icon.Sparkles size={13} />
        </span>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          // Stop the click here or toggling a skill also navigates to it.
          <div style={s.toggleWrap} onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>

      <div style={s.description}>{skill.description}</div>

      <div style={s.metaRow}>
        <span style={s.typeBadge(color)}>{t(`listItem.type.${skill.type}`)}</span>
        <span style={s.sourceRow}>
          <SourceIcon size={11} />
          {t(`listItem.source.${skill.source}`)}
        </span>
        {untrusted && (
          <span style={s.vetting} title={t("listItem.vettingTitle")}>
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>

      <div style={s.footer}>
        <span>{t("card.agents", { count: skill.usage.used_by })}</span>
        {/* Null is "no run has carried this yet", which is not 0% — render a dash
            so an unused skill never reads as a failing one. */}
        <span>{pull == null ? t("card.noData") : t("card.pull", { percent: pull })}</span>
        <span style={accept == null ? undefined : s.accept}>
          {accept == null ? t("card.noData") : t("card.accept", { percent: accept })}
        </span>
      </div>
    </div>
  );
}

export default SkillCard;
