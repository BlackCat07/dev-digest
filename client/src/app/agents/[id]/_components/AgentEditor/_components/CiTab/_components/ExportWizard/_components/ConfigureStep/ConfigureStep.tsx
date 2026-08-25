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
import { Checkbox, FormField, Icon, SelectInput } from "@devdigest/ui";
import { CI_POST_AS_OPTIONS, CI_TRIGGER_EVENTS } from "@/lib/ci";
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CI_TRIGGER_EVENTS.map((event) => (
            <Checkbox
              key={event}
              checked={triggers.includes(event)}
              onChange={(on) => toggle(event, on)}
              label={<span className="mono">{event}</span>}
            />
          ))}
        </div>
      </FormField>
      <FormField label={t("exportWizard.postResultsLabel")}>
        <SelectInput
          value={postAs}
          mono={false}
          onChange={(v) => onPostAs(v as CiExportInput["post_as"])}
          options={CI_POST_AS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        />
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
