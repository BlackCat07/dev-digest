/* TourSection — one section of the Onboarding Tour.

   PROP-DRIVEN AND PRESENTATIONAL, like `BlastRadiusCard` beside it on the PR screen:
   it calls no data hook and no `fetch`, so it mounts with `NextIntlClientProvider`
   alone. `OnboardingView` owns the tour query and hands each section down.

   Three things this card exists to get right, each of which has a wrong version that
   looks fine until it ships:

   1. The body is a DOCUMENT. It goes through `@/components/document-markdown`, never
      `<Markdown>` from `@devdigest/ui` — that primitive maps p/strong/code/a and
      nothing else, so headings, lists and fenced blocks collapse into one
      undifferentiated wall of text under the app's reset (`client/INSIGHTS.md`,
      2026-08-05). Promoting that renderer to `src/components/` is the whole reason it
      is reachable from here.
   2. A diagram that cannot be drawn must not take the section down with it. The
      diagram is rendered with a `fallback`, so an unparseable one leaves the body,
      the rows and the links exactly where they were with an inline notice in the
      diagram's place — the failure mode of EC-12, where an unquoted `/` in a node
      label passes the renderer's own regex and is then rejected by `mermaid.parse`.
   3. Every control is a real focusable element with an accessible name. Copy is a
      `<button>`, `Open` is an `<a>`; neither is a `div` with an `onClick`. Their
      keyboard activation is therefore the browser's, which is the accessible design
      and the one this package's tests can rely on — note that jsdom synthesizes no
      click for Enter on a focused native button and `user-event` is not a dependency
      here (`client/INSIGHTS.md`, 2026-08-19), so a test asserts reachability and the
      accessible name, and dispatches activation separately.

   Nothing here is ever executed. A command is text with the file that declares it
   beside it, so the reader can check it against its source before pasting it into
   their own shell (AC-22, N10, US-9). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { DocumentMarkdown } from "@/components/document-markdown";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { tourFileUrl } from "@/lib/onboarding";
import type { OnboardingTourSection } from "@devdigest/shared";
import { sectionHeadingId } from "./helpers";
import { s } from "./styles";

export interface TourSectionProps {
  /** One section of a stored tour, rendered as the server returned it. */
  section: OnboardingTourSection;
  /** `owner/name`, for the links out to the repository host. Null while the repo is unknown. */
  repoFullName: string | null | undefined;
  /**
   * The tour's OWN recorded commit, not the repository's current head.
   *
   * Null on a tour generated with no index, and then no row renders an `Open`
   * control at all: a link pinned to a branch would open code this tour never read
   * (AC-47, EC-20).
   */
  indexedSha: string | null | undefined;
}

export function TourSection({ section, repoFullName, indexedSha }: TourSectionProps) {
  const t = useTranslations("onboarding");

  const headingId = sectionHeadingId(section.kind);
  // The server's title wins; the catalogue's is the fallback for a section stored
  // without one — a degraded skeleton is the case that has none.
  const title = section.title.trim() || t(`sectionTitle.${section.kind}`);
  // EC-13: a model that answers `""` rather than `null` for "no diagram" must not
  // reach the renderer, or every such section grows an unavailable notice for a
  // diagram nobody claimed existed.
  const diagram = section.diagram?.trim() ? section.diagram : null;

  // Derived, never stored: one href per row, and whether ANY of them resolved. The
  // second is what decides the "no commit recorded" line, so the rule that a link
  // needs both a repo name and a SHA lives in `tourFileUrl` and is not restated here.
  const pathRows = section.paths.map((note) => ({
    note,
    href: tourFileUrl(repoFullName, indexedSha, note.path),
  }));
  const linkable = pathRows.some((row) => row.href !== null);

  return (
    <section aria-labelledby={headingId} style={s.card}>
      <h2 id={headingId} style={s.heading}>
        {title}
      </h2>

      <DocumentMarkdown>{section.body}</DocumentMarkdown>

      {diagram && (
        <MermaidDiagram
          chart={diagram}
          fallback={
            <p style={s.notice}>
              <Icon.Info size={14} />
              {t("diagram.unavailable")}
            </p>
          }
        />
      )}

      {section.commands.length > 0 && (
        <div style={s.group}>
          <div style={s.subLabel}>{t("command.label")}</div>
          <ul style={s.rows}>
            {section.commands.map((command, i) => (
              /* Keyed on the command AND its position: `order` is the server's, but two
                 identical invocations declared in two files are a shape the contract
                 permits, and a duplicate key silently drops a row. The list is a static
                 prop that is never reordered or filtered here, so the index is stable. */
              <li key={`${command.command}:${i}`} style={s.row}>
                <div style={s.rowBody}>
                  <code className="mono" style={s.command}>
                    {command.command}
                  </code>
                  <span style={s.rowNote}>{t("command.declaredIn", { file: command.file })}</span>
                </div>
                <CopyCommand command={command.command} />
              </li>
            ))}
          </ul>
          <p style={s.hint}>{t("command.notRun")}</p>
        </div>
      )}

      {/* An honest empty state, and only on the section it is about: `run_locally` with
          no commands is a true finding about the repository (`no_commands_declared`),
          not a rendering gap. */}
      {section.kind === "run_locally" && section.commands.length === 0 && (
        <p style={s.hint}>{t("command.none")}</p>
      )}

      {pathRows.length > 0 && (
        <div style={s.group}>
          {/* An ordered list, because both sections that use this row shape are about
              sequence — a reading order (US-4) and a dependency chain. */}
          <ol style={s.rows}>
            {pathRows.map(({ note, href }, i) => (
              <li key={`${note.path}:${i}`} style={s.row}>
                <span style={s.ordinal}>{i + 1}.</span>
                <div style={s.rowBody}>
                  <span style={s.mono}>{note.path}</span>
                  <span style={s.rowNote}>{note.reason}</span>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={t("path.openLabel", { path: note.path })}
                    style={s.openLink}
                  >
                    {t("path.open")}
                    <Icon.ExternalLink size={12} />
                  </a>
                )}
              </li>
            ))}
          </ol>
          {!linkable && <p style={s.hint}>{t("path.unavailable")}</p>}
        </div>
      )}

      {section.tasks.length > 0 && (
        <div style={s.group}>
          <div style={s.subLabel}>{t("task.label")}</div>
          <ul style={s.rows}>
            {section.tasks.map((task, i) => (
              <li key={`${task.title}:${i}`} style={s.row}>
                <div style={s.rowBody}>
                  <span style={s.rowNote}>{task.title}</span>
                  <span style={s.mono}>{task.path}</span>
                </div>
                {/* The level is the WORD, in the badge's own text — "Complexity: Low"
                    reads the same to a screen reader as to an eye that cannot tell the
                    green from the red. */}
                <span style={s.complexity(task.complexity)}>
                  {t("task.complexityLabel", { level: t(`task.complexity.${task.complexity}`) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rendered as given: the cap on how many links a section carries is enforced
          where the tour is assembled, not on the way out (see the contract's note on
          `links`). Dropping a fifth one here would hide it from the only reader who
          could report it. */}
      {section.links.length > 0 && (
        <div style={s.group}>
          <div style={s.subLabel}>{t("links.label")}</div>
          <ul style={s.rows}>
            {section.links.map((link, i) => {
              const href = tourFileUrl(repoFullName, indexedSha, link.path);
              return (
                <li key={`${link.path}:${i}`} style={s.row}>
                  <div style={s.rowBody}>
                    <span style={s.rowNote}>{link.label}</span>
                    <span style={s.mono}>{link.path}</span>
                  </div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t("path.openLabel", { path: link.path })}
                      style={s.openLink}
                    >
                      {t("path.open")}
                      <Icon.ExternalLink size={12} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Copies one command to the clipboard, verbatim (AC-39).
 *
 * Its own component so the "copied" flash is per-command: a single flag on the card
 * would light up every command in the section at once — the same reason
 * `ConventionCard`'s `CopySnippet` exists.
 *
 * The write is optional-chained because `navigator.clipboard` is absent in jsdom and
 * on a non-secure origin, and a missing clipboard must not throw a render out of the
 * card. The string is passed through untouched: no trimming, no stripping of a
 * trailing comment, because what the reader copies has to be what they read.
 */
function CopyCommand({ command }: { command: string }) {
  const t = useTranslations("onboarding");
  const [copied, setCopied] = React.useState(false);
  const label = copied ? t("command.copied") : t("command.copyLabel", { command });

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      style={s.copyBtn(copied)}
      onClick={() => {
        void navigator.clipboard?.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
    </button>
  );
}

export default TourSection;
