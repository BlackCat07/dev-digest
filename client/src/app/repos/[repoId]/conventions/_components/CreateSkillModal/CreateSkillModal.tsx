/* CreateSkillModal — turn the accepted candidates into ONE skill.

   The body shown here is composed by the SERVER and previewed verbatim, so what
   the user reads is what gets saved. Rendering it in the browser would mean a
   second composer that drifts from the real one.

   There is no shape/mode control: which rules belong together is decided by which
   candidates the user accepts, not by a machine split on the category taxonomy.
   The per-category mode that used to live here was removed from the contract and
   the server too, so nothing can ask for it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { ExtractedConvention, Skill, SkillType } from "@devdigest/shared";
import { SKILL_TYPES, estimateTokens } from "@/lib/skill";
import {
  useConventionSkillPreview,
  useCreateConventionSkill,
} from "@/lib/hooks/conventions";
import { BodyPreview } from "./_components/BodyPreview";
import { DEFAULT_TYPE } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoFullName,
  accepted,
  onClose,
  onCreated,
}: {
  repoId: string;
  /** `acme/payments-api`; only its last segment is shown, as in the composed name. */
  repoFullName: string;
  /** Already filtered to `status === "accepted"` by the caller. */
  accepted: ExtractedConvention[];
  onClose: () => void;
  onCreated: (skills: Skill[]) => void;
}) {
  const t = useTranslations("conventions");
  // The four type labels already exist in the Skills Lab's namespace, and the
  // Skills Lab is where this skill lands — copying them into `conventions` would
  // be two lists to keep in step.
  const tSkills = useTranslations("skills");
  const create = useCreateConventionSkill(repoId);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [enabled, setEnabled] = React.useState(true);

  const candidateIds = React.useMemo(() => accepted.map((c) => c.id), [accepted]);

  // `type` and `enabled` are deliberately NOT in here: neither changes a single
  // byte of the composed body, and putting them in would refetch the preview on
  // every toggle.
  const composition = React.useMemo(
    () => ({
      candidate_ids: candidateIds,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    }),
    [candidateIds, name, description],
  );

  const { data: preview = [], error: previewError } = useConventionSkillPreview(
    repoId,
    composition,
  );
  // One call composes one skill; the endpoint's list shape is historical.
  const skill = preview[0];

  const submit = () => {
    create.mutate({ ...composition, type, enabled }, { onSuccess: onCreated });
  };

  return (
    <Modal
      width={760}
      title={t("create.title")}
      subtitle={skill?.name ?? ""}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.GitCommit size={12} style={s.footerIcon} />
            {t("create.savedNote")}
          </span>
          <Button kind="ghost" onClick={onClose} disabled={create.isPending}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            loading={create.isPending}
            disabled={create.isPending || !skill}
            onClick={submit}
          >
            {t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Wrench size={14} style={s.bannerIcon} />
          {/* `t.rich`, because two spans of this sentence carry meaning through
              their styling: the count is the fact being reported, and the repo
              name is the same blue as the icon because it is a repository — the
              colour the app uses for one everywhere else. */}
          <span>
            {t.rich("create.mergedFrom", {
              count: accepted.length,
              repo: repoSlug(repoFullName),
              strong: (chunks) => <strong style={s.bannerStrong}>{chunks}</strong>,
              repoName: (chunks) => (
                <span className="mono" style={s.bannerRepo}>
                  {chunks}
                </span>
              ),
            })}
          </span>
        </div>

        <FormField label={t("create.name")} required>
          <TextInput value={name} onChange={setName} mono placeholder={skill?.name ?? ""} />
        </FormField>

        <FormField label={t("create.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={skill?.description ?? ""}
          />
        </FormField>

        <div style={s.row}>
          <FormField label={t("create.type")}>
            <SelectInput
              value={type}
              mono={false}
              onChange={(value) => setType(value as SkillType)}
              options={SKILL_TYPES.map((value) => ({
                value,
                label: tSkills(`listItem.type.${value}`),
              }))}
            />
          </FormField>

          {/* The hint goes through FormField rather than beside the toggle, so it
              sits under the control the way the Type field's does. */}
          <FormField label={t("create.enabled")} hint={t("create.enabledHint")}>
            <div style={s.toggleSlot}>
              <Toggle on={enabled} onChange={setEnabled} />
            </div>
          </FormField>
        </div>

        <FormField label={t("create.body")} required>
          <div>
            {previewError && <div style={s.error}>{previewError.message}</div>}
            {skill && (
              <BodyPreview
                filename={`${skill.name}.md`}
                body={skill.body}
                unsavedLabel={t("create.unsaved")}
                tokensLabel={t("create.tokens", { count: estimateTokens(skill.body) })}
              />
            )}
          </div>
        </FormField>
      </div>
    </Modal>
  );
}

/** `acme/payments-api` → `payments-api`, the way the server names the skill. */
function repoSlug(fullName: string): string {
  return fullName.split("/").pop() || fullName;
}

export default CreateSkillModal;
