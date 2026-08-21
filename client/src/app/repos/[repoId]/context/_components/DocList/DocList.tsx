/* DocList — the discovered documents, grouped by the root each was found
   under, one selectable row apiece.

   Read-only by construction: a row is a selection control and nothing else.
   AC-35 forbids any control on this screen that writes to the repository, and
   the cheapest way to honour a prohibition is to give the component no write
   affordance to render in the first place — there is no `onRename`, no
   `onDelete` and no upload target in these props. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ProjectDoc } from "@devdigest/shared";
import type { ContextDocGroup } from "@/lib/context-docs";
import { s } from "./styles";

export function DocList({
  groups,
  selectedPath,
  onSelect,
}: {
  groups: readonly ContextDocGroup[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");

  return (
    <div style={s.root}>
      {groups.map((group) => (
        <section key={group.root} style={s.group}>
          <h2 style={s.groupLabel}>
            {t("row.group", { root: group.root, count: group.docs.length })}
          </h2>
          {group.docs.map((doc) => (
            <DocRow
              key={doc.path}
              doc={doc}
              selected={doc.path === selectedPath}
              onSelect={onSelect}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * One document row.
 *
 * A real `<button>`, not a clickable div: the row is the only interactive thing
 * in the list and it has to be reachable by keyboard. `aria-current` rather
 * than `aria-pressed` — selecting a row does not toggle a setting, it says
 * which document the preview beside it is showing.
 */
function DocRow({
  doc,
  selected,
  onSelect,
}: {
  doc: ProjectDoc;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const t = useTranslations("context");

  return (
    <button
      type="button"
      style={s.row(selected)}
      aria-current={selected ? "true" : undefined}
      aria-label={t("row.select", { path: doc.path })}
      onClick={() => onSelect(doc.path)}
    >
      {/* One file mark for every row, not a per-type badge. The document type
          is DERIVED from the root (`classifyDoc` in the server's service), so a
          badge repeats the group heading the row already sits under — and the
          list reads as a file tree, which is what it is. `aria-hidden` because
          it says nothing the row's own label does not. */}
      <Icon.FileText size={14} style={s.icon(selected)} aria-hidden />
      <span className="mono" style={s.path}>
        {doc.path}
      </span>
      <span className="tnum" style={s.meta}>
        {t("row.tokens", { count: doc.tokens })}
      </span>
    </button>
  );
}

export default DocList;
