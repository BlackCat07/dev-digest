/* Versions tab — the immutable body snapshots behind this skill, newest first.
   Restore writes the old body back as a NEW version rather than rewinding, so
   the history stays append-only and a past run's text is never rewritten. */
"use client";

import React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { versionLabel } from "./helpers";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("skills");
  const format = useFormatter();
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={72} />
        <Skeleton height={72} />
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }

  const restore = (version: number, body: string) => {
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    update.mutate(
      { id: skill.id, patch: { body } },
      {
        onSuccess: (updated) =>
          toast.success(t("versions.restored", { from: version, to: updated.version })),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: data.length })}</Badge>
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      {data.map((v) => {
        const current = v.version === skill.version;
        return (
          <div key={v.version} style={s.row(current)}>
            <span className="mono" style={s.versionChip}>
              {t("versions.label", { version: v.version })}
            </span>
            <div style={s.meta}>
              <div style={s.excerpt}>
                {versionLabel(v.body, t("versions.label", { version: v.version }))}
              </div>
              <div style={s.date}>
                {format.dateTime(new Date(v.created_at), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            </div>
            <div style={s.actions}>
              {current ? (
                <Badge color="var(--ok)" dot>
                  {t("versions.current")}
                </Badge>
              ) : (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="RefreshCw"
                  onClick={() => restore(v.version, v.body)}
                  disabled={update.isPending}
                >
                  {t("versions.restore")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default VersionsTab;
