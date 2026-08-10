/* CreateSkillModal — name a new hand-written skill and open it in the editor.

   Only the name is asked for here. The body belongs in the Config tab's editor,
   which has the token counter and the unsaved indicator; duplicating a textarea
   in the modal would mean two places to write the same field. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPES } from "@/lib/skill";
import { DEFAULT_NEW_TYPE, STARTER_BODY } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_NEW_TYPE);

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      type,
      body: STARTER_BODY,
    });
    onCreated(skill);
  };

  return (
    <Modal
      width={560}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="primary" icon="Check" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
          <Button kind="secondary" onClick={onClose}>
            {t("create.cancel")}
          </Button>
        </div>
      }
    >
      <div style={s.wrap}>
        <FormField label={t("config.name")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("file.namePlaceholder")}
            mono
          />
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
      </div>
    </Modal>
  );
}

export default CreateSkillModal;
