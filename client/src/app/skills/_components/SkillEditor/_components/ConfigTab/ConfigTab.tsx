/* Config tab — name / description / type / markdown body, the enabled toggle,
   and a separated danger zone.

   The body is a line-numbered editor rather than a form field, because it is the
   whole product: everything else on this screen is metadata about it. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { SkillType, SkillWithUsage } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPES, estimateTokens } from "@/lib/skill";
import { SkillBodyEditor } from "./_components/SkillBodyEditor";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const router = useRouter();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  const reset = React.useCallback(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.name, skill.description, skill.type, skill.body]);

  // Reload the form when the rail switches to a different skill.
  React.useEffect(() => {
    reset();
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the body drives the "unsaved" marker and the version hint — it is the
  // one field whose change creates a new version.
  const bodyDirty = body !== skill.body;
  const dirty =
    bodyDirty || name !== skill.name || description !== skill.description || type !== skill.type;

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) =>
          toast.success(t("config.savedToast", { name: data.name, version: data.version })),
      },
    );

  const remove = () => {
    if (!window.confirm(t("config.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, { onSuccess: () => router.push("/skills") });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle
            on={skill.enabled}
            // Enabling is a separate, immediate act from saving an edit: it is the
            // vetting gate for an imported skill, so it must not ride along with
            // unsaved body text.
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={16}
          />
        </label>
      </div>

      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField label={t("config.bodyLabel")} required hint={t("config.bodyCaption")}>
        <SkillBodyEditor
          value={body}
          onChange={setBody}
          filename={`${skill.name}.md`}
          dirty={bodyDirty}
          unsavedLabel={t("config.unsaved")}
          tokensLabel={t("config.tokens", { count: estimateTokens(body) })}
          ariaLabel={t("config.bodyLabel")}
        />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !dirty}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        <Button kind="secondary" onClick={reset} disabled={!dirty || update.isPending}>
          {t("config.cancel")}
        </Button>
        <span style={s.saveHint}>
          {bodyDirty
            ? t("config.snapshotHint", { version: skill.version + 1 })
            : update.isSuccess
              ? t("config.saved", { version: update.data?.version })
              : null}
        </span>
      </div>

      {/* Destructive action, below a rule and away from Save — deleting a skill
          unlinks it from every agent, so it must not sit next to the button a
          user presses repeatedly. */}
      <div style={s.danger}>
        <div style={s.dangerText}>
          <div style={s.dangerTitle}>{t("config.dangerTitle")}</div>
          <div style={s.dangerBody}>{t("config.dangerBody")}</div>
        </div>
        <Button kind="danger" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("config.dangerButton")}
        </Button>
      </div>
    </div>
  );
}

export default ConfigTab;
