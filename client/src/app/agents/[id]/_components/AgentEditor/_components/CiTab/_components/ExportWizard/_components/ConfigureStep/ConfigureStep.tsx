/* Configure — when the review runs, and how it reports.

   Both controls open on the `CiExportInput` contract's own defaults (AC-57):
   opened / synchronize / reopened, and GitHub review. The trigger values are
   GitHub's own `pull_request` event-type identifiers and are rendered verbatim
   rather than translated — the string ticked here is the string that appears in
   the generated YAML.

   Nothing on this step writes `ci_fail_on`. AC-49 allows exactly one editor for
   that field and the Config tab already ships it; the CI tab DISPLAYS the stored
   value and adds no second control. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon } from "@devdigest/ui";
import { CI_DEFAULT_POST_AS, CI_POST_AS_OPTIONS, CI_TRIGGER_EVENTS, CI_TRIGGER_PREFIX } from "@/lib/ci";
import type { CiExportInput } from "@devdigest/shared";
import { s } from "../../../../styles";

export function ConfigureStep({
  triggers,
  onTriggers,
  postAs,
  onPostAs,
}: {
  triggers: readonly string[];
  onTriggers: (v: string[]) => void;
  postAs: CiExportInput["post_as"];
  onPostAs: (v: CiExportInput["post_as"]) => void;
}) {
  const t = useTranslations("ci");
  /**
   * Toggle one event, and hand back the set in the CANONICAL order rather than
   * in the order it was ticked — the array is written into the generated
   * workflow's `types:` list, and a list that reorders itself makes two exports
   * of the same choice produce two different files.
   */
  const toggle = (event: string, on: boolean) => {
    const next = on ? [...triggers, event] : triggers.filter((e) => e !== event);
    onTriggers(CI_TRIGGER_EVENTS.filter((e) => next.includes(e)));
  };

  return (
    <>
      <FormField label={t("exportWizard.triggerLabel")} hint={t("exportWizard.triggerHint")}>
        {/* Chips rather than a column of checkboxes: three short, related values
            read as one set side by side. `role="checkbox"` is kept — the control
            is still three independent toggles, and dropping the role to make it
            look like a segmented control would announce it as one. */}
        <div style={s.triggerChips}>
          {CI_TRIGGER_EVENTS.map((event) => {
            const on = triggers.includes(event);
            return (
              <button
                key={event}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(event, !on)}
                className="mono"
                style={on ? s.triggerChipOn : s.triggerChip}
              >
                {on && <Icon.Check size={12} />}
                {`${CI_TRIGGER_PREFIX}${event}`}
              </button>
            );
          })}
        </div>
      </FormField>
      <FormField label={t("exportWizard.postResultsLabel")}>
        {/* A local radiogroup and not `SelectInput`: three mutually exclusive
            options, all of them short, and one of them carrying a "recommended"
            badge a `<select>` has nowhere to put. `vendor/ui` ships no radio
            primitive and is not ours to add one to for a single screen, so the
            group is composed here the way the target cards already are. */}
        <div role="radiogroup" aria-label={t("exportWizard.postResultsLabel")} style={s.postAsGroup}>
          {CI_POST_AS_OPTIONS.map((o) => {
            const on = o.value === postAs;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPostAs(o.value)}
                style={s.postAsRow}
              >
                <span style={on ? s.radioDotOn : s.radioDot} aria-hidden="true" />
                <span style={s.postAsLabel}>{t(o.labelKey)}</span>
                {o.value === CI_DEFAULT_POST_AS && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </FormField>
      <div style={s.note}>
        <Icon.Info size={15} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={s.noteTitle}>{t("exportWizard.blockMergeTitle")}</div>
          <div style={s.noteBody}>{t("exportWizard.blockMergeDesc")}</div>
        </div>
      </div>
    </>
  );
}
