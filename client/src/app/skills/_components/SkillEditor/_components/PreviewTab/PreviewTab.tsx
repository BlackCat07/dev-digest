/* Preview tab — the skill body rendered as markdown, i.e. what the reviewing
   agent receives. Read-only on purpose: this is the vetting surface for an
   imported skill, so it shows the text and does nothing with it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { needsVetting } from "@/lib/skill";
import { SkillBody } from "../../../SkillBody";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("previewTab.title")}</h2>
      <p style={s.subtitle}>{t("previewTab.subtitle")}</p>

      {needsVetting(skill.source) && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={15} style={s.noticeIcon} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <div style={s.card}>
        {skill.body.trim().length === 0 ? (
          <span style={s.empty}>{t("previewTab.empty")}</span>
        ) : (
          <SkillBody>{skill.body}</SkillBody>
        )}
      </div>
    </div>
  );
}

export default PreviewTab;
