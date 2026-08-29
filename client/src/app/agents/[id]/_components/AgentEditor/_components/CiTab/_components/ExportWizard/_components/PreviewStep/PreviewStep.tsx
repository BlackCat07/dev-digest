/* Preview — every file that WOULD be committed, read-only.

   Two panes: the file list on the left, the selected file's contents on the
   right. The first file is selected on arrival, so the step opens showing
   something rather than an empty rectangle beside a list.

   READ-ONLY, and the chip says so (N10, AC-54). The design this layout follows
   drew an "editable" chip in that corner; `CiFile.editable` arrives `false` for
   every file the server generates, so the chip states the truth instead. When one
   file becomes editable the chip is already per-file and the pane is already the
   place an editor would go — which is the seam N10 promised to leave intact.

   `open` holds a PATH, not an index: the list re-sorts if the generator's order
   changes, and an index would then point at a different file than the one
   highlighted.

   A generation failure renders INLINE here (AC-56) and takes nothing else down. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { s } from "../../../../styles";
import { formatFileSize } from "../../../../helpers";

export function PreviewStep({
  files,
  isPending,
  error,
}: {
  files: readonly CiFile[];
  isPending: boolean;
  error: Error | null;
}) {
  const t = useTranslations("ci");
  const [open, setOpen] = React.useState<string | null>(null);

  if (isPending) {
    return (
      <div>
        <SectionLabel>{t("exportWizard.generating")}</SectionLabel>
        <div style={s.fileList}>
          <Skeleton height={34} />
          <Skeleton height={34} />
          <Skeleton height={34} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={s.inlineError}>
        <span style={s.inlineErrorTitle}>{t("exportWizard.previewFailed")}</span>
        <span style={s.inlineErrorBody}>{error.message}</span>
      </div>
    );
  }

  // Derived, not stored: `open` is only ever a user's pick, so a regenerated file
  // set cannot leave the pane pointing at a path that is no longer in the list.
  const selected = files.find((f) => f.path === open) ?? files[0] ?? null;

  return (
    <div style={s.previewSplit}>
      <div style={s.previewListPane}>
        <SectionLabel>{t("exportWizard.filesToCreate")}</SectionLabel>
        <ul style={s.fileList}>
          {files.map((f) => {
            const isOpen = selected?.path === f.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  className="mono"
                  style={isOpen ? s.previewFileRowOn : s.previewFileRow}
                  aria-current={isOpen}
                  onClick={() => setOpen(f.path)}
                >
                  <Icon.File size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={s.previewFileName}>{f.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && (
        <div style={s.previewPane}>
          <div style={s.previewPaneHead}>
            <span className="mono" style={s.previewPanePath}>
              {selected.path}
            </span>
            <Badge icon="Lock" color="var(--text-muted)">
              {t("exportWizard.readOnly")}
            </Badge>
          </div>
          <pre className="mono" style={s.filePre}>
            {selected.contents}
          </pre>
          <div style={s.previewPaneFoot}>{formatFileSize(selected.contents)}</div>
        </div>
      )}
    </div>
  );
}
