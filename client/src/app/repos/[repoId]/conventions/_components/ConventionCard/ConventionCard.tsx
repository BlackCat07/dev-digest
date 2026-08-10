/* ConventionCard — one extracted candidate: the rule, its verified evidence,
   the measured confidence, and the accept/reject controls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { ExtractedConvention } from "@devdigest/shared";
import {
  CONVENTION_CATEGORY_COLOR,
  adherenceTotals,
  confidenceColor,
  toPercent,
} from "@/lib/conventions";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  sha,
  busy,
  onAccept,
  onReject,
  onEdit,
}: {
  candidate: ExtractedConvention;
  repoFullName: string;
  /** The commit the scan pinned to. Null when unknown — links are then omitted. */
  sha: string | null;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (patch: { rule: string; rationale: string }) => void;
}) {
  const t = useTranslations("conventions");
  const [expanded, setExpanded] = React.useState(false);
  // Editing lives in the content column as an action on the text, not in the
  // side rail — that rail carries exactly the two triage decisions, and the
  // card test pins it that way.
  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState("");
  const [draftRationale, setDraftRationale] = React.useState("");

  const accent = CONVENTION_CATEGORY_COLOR[candidate.category];
  const percent = toPercent(candidate.confidence);
  const shown = expanded ? candidate.evidence : candidate.evidence.slice(0, 1);
  const hidden = candidate.evidence.length - shown.length;

  const startEdit = () => {
    setDraftRule(candidate.rule);
    setDraftRationale(candidate.rationale ?? "");
    setEditing(true);
  };
  const saveEdit = () => {
    onEdit({ rule: draftRule.trim(), rationale: draftRationale.trim() });
    setEditing(false);
  };

  return (
    <div style={s.card(candidate.status, accent)}>
      <div style={s.main}>
        <div style={s.headerRow}>
          <span style={s.categoryBadge(accent)}>{t(`category.${candidate.category}`)}</span>
          {candidate.edited && <span style={s.editedNote}>{t("card.editedNote")}</span>}
        </div>

        {editing ? (
          <div style={s.editBlock}>
            <textarea
              aria-label={t("card.ruleLabel")}
              style={s.editRule}
              rows={2}
              value={draftRule}
              onChange={(e) => setDraftRule(e.target.value)}
            />
            <textarea
              aria-label={t("card.rationaleLabel")}
              style={s.editRationale}
              rows={3}
              value={draftRationale}
              onChange={(e) => setDraftRationale(e.target.value)}
            />
            <div style={s.editActions}>
              <Button
                kind="primary"
                icon="Check"
                onClick={saveEdit}
                disabled={busy || draftRule.trim().length === 0}
              >
                {t("card.save")}
              </Button>
              <Button kind="ghost" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div style={s.rule}>{candidate.rule}</div>
            {candidate.rationale && <div style={s.rationale}>{candidate.rationale}</div>}
          </>
        )}

        {shown.map((evidence) => {
          // Every citation was verified against the clone at `sha`, and its line
          // numbers were corrected to where the snippet actually is — so this
          // link lands on the right lines rather than near them.
          const href = sha
            ? githubBlobUrl(
                repoFullName,
                sha,
                evidence.path,
                evidence.start_line,
                evidence.end_line,
              )
            : null;
          const location = `${evidence.path}:${evidence.start_line}-${evidence.end_line}`;

          return (
            <div key={`${evidence.path}:${evidence.start_line}`} style={s.evidence}>
              <div style={s.evidenceHead}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                    style={s.evidencePath}
                    title={t("card.openOnGitHub")}
                  >
                    {location}
                    <Icon.ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono" style={s.evidencePath}>
                    {location}
                  </span>
                )}
                {evidence.match !== "exact" && (
                  <span style={s.matchNote}>
                    {evidence.match === "shifted"
                      ? t("card.matchShifted")
                      : t("card.matchMoved")}
                  </span>
                )}
                <CopySnippet snippet={evidence.snippet} />
              </div>
              <pre className="mono" style={s.snippet}>
                {evidence.snippet}
              </pre>
            </div>
          );
        })}

        {hidden > 0 && (
          <button type="button" style={s.moreEvidence} onClick={() => setExpanded(true)}>
            {t("card.moreEvidence", { count: hidden })}
          </button>
        )}

        {/* Confidence closes the card, under the evidence it was derived from —
            the number reads as a conclusion drawn from what is above it rather
            than as a property of the buttons beside it. */}
        <div style={s.confidenceBlock}>
          <div style={s.confidenceRow}>
            <span>{t("card.confidence")}</span>
            <div style={s.track}>
              <div style={s.fill(percent, confidenceColor(candidate.confidence))} />
            </div>
            <span>{percent}%</span>
          </div>
          {/* The sentence under the bar is what separates a counted figure from
              the model's opinion of itself. Without it both render as a bar. */}
          <div style={s.adherence}>
            {candidate.adherence
              ? t("card.measured", adherenceTotals(candidate.adherence))
              : t("card.unmeasured")}
          </div>
        </div>
      </div>

      <div style={s.side}>
        <Button
          kind={candidate.status === "accepted" ? "primary" : "secondary"}
          icon="Check"
          full
          onClick={onAccept}
          disabled={busy}
        >
          {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind={candidate.status === "rejected" ? "secondary" : "ghost"}
          icon="X"
          full
          onClick={onReject}
          disabled={busy}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
        <Button
          kind="ghost"
          icon="Edit"
          full
          onClick={startEdit}
          disabled={busy || editing}
        >
          {t("card.edit")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Copies one citation's code to the clipboard.
 *
 * Its own component so the "copied" flash is per-citation: a single flag on the
 * card would light up every evidence block at once once a card is expanded.
 */
function CopySnippet({ snippet }: { snippet: string }) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);
  const label = copied ? t("card.copied") : t("card.copySnippet");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      style={s.copyBtn(copied)}
      onClick={() => {
        // Optional-chained: jsdom and non-secure origins have no clipboard, and
        // a missing one must not throw inside the card.
        void navigator.clipboard?.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
    </button>
  );
}

export default ConventionCard;
