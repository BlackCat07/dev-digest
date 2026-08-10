/* SkillsWorkbench — /skills/:id. A searchable rail of SkillCards on the left, the
   selected skill's editor on the right, so switching between skills costs one
   click and never leaves the editor.

   The rail is deliberately NOT the landing screen: /skills renders SkillsListView
   (a full-width grid, matching the Agents list) so the first thing a user sees is
   their skills, not a mostly-empty editor pane. `id` is therefore required here —
   this route always has one. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { filterSkills } from "@/lib/skill";
import { SkillCard } from "../SkillCard";
import { SkillEditor } from "../SkillEditor";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

export function SkillsWorkbench({ id }: { id: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const list = filterSkills(skills ?? [], search);
  const selected = (skills ?? []).find((sk) => sk.id === id);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills"), href: "/skills" }];

  return (
    <AppShell crumb={crumb}>
      {importing && (
        <ImportSkillDrawer
          onClose={() => setImporting(false)}
          onImported={(skill) => {
            setImporting(false);
            router.push(`/skills/${skill.id}?tab=preview`);
          }}
        />
      )}
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={(skill) => {
            setCreating(false);
            router.push(`/skills/${skill.id}?tab=config`);
          }}
        />
      )}

      <div style={s.shell}>
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>
            <div style={s.sidebarTitleRow}>
              <h1 style={s.sidebarTitle}>{t("page.heading")}</h1>
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
                  { divider: true },
                  {
                    label: t("page.menu.fromFile"),
                    icon: "Upload",
                    onClick: () => setImporting(true),
                  },
                ]}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                aria-label={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          {isLoading && (
            <div style={s.listStates}>
              <Skeleton height={104} />
              <Skeleton height={104} />
              <Skeleton height={104} />
            </div>
          )}
          {isError && (
            <div style={s.listStates}>
              <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
            </div>
          )}
          {!isLoading && !isError && list.length === 0 && (
            <div style={s.listStates}>
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.ctaCreate")}
                onCta={() => setCreating(true)}
              />
            </div>
          )}
          {list.length > 0 && (
            <div style={s.list}>
              {list.map((sk) => (
                <SkillCard
                  key={sk.id}
                  skill={sk}
                  active={sk.id === id}
                  onClick={() => router.push(`/skills/${sk.id}?tab=config`)}
                  onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                />
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div style={s.editorSkeleton}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : !selected ? (
          // The rail loaded and this id is not in it — deleted, or someone else's.
          <div style={s.placeholder}>
            <EmptyState
              icon="Sparkles"
              title={t("detail.notFound.title")}
              body={t("detail.notFound.body")}
              cta={t("detail.back")}
              onCta={() => router.push("/skills")}
            />
          </div>
        ) : (
          <div style={s.pane}>
            <SkillEditor skill={selected} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default SkillsWorkbench;
