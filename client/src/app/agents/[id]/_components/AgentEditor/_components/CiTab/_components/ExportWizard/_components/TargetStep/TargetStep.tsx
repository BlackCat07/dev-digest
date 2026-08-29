/* Target — pick the CI system. That is the whole step.

   FOUR cards, one of them selectable. `CI_TARGETS` names every value `CiTarget`
   holds and marks three `enabled: false`: they render dimmed, are `disabled`, and
   take no click. The flag is cosmetic and only cosmetic — `CiService` refuses the
   other three targets by name, so a card enabled here still exports nothing until
   its generator exists. (This reverses SPEC-05's original N4 / AC-52; the spec
   carries the amendment.)

   THERE IS NO REPOSITORY CONTROL, and its absence is the design. An agent runs in
   CI on the repository the studio is pointed at, so the target is the active repo
   and the wizard reads it rather than asking. `ExportWizard` takes it from
   `useActiveRepo()`; the Install step names it in full before anything is written,
   which is the one place the user has to see it. Two earlier shapes were tried and
   both were worse: free text let a typo — `acme/payment-api` — pass every check
   and fail as a 404 at the last step, and a picker asked the user to re-answer a
   question the sidebar had already answered. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { CI_TARGETS } from "@/lib/ci";
import type { CiTarget } from "@devdigest/shared";
import { s } from "../../../../styles";

export function TargetStep({ target }: { target: CiTarget }) {
  const t = useTranslations("ci");
  return (
    <div role="radiogroup" aria-label={t("exportWizard.steps.target")} style={s.targetGrid}>
      {CI_TARGETS.map((opt) => {
        const CardIcon = Icon[opt.icon];
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={opt.enabled && opt.value === target}
            disabled={!opt.enabled}
            style={opt.enabled ? s.targetCard : s.targetCardDisabled}
          >
            <CardIcon
              size={18}
              style={{
                color: opt.enabled ? "var(--accent)" : "var(--text-muted)",
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={s.targetTitle}>{t(opt.labelKey)}</span>
                {opt.enabled ? (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                ) : (
                  <Badge color="var(--text-muted)">{t("exportWizard.comingSoon")}</Badge>
                )}
              </span>
              <span style={s.targetDesc}>{t(opt.descKey)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
