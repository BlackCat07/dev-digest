/* Target — pick the CI system and name the repository.

   ONE card, because `CI_TARGETS` holds one entry (N4). It is drawn as a
   `radiogroup` rather than as a decorative panel so the single choice is still
   announced as a choice, and so a second target ships as one more array entry
   with no markup change. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, TextInput } from "@devdigest/ui";
import { CI_TARGETS, isRepoSlug } from "@/lib/ci";
import type { CiTarget } from "@devdigest/shared";
import { s } from "../../../../styles";

export function TargetStep({
  target,
  repo,
  onRepo,
}: {
  target: CiTarget;
  repo: string;
  onRepo: (v: string) => void;
}) {
  const t = useTranslations("ci");
  return (
    <>
      <div role="radiogroup" aria-label={t("exportWizard.steps.target")} style={s.targetGrid}>
        {CI_TARGETS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={opt.value === target}
            style={s.targetCard}
          >
            <Icon.Workflow size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={s.targetTitle}>{t(opt.labelKey)}</span>
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {t("exportWizard.recommended")}
                </Badge>
              </span>
              <span style={s.targetDesc}>{t(opt.descKey)}</span>
            </span>
          </button>
        ))}
      </div>
      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <TextInput
          value={repo}
          onChange={onRepo}
          mono
          placeholder={t("exportWizard.repoPlaceholder")}
          aria-label={t("exportWizard.repoLabel")}
          aria-invalid={repo.length > 0 && !isRepoSlug(repo)}
        />
      </FormField>
    </>
  );
}
