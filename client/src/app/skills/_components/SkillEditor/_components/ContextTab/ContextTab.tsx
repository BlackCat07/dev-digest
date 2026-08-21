/* Context tab — the project documents this skill contributes to every agent
   that links it.

   The write is the same replace-all contract the agent tab uses: attach,
   detach and reorder are one POST carrying the WHOLE ordered path array. There
   is no diff to compute and no partial update to reconcile against a stale
   order, and the corollary is the trap — a toggle must send every path that is
   still attached, because sending only the toggled one detaches the rest with a
   200 and a successful invalidation to say so.

   Reordering here is buttons, not drag-and-drop. A skill's set is short, it is
   read by every agent linking the skill rather than edited in place next to a
   preview, and a pair of focusable Move buttons is operable from the keyboard
   without inventing a second convention.

   The serialization preview names the block `## Project context` — the heading
   `reviewer-core/src/prompt.ts` actually emits. The design mock says
   `## Project specifications`; the design is the thing being corrected here,
   because the engine is not changed and a preview that named a heading no run
   produces would be a lie about the prompt.

   The repository is the shell's active one (`useActiveRepo`), the same source
   the Project Context screen and the agent tab read. An attachment is scoped to
   a repository, so without one there is nothing to list and nothing to write. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SkillWithUsage } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useProjectDocs,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "@/lib/hooks/project-context";
import { attachedPathsFor, move } from "@/lib/context-docs";
import { contextRows } from "./helpers";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: SkillWithUsage }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();

  const docsQuery = useProjectDocs(repoId);
  const attachments = useSkillContextDocs(skill.id);
  const setDocs = useSetSkillContextDocs();

  // `?? []` inside the memo, not outside: a fresh [] on every render changes the
  // dependency identity every time and defeats every memo below it.
  const docs = React.useMemo(() => docsQuery.data?.docs ?? [], [docsQuery.data]);
  const attachedPaths = React.useMemo(
    () => attachedPathsFor(attachments.data ?? [], repoId),
    [attachments.data, repoId],
  );

  // Derived during render, never mirrored into state: the rows and the badge
  // move the moment a write lands, with nothing to keep in sync.
  const rows = contextRows(attachedPaths, docs);

  const commit = (paths: string[]) => {
    if (!repoId) return;
    setDocs.mutate({ skillId: skill.id, repo_id: repoId, paths });
  };

  /** Attach or detach one document, sending every path that is still attached. */
  const toggle = (path: string) =>
    commit(
      attachedPaths.includes(path)
        ? attachedPaths.filter((p) => p !== path)
        : [...attachedPaths, path],
    );

  /** Move an attached document one position; the order is what a run obeys. */
  const moveBy = (path: string, delta: number) => {
    const from = attachedPaths.indexOf(path);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= attachedPaths.length) return;
    commit(move(attachedPaths, from, to));
  };

  if (docsQuery.isLoading || attachments.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (docsQuery.isError || attachments.isError) {
    return (
      <ErrorState
        body={t("skillTab.loadError")}
        onRetry={() => {
          void docsQuery.refetch();
          void attachments.refetch();
        }}
      />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skillTab.heading")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skillTab.badge", { attached: attachedPaths.length, discovered: docs.length })}
        </Badge>
      </div>

      <p style={s.hint}>{t("skillTab.hint")}</p>

      {rows.length === 0 ? (
        <EmptyState
          icon="FileText"
          title={t("skillTab.empty.title")}
          body={t("skillTab.empty.body")}
        />
      ) : (
        <ul style={s.list}>
          {rows.map((row) => {
            const attached = row.kind === "attached";
            const position = attached ? attachedPaths.indexOf(row.path) : -1;

            return (
              <li key={row.path} style={s.row(attached)}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={attached}
                  aria-label={t("skillTab.toggle", { path: row.path })}
                  onClick={() => toggle(row.path)}
                  disabled={setDocs.isPending || !repoId}
                  style={s.checkbox(attached)}
                >
                  {attached && <Icon.Check size={11} style={s.checkIcon} />}
                </button>

                <span className="mono" style={s.path}>
                  {row.path}
                </span>
                <span className="tnum" style={s.tokens}>
                  {t("row.tokens", { count: row.doc?.tokens ?? 0 })}
                </span>

                {attached && (
                  <>
                    <button
                      type="button"
                      style={s.move}
                      aria-label={t("skillTab.moveUp", { path: row.path })}
                      disabled={position <= 0}
                      onClick={() => moveBy(row.path, -1)}
                    >
                      <Icon.ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      style={s.move}
                      aria-label={t("skillTab.moveDown", { path: row.path })}
                      disabled={position < 0 || position >= attachedPaths.length - 1}
                      onClick={() => moveBy(row.path, 1)}
                    >
                      <Icon.ArrowDown size={12} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Only when something is attached: the engine emits the heading solely
          when the block has content, so a preview showing it over an empty set
          would name a heading no run produces. */}
      {attachedPaths.length > 0 && (
        <section style={s.preview}>
          <h3 style={s.h3}>{t("skillTab.previewHeading")}</h3>
          <p style={s.hint}>{t("skillTab.previewNote")}</p>
          <pre className="mono" style={s.previewBlock}>
            {[t("skillTab.blockLabel"), "", ...attachedPaths].join("\n")}
          </pre>
        </section>
      )}
    </div>
  );
}

export default ContextTab;
