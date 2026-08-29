/* Install — what is about to happen, then what happened.

   The heading, the file count, the target repository and the secret note are
   AC-59's four statements. The pull-request TITLE inside `installCardBody` is
   the contract's `CI_EXPORT_PR_TITLE`, authored into the catalogue so the
   sentence the user agrees to and the pull request they get cannot drift apart —
   the server interpolates the same constant.

   DevDigest never reads, stores, forwards or displays the value of
   `OPENROUTER_API_KEY` (N15). Only its NAME appears here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { isHttpUrl } from "@/lib/ci";
import { CI_MODEL_KEY_ENV } from "../../../../constants";
import { s } from "../../../../styles";

export function InstallStep({
  repo,
  fileCount,
  installed,
  prUrl,
  error,
}: {
  repo: string;
  fileCount: number;
  /** The export SUCCEEDED. Separate from `prUrl`, which the server may return null. */
  installed: boolean;
  prUrl: string | null;
  error: Error | null;
}) {
  const t = useTranslations("ci");
  return (
    <>
      <div>
        <div style={s.installHeading}>{t("exportWizard.installCardTitle")}</div>
        {/* The repository is named ONCE, inside the sentence. It used to be
            repeated as a bare mono line underneath, which read as a second,
            different fact rather than as the same one restated. */}
        <div style={s.installBody}>{t("exportWizard.installCardBody", { repo, count: fileCount })}</div>
      </div>
      {/* TWO different credentials, and conflating them costs a failed export.
          `secretNote` is about a secret the USER adds to the target repository,
          which DevDigest never reads (N15). `tokenNote` is about the token
          DevDigest itself commits with — and it names Workflows explicitly
          because a token with Contents and Pull requests still gets a 403 on
          `POST /git/trees`, whose message says only "Resource not accessible by
          personal access token" and never which permission is missing. */}
      <div style={s.note}>
        <Icon.Shield size={15} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
        <div style={s.noteBody}>{t("exportWizard.tokenNote")}</div>
      </div>
      <div style={s.note}>
        <Icon.Lock size={15} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
        <div style={s.noteBody}>{t("exportWizard.secretNote", { key: CI_MODEL_KEY_ENV })}</div>
      </div>
      {error && (
        <div role="alert" style={s.inlineError}>
          <span style={s.inlineErrorTitle}>{t("exportWizard.installFailed")}</span>
          <span style={s.inlineErrorBody}>{error.message}</span>
        </div>
      )}
      {installed && (
        <div style={s.okRow}>
          <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
          <span style={s.okTitle}>{t("exportWizard.installedTitle")}</span>
          {isHttpUrl(prUrl) && (
            <a
              href={prUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: "var(--accent-text)" }}
            >
              {t("exportWizard.viewPr")}
            </a>
          )}
        </div>
      )}
    </>
  );
}
