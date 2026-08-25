/* Preview — every file that WOULD be committed, read-only.

   No input and no editor is rendered for any of them (N10, AC-54): a file's
   contents open into a `<pre>`, and `CiFile.editable` arrives `false` for every
   entry the server generates. The disclosure is state-driven rather than a
   `<details>` so the runner bundle's ~hundreds of KB are not put into the DOM
   until somebody asks for them.

   A generation failure renders INLINE here (AC-56) and takes nothing else down:
   the repository the user typed lives in the wizard above, so Back still shows
   it filled in. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SectionLabel, Skeleton } from "@devdigest/ui";
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

  return (
    <div>
      <SectionLabel
        right={
          <Badge icon="Lock" color="var(--text-muted)">
            {t("exportWizard.readOnly")}
          </Badge>
        }
      >
        {t("exportWizard.filesToCreate")}
      </SectionLabel>
      <ul style={s.fileList}>
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="mono"
              style={s.fileRow}
              aria-expanded={open === f.path}
              onClick={() => setOpen((cur) => (cur === f.path ? null : f.path))}
            >
              {f.path}
              <span style={s.fileSize}>{formatFileSize(f.contents)}</span>
            </button>
            {open === f.path && (
              <pre className="mono" style={s.filePre}>
                {f.contents}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
