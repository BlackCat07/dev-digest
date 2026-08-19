/* DocPreview — the selected document: what it is, who uses it, and its text
   rendered as a document.

   Preview is the ONLY mode. AC-35 makes that a requirement rather than a
   staging decision, and the reason is in `specs/project-context.md`'s
   non-goals: the clone this text comes from is a mirror, and the resync that
   keeps it current is a `git reset --hard` (`server/INSIGHTS.md`, 2026-08-18).
   A Save button here would have its work deleted by an unrelated button
   elsewhere, silently. So there is no edit mode, no save, and no upload — the
   `mode.edit` and `editor.save` keys in `messages/en/context.json` stay
   deliberately unread. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ProjectDoc } from "@devdigest/shared";
import { useProjectDoc } from "@/lib/hooks/project-context";
import { formatAge } from "@/lib/format";
import { DocumentMarkdown } from "../DocumentMarkdown";
import { s } from "./styles";

export function DocPreview({
  repoId,
  doc,
}: {
  repoId: string;
  doc: ProjectDoc | null;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useProjectDoc(repoId, doc?.path ?? null);

  if (!doc) {
    return (
      <div style={s.empty}>
        <EmptyState icon="FileText" title={t("preview.none.title")} body={t("preview.none.body")} />
      </div>
    );
  }

  return (
    <div style={s.pane}>
      <div style={s.head}>
        <span className="mono" style={s.path}>
          {doc.path}
        </span>
        {/* AC-37: the figure is the entry's own `used_by_agents`, so it counts
            every agent that would notice this document's removal — including
            one reaching it through a disabled skill. */}
        <span style={s.meta}>{t("preview.usedBy", { count: doc.used_by_agents })}</span>
        <span style={s.meta}>
          {doc.updated_at ? t("preview.updated", { age: formatAge(doc.updated_at) }) : t("preview.updatedUnknown")}
        </span>
      </div>

      <div style={s.body}>
        <div style={s.bodyInner}>
          {isLoading ? (
            <>
              <Skeleton height={16} width="45%" />
              <div style={{ height: 12 }} />
              <Skeleton height={12} />
              <div style={{ height: 8 }} />
              <Skeleton height={12} width="80%" />
            </>
          ) : isError ? (
            <ErrorState title={t("preview.loadError")} />
          ) : data?.content ? (
            <DocumentMarkdown>{data.content}</DocumentMarkdown>
          ) : (
            // A 200 with no content is the server's REFUSAL value — the document
            // vanished from the clone between the list and the click, or the
            // confinement check rejected it. It is not an error and must not
            // render as one.
            <div style={s.meta}>{t("preview.emptyBody")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DocPreview;
