/* ImportSkillDrawer — create a skill from a local .md file.

   The file is read in the BROWSER (FileReader) and its text posted as JSON.
   Nothing is uploaded and nothing is fetched server-side: `apiFetch` only sends
   JSON bodies, and a skill is text, so a multipart path would buy nothing and
   cost a new content-type branch in the one place the app calls fetch.

   Import from URL and the community catalog are non-goals for L02 — their copy
   exists in `messages/en/skills.json` for the lesson that builds them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, TextInput, Textarea } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useImportSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { estimateTokens } from "@/lib/skill";
import { SkillBody } from "../SkillBody";
import { ACCEPTED_EXTENSIONS } from "./constants";
import { s } from "./styles";

export function ImportSkillDrawer({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const importSkill = useImportSkill();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [readError, setReadError] = React.useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    const reader = new FileReader();
    reader.onerror = () => setReadError(t("drawer.importFailed"));
    reader.onload = () => {
      setBody(String(reader.result ?? ""));
      // Only prefill the name from the filename when the user has not typed one;
      // the server still derives it from the first heading if both are blank.
      setName((prev) => prev || file.name.replace(/\.mdx?$/i, ""));
    };
    reader.readAsText(file);
  };

  const submit = () => {
    importSkill.mutate(
      { body, ...(name.trim() ? { name: name.trim() } : {}) },
      {
        onSuccess: (skill) => {
          toast.success(t("file.success", { name: skill.name }));
          onImported(skill);
        },
      },
    );
  };

  return (
    <Drawer
      width={720}
      title={t("drawer.title")}
      subtitle={t("file.bodyHint")}
      onClose={onClose}
      footer={
        <Button
          kind="primary"
          icon="Upload"
          onClick={submit}
          disabled={body.trim().length === 0 || importSkill.isPending}
        >
          {importSkill.isPending ? t("file.importing") : t("file.import")}
        </Button>
      }
    >
      <div style={s.wrap}>
        <FormField label={t("drawer.tabs.file")}>
          <div style={s.fileRow}>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={(e) => pick(e.target.files?.[0])}
              style={s.fileInput}
              aria-label={t("drawer.tabs.file")}
            />
            <Button kind="secondary" size="sm" icon="Upload" onClick={() => fileRef.current?.click()}>
              {t("page.menu.fromFile")}
            </Button>
          </div>
        </FormField>
        {readError && <div style={s.error}>{readError}</div>}

        <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
          <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} mono />
        </FormField>

        <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
          <Textarea
            value={body}
            onChange={setBody}
            rows={12}
            mono
            placeholder={t("file.bodyPlaceholder")}
          />
        </FormField>

        {body.trim().length > 0 && (
          <div>
            {/* The whole point of importing through a preview: you read the text
                before it can ever reach a prompt. It also lands disabled. */}
            <div style={s.previewHead}>
              <span>{t("previewTab.title")}</span>
              <span style={s.tokens}>{t("config.tokens", { count: estimateTokens(body) })}</span>
            </div>
            <div style={s.previewCard}>
              <SkillBody>{body}</SkillBody>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default ImportSkillDrawer;
