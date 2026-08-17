/* BlastRadiusCard — the BLAST RADIUS block on the PR Overview tab (L04).

   PROP-DRIVEN AND PRESENTATIONAL ON PURPOSE, like `IntentCard` beside it: it calls no
   data hook, so it mounts with `NextIntlClientProvider` alone — no QueryClient — the
   way every other pinned unit on this screen does. `OverviewTab` owns `usePrBlast`.

   The states it must tell apart ARE the feature. An empty map means one of three
   different things — nothing calls this code, the index only covers part of the
   repository, or nothing was analysed at all — and rendering them identically is the
   one failure that would make this card actively misleading. So there is no bare
   "no results" branch anywhere below: every empty answer renders the reason the
   server gave for it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import type { BlastReason, PrBlastRadius, PrPriorPrs } from "@devdigest/shared";
import { PriorPrs } from "./_components/PriorPrs";
import {
  ambiguousNames,
  buildGraph,
  callerUrl,
  fileLineLabel,
  linkRef,
  unattributed,
} from "./helpers";
import { s } from "./styles";

export interface BlastRadiusCardProps {
  /** The impact map, or null while it has not been read yet. */
  blast: PrBlastRadius | null;
  isLoading: boolean;
  /** Query error — the map could not be READ, distinct from a degraded map. */
  error: unknown;
  /** `owner/name`, for the github.com deep-links on every caller row. */
  repoFullName: string | null | undefined;
  /** Repository uuid, for the in-app links in the PRIOR PRS footer. */
  repoId: string | null | undefined;
  /* The history footer's own query, threaded through as props for the same reason
     the map is: this card owns no hook. It is a SEPARATE endpoint and therefore a
     separate loading state — the impact map is the headline and must not wait on a
     history read. Undefined `priorPrs` with `priorPrsLoading` false renders the
     footer's unreadable state, never a silent absence. */
  priorPrs: PrPriorPrs | null;
  priorPrsLoading: boolean;
  priorPrsError: unknown;
}

export function BlastRadiusCard({
  blast,
  isLoading,
  error,
  repoFullName,
  repoId,
  priorPrs,
  priorPrsLoading,
  priorPrsError,
}: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  // Which symbol rows are expanded, as a sparse override map keyed by symbol name.
  // The FIRST row opens by default (the design shows it open) and the rest are
  // closed; an explicit entry always wins over that default, so collapsing the
  // first row sticks.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  // Endpoints and crons no symbol row accounts for — see `unattributed`.
  const loose = blast ? unattributed(blast.impacted, blast.downstream) : [];
  // Symbol names this map declares more than once, which get their file shown.
  const ambiguous = blast ? ambiguousNames(blast.downstream) : new Set<string>();

  return (
    <section>
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.headerLabel}>
            <Icon.Boxes size={14} />
            {t("label")}
          </span>
        </div>

        {isLoading && (
          <div style={s.loadingColumn}>
            <Skeleton height={18} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {!isLoading && error != null && (
          <Notice tone="warn" icon="AlertTriangle" title={t("error.title")} hint={t("error.hint")} />
        )}

        {!isLoading && error == null && blast && (
          <>
            {/* The stat row stays visible in EVERY state, including degraded, because
                four zeroes next to the reason they are zero is more honest than
                hiding the figures. */}
            <div style={s.statRow}>
              <Stat icon="Code" value={blast.counts.symbols} label={t("stat.symbols")} />
              <Stat icon="CornerDownRight" value={blast.counts.callers} label={t("stat.callers")} />
              <Stat icon="Globe" value={blast.counts.endpoints} label={t("stat.endpoints")} />
              <Stat icon="Clock" value={blast.counts.crons} label={t("stat.crons")} />
              {blast.downstream.length > 0 && (
                <div style={s.toggle} role="group" aria-label={t("view.tree")}>
                  {(["tree", "graph"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      style={s.toggleBtn(view === v)}
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                    >
                      {t(`view.${v}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* A caveat sits ABOVE the data it qualifies: a reader who stops at the
                first row must already know the map may be incomplete. */}
            {blast.status === "partial" && (
              <Notice
                tone="warn"
                icon="AlertTriangle"
                title={t("partial.title")}
                hint={t("partial.hint")}
              />
            )}

            {blast.status === "degraded" && (
              <Notice
                tone="muted"
                icon="Info"
                title={t("degraded.title")}
                hint={`${reasonText(t, blast.reason)} ${t("degraded.hint")}`}
              />
            )}

            {/* "Nothing calls this" — the one empty map that is a finding rather than
                a gap, and the only one allowed to say so. */}
            {blast.status !== "degraded" && blast.downstream.length === 0 && (
              <Notice
                tone="muted"
                icon="Info"
                title={t("empty.title")}
                hint={
                  blast.changed_symbols.length > 0
                    ? t("noDownstream", { count: blast.changed_symbols.length })
                    : t("empty.hint")
                }
              />
            )}

            {blast.downstream.length > 0 && view === "tree" && (
              <div style={s.symbolList}>
                {blast.downstream.map((d, i) => {
                  const isOpen = open[d.symbol] ?? i === 0;
                  return (
                    <div key={`${d.symbol}:${d.file}`} style={s.symbolRow}>
                      <button
                        type="button"
                        style={s.symbolHeader}
                        aria-expanded={isOpen}
                        onClick={() => setOpen((prev) => ({ ...prev, [d.symbol]: !isOpen }))}
                      >
                        <span style={s.chevron}>
                          {isOpen ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
                        </span>
                        <span style={s.symbolIcon}>
                          <Icon.Code size={13} />
                        </span>
                        <span style={s.symbolName}>{d.symbol}()</span>
                        {ambiguous.has(d.symbol) && (
                          <span style={s.symbolFile} title={d.file}>
                            {d.file}
                          </span>
                        )}
                        <span style={s.symbolCount}>
                          {t("callerCount", { count: d.caller_count })}
                        </span>
                      </button>

                      {isOpen && (
                        <div style={s.body}>
                          <div style={s.callerList}>
                            {d.callers.map((c) => {
                              const label = fileLineLabel(c.file, c.line);
                              return repoFullName ? (
                                <a
                                  key={label}
                                  style={s.callerLink}
                                  href={callerUrl(repoFullName, linkRef(blast), c.file, c.line)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={t("openInGithub", { file: c.file, line: c.line })}
                                >
                                  <span style={s.callerArrow}>
                                    <Icon.CornerDownRight size={12} />
                                  </span>
                                  <span style={s.callerPath}>{label}</span>
                                </a>
                              ) : (
                                // No repo full name means no link can be built. The row
                                // still renders — the fact is the caller, not the URL.
                                <span key={label} style={s.callerLink}>
                                  <span style={s.callerArrow}>
                                    <Icon.CornerDownRight size={12} />
                                  </span>
                                  <span style={s.callerPath}>{label}</span>
                                </span>
                              );
                            })}
                            {d.truncated && (
                              <span style={s.truncatedNote}>
                                {t("truncated", {
                                  shown: d.callers.length,
                                  total: d.caller_count,
                                })}
                              </span>
                            )}
                          </div>

                          {d.impacted.length > 0 && (
                            <div style={s.badgeRow}>
                              {d.impacted.map((e) => (
                                <span
                                  key={`${e.kind}:${e.label}:${e.file}`}
                                  style={s.badge(e.kind)}
                                  title={
                                    e.depth > 1
                                      ? `${e.file} — ${t("depth.indirect", { depth: e.depth })}`
                                      : e.file
                                  }
                                >
                                  {e.kind === "cron" ? (
                                    <Icon.Clock size={12} />
                                  ) : (
                                    <Icon.Globe size={12} />
                                  )}
                                  {e.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Impact that belongs to the PR rather than to any one symbol: routes the
                changed files declare themselves, and routes reached from a changed file
                whose symbols live elsewhere. Without this row the stat row could count
                endpoints the body of the card never shows. */}
            {view === "tree" && loose.length > 0 && (
              <div>
                <div style={s.looseLabel}>{t("directImpact")}</div>
                <div style={s.badgeRow}>
                  {loose.map((e) => (
                    <span
                      key={`${e.kind}:${e.label}:${e.file}`}
                      style={s.badge(e.kind)}
                      title={
                        e.depth > 1
                          ? `${e.file} — ${t("depth.indirect", { depth: e.depth })}`
                          : e.file
                      }
                    >
                      {e.kind === "cron" ? <Icon.Clock size={12} /> : <Icon.Globe size={12} />}
                      {e.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {blast.downstream.length > 0 && view === "graph" && (
              <div style={s.graphBox} aria-label={t("graph.ariaLabel")}>
                <MermaidDiagram chart={buildGraph(blast.downstream)} />
              </div>
            )}
          </>
        )}

        {/* OUTSIDE the map's branches on purpose: the two answers come from two
            endpoints, so a failed or still-loading impact map must not take the
            history down with it — and vice versa. */}
        <PriorPrs
          data={priorPrs}
          isLoading={priorPrsLoading}
          error={priorPrsError}
          repoId={repoId}
        />
      </div>
    </section>
  );
}

/** One figure in the stat row: icon, the number, then the unit. */
function Stat({
  icon,
  value,
  label,
}: {
  icon: "Code" | "CornerDownRight" | "Globe" | "Clock";
  value: number;
  label: string;
}) {
  const Glyph = Icon[icon];
  return (
    <span style={s.stat}>
      <span style={s.statIcon}>
        <Glyph size={13} />
      </span>
      <span style={s.statValue}>{value}</span>
      {label}
    </span>
  );
}

function Notice({
  tone,
  icon,
  title,
  hint,
}: {
  tone: "warn" | "muted";
  icon: "AlertTriangle" | "Info";
  title: string;
  hint: string;
}) {
  const Glyph = Icon[icon];
  return (
    <div style={s.notice(tone)}>
      <span style={s.noticeIcon}>
        <Glyph size={14} />
      </span>
      <span>
        <span style={s.noticeTitle}>{title}</span>
        <span style={s.noticeHint}>{hint}</span>
      </span>
    </div>
  );
}

/**
 * The server's `reason` as a sentence.
 *
 * Falls back to the generic degraded copy for an unrecognised value rather than
 * rendering the raw enum: the contract can grow a reason this build has no wording
 * for, and `next-intl` would otherwise print the key path onto the screen.
 */
function reasonText(t: (key: string) => string, reason: BlastReason | null): string {
  const known = [
    "flag_off",
    "index_missing",
    "index_partial",
    "index_failed",
    "repo_too_large",
    "no_changed_files",
  ];
  if (reason && known.includes(reason)) return t(`degraded.reason.${reason}`);
  return "";
}
