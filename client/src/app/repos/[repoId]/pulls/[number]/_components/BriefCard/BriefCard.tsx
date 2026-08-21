/* BriefCard — the PR BRIEF block, top of the Overview tab (L05).

   PROP-DRIVEN AND PRESENTATIONAL, like `IntentCard` and `BlastRadiusCard` below
   it: no data hook, so it mounts with `NextIntlClientProvider` alone and no
   QueryClient. `OverviewTab` owns `usePrBrief` / `useGenerateBrief` and hands
   this component plain props. If a hook ever moves into this subtree its tests
   fail with "No QueryClient set", which is the boundary working.

   THE STATE LADDER IS THE FEATURE, and every branch below is on the payload —
   never on `risks.length`. A pull request with no brief, one whose generation is
   in flight, one whose generation failed, and one whose change genuinely carries
   no risk all arrive with little to render, and only `generation_state`,
   `status` and `reason` tell them apart. Rendering them identically is the one
   failure that would make this card actively misleading, which is why there is
   no bare "nothing found" branch anywhere here.

   Two things the design mock draws that this card deliberately does not:

     - **The verdict banner.** It sits at the top of this very section in the
       mock, but it is REVIEW OUTPUT rendered on `Agent runs`, and a brief exists
       before any agent has run — on a fresh pull request that whole region would
       be empty. The card carries its own risk level, its own regenerate control
       and its own cost line instead.
     - **The regenerate control ON that banner.** Pressing it there reads as
       "re-run the review", which costs a full multi-agent run rather than one
       flash call. It belongs to the brief, so it lives on the brief. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BriefDiffStats, PrRiskBrief, ReviewFocusItem, Risk } from "@devdigest/shared";
import { formatAge, formatCost } from "@/lib/format";
import { riskSeverityColor } from "@/lib/risk";
import { SEVERITY_BG } from "./constants";
import {
  filesOmitted,
  hasStoredBrief,
  isKnownReason,
  risksWorstFirst,
  severityIcon,
} from "./helpers";
import { s } from "./styles";

export interface BriefCardProps {
  /** The stored brief, or null while it has not been read yet. */
  brief: PrRiskBrief | null;
  isLoading: boolean;
  /** A generation THIS reader asked for — the control's own pending state. */
  isGenerating: boolean;
  /** Query error: the brief could not be READ. Distinct from a degraded brief. */
  error: unknown;
  /**
   * Mutation error: the generation request itself was refused — most often
   * because one is already running, which the server answers rather than queues.
   * Separate from `error` on purpose, because it must not take the brief on
   * screen down with it.
   */
  generateError: unknown;
  onGenerate: () => void;
  /** Where a review-focus row leads. The card knows paths; the owner of the URL
      knows routes (AC-40). */
  onOpenFile: (path: string, line?: number | null) => void;
}

export function BriefCard(props: BriefCardProps) {
  const t = useTranslations("prBrief");
  const { brief, isGenerating, onGenerate } = props;
  const level = brief?.risk_level ?? null;
  // The control says "regenerate", so it is offered only where there is
  // something to regenerate. A brief nobody has generated is offered generation
  // by its empty state below — ONE offer, in the words that fit the state.
  const canRegenerate = brief != null && brief.generation_state !== "never_generated";

  return (
    <section>
      <div style={s.card}>
        {/* The label lives INSIDE the card with the risk level and the control on
            the same line, the shape the intent card beside it already sets. The
            level belongs here rather than below the statements: it is the one
            word that says whether the list underneath is worth reading. */}
        <div style={s.header}>
          <span style={s.headerLabel}>
            <Icon.FileText size={14} />
            {t("title")}
          </span>
          <span style={s.headerRight}>
            {level != null && (
              <span style={s.metaRow}>
                <span style={s.metaLabel}>{t("levelLabel")}</span>
                {/* Word PLUS icon, never colour alone (AC-37): colour is
                    invisible to a large share of readers and to every screen
                    reader, so the level has to survive its removal. */}
                <Badge
                  icon={severityIcon(level)}
                  color={riskSeverityColor(level)}
                  bg={SEVERITY_BG[level] ?? "var(--bg-hover)"}
                >
                  {t(`level.${level}`)}
                </Badge>
              </span>
            )}
            {canRegenerate && (
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                loading={isGenerating}
                disabled={isGenerating}
                onClick={onGenerate}
              >
                {isGenerating ? t("regenerating") : t("regenerate")}
              </Button>
            )}
          </span>
        </div>

        <BriefBody {...props} />
      </div>
    </section>
  );
}

/**
 * The card's interior: one early return per state, rather than a ladder of
 * ternaries. Colocated because the header above is its only caller and it
 * renders whatever this returns.
 */
function BriefBody({
  brief,
  isLoading,
  isGenerating,
  error,
  generateError,
  onGenerate,
  onOpenFile,
}: BriefCardProps) {
  const t = useTranslations("prBrief");

  // AC-47 — a placeholder shaped like the loaded card, so the intent and blast
  // cards below it do not jump when the brief lands.
  if (isLoading) return <LoadingPlaceholder />;

  // AC-51 — the read failed. Inline, inside the card: the tab bar, the sidebar
  // and the other two cards are untouched and the screen stays navigable.
  if (error != null) {
    return (
      <div style={s.errorBox} role="alert">
        <span>{t("error")}</span>
        <span style={s.errorDetail}>{t("errorHint")}</span>
        {error instanceof Error && <span style={s.errorDetail}>{error.message}</span>}
      </div>
    );
  }

  // AC-46 — ONE empty state offering generation. A null payload lands here too:
  // the route answers `never_generated` rather than 404, so a null brief means
  // the same thing to a reader and must not become a second empty state.
  if (brief == null || brief.generation_state === "never_generated") {
    return (
      <>
        <GenerateError error={generateError} />
        <EmptyState
          icon="FileText"
          title={t("empty")}
          body={t("emptyHint")}
          cta={t("emptyCta")}
          onCta={onGenerate}
          ctaLoading={isGenerating}
        />
      </>
    );
  }

  const running = brief.generation_state === "running";
  /* While a generation runs, the contract says the rest of the document IS the
     previously stored brief — so it stays on screen under the notice. This is
     NOT the intent card's "a derivation in flight replaces what was there":
     opening a pull request starts a generation whenever the stored brief no
     longer matches its state (AC-58), so blanking the card while that runs
     would hide a perfectly readable brief on nearly every first open. The notice
     is what says the text below describes an earlier state. */
  const showStored = !running || hasStoredBrief(brief);

  return (
    <>
      <GenerateError error={generateError} />

      {/* AC-45 — the running state. Everything else on the screen stays in the
          tree and interactive; this is a notice inside one card, not a takeover. */}
      {running && (
        <Notice tone="muted" icon="Clock" title={t("running")} hint={t("runningHint")} />
      )}

      {/* AC-50 — stale: the stored brief plus a notice, with regeneration one
          control away in the header. Suppressed while a generation runs, because
          the running notice already tells the reader a newer one is on its way
          and two notices saying so is noise. */}
      {brief.stale && !running && (
        <Notice tone="warn" icon="Clock" title={t("stale")} hint={t("staleHint")} />
      )}

      {showStored && <BriefContent brief={brief} onOpenFile={onOpenFile} />}
    </>
  );
}

/** The stored brief itself: notices, the two statements, the figures, the risks,
    the review focus, and the generation's receipt. */
function BriefContent({
  brief,
  onOpenFile,
}: {
  brief: PrRiskBrief;
  onOpenFile: BriefCardProps["onOpenFile"];
}) {
  const t = useTranslations("prBrief");
  // Which risk's explanation is showing, or none. ONE at a time, the rule the
  // intent card's chip row already sets: a risk carries two sentences and up to
  // three paths, so a block that expands every row grows past the fold on any
  // pull request with more than two risks — which was this card's first
  // observation in the running app. Index rather than an id: `Risk` has none,
  // this is immutable server data, and the list is never reordered while
  // mounted. Derived-not-stored is not available here; a disclosure IS state.
  const [openRisk, setOpenRisk] = React.useState<number | null>(null);
  const degraded = brief.status === "degraded";
  const partial = brief.status === "partial";
  // AC-49 — a reason this build has no sentence for renders the GENERIC one,
  // never the enum literal and never the message-key path `next-intl` would
  // print for a missing message.
  const reason =
    brief.reason == null
      ? null
      : isKnownReason(brief.reason)
        ? t(`reason.${brief.reason}`)
        : t("reasonUnknown");
  const hint = (tail: string) => (reason ? `${reason} ${tail}` : tail);

  return (
    <>
      {/* AC-48 — the notice names the reason and the content stays below it. A
          caveat sits ABOVE what it qualifies: a reader who stops at the first
          line must already know the brief was written from partial inputs. */}
      {partial && (
        <Notice tone="muted" icon="Info" title={t("partial")} hint={hint(t("partialHint"))} />
      )}
      {degraded && (
        <Notice
          tone="warn"
          icon="AlertTriangle"
          title={t("degraded")}
          hint={hint(t("degradedHint"))}
        />
      )}

      <Statements what={brief.what} why={brief.why} />

      {/* The deterministic figures, in EVERY state including degraded — they are
          the half that survives a failed generation, and true numbers beside the
          reason there is nothing else beats an empty card. */}
      <Stats stats={brief.diff_stats} />

      {/* A degraded brief carries nothing a model wrote, so neither of these
          sections renders: "No specific risk was identified" would be a claim
          about the change, and nobody looked. The notice above already said so. */}
      {!degraded && (
        <>
          <div style={s.divider} />
          {/* Both sections start SHUT. Between them they carry up to six risks and
              five focus rows, which pushed the intent and blast cards below the
              fold on any real pull request — the same observation that already
              put a risk's explanation behind its own disclosure, one level up. */}
          <Section
            icon="AlertTriangle"
            label={t("risksLabel")}
            count={brief.risks.length}
            empty={t("risksNone")}
          >
            <div style={s.riskList}>
              {/* Index keys: this list is rendered wholesale from immutable
                  server data, holds no per-item state, and its order is a pure
                  function of that data — two risks are allowed to share a
                  title, so the title is not an id. */}
              {risksWorstFirst(brief.risks).map((risk, i) => (
                <RiskRow
                  key={i}
                  risk={risk}
                  open={openRisk === i}
                  onToggle={() => setOpenRisk(openRisk === i ? null : i)}
                />
              ))}
            </div>
          </Section>

          <Section
            icon="ListChecks"
            label={t("reviewFocusLabel")}
            count={brief.review_focus.length}
            empty={t("reviewFocusNone")}
          >
            <div style={s.focusList}>
              {brief.review_focus.map((item, i) => (
                <FocusRow
                  key={`${item.path}:${item.line ?? ""}:${i}`}
                  item={item}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      <Receipt brief={brief} />
    </>
  );
}

/** WHAT and WHY as two separately labelled statements (AC-38). A null what
    renders the why alone rather than an empty labelled region. */
function Statements({ what, why }: { what: string | null; why: string | null }) {
  const t = useTranslations("prBrief");
  if (what == null && why == null) return null;
  return (
    <div style={s.statements}>
      {what != null && (
        <div>
          <div style={s.statementLabel}>{t("whatLabel")}</div>
          <div style={s.statementText}>{what}</div>
        </div>
      )}
      {why != null && (
        <div>
          <div style={s.statementLabel}>{t("whyLabel")}</div>
          <div style={s.statementText}>{why}</div>
        </div>
      )}
    </div>
  );
}

/** The four figures the assembly held before any model call, plus how many
    changed files the model was never shown. */
function Stats({ stats }: { stats: BriefDiffStats }) {
  const t = useTranslations("prBrief");
  const omitted = filesOmitted(stats);
  return (
    <div className="tnum" style={s.statRow}>
      <Stat icon="File" text={t("stats.filesChanged", { count: stats.files_changed })} />
      <Stat icon="Eye" text={t("stats.filesRead", { count: stats.files_listed })} />
      <Stat
        icon="Code"
        text={t("stats.lines", { additions: stats.additions, deletions: stats.deletions })}
      />
      {/* Only when something WAS omitted: "0 files were not shown" is a sentence
          that makes a reader look for the catch. */}
      {omitted > 0 && <Stat icon="EyeOff" text={t("stats.filesOmitted", { count: omitted })} />}
    </div>
  );
}

function Stat({ icon, text }: { icon: "File" | "Eye" | "Code" | "EyeOff"; text: string }) {
  const Glyph = Icon[icon];
  return (
    <span style={s.stat}>
      <span style={s.statIcon}>
        <Glyph size={13} />
      </span>
      {text}
    </span>
  );
}

/**
 * One collapsible section of the stored brief — `RISKS` and `REVIEW FOCUS`.
 *
 * Shut by default, and each instance owns its own `open`, so expanding one leaves
 * the other alone. State lives HERE rather than in `BriefContent` for that reason:
 * two independent booleans threaded from the parent would say the same thing with
 * more wiring, and nothing outside this component reads either one.
 *
 * The header wraps `SectionLabel` in a real `<button>` instead of re-deriving that
 * primitive's type scale — the shape `RiskRow`'s head already set one level down,
 * and the reason a shut section still reads as a heading. A native button is also
 * what AC-53 wants: tab-reachable, with an accessible name, no pointer required.
 *
 * AN EMPTY LIST IS NOT COLLAPSIBLE. With no risks the section renders its sentence
 * outright, because "No specific risk was identified" is a CLAIM about the change
 * and a reader must not have to click to find out that nothing was flagged. Note
 * the early return sits AFTER the hook, so the hook order never depends on
 * `count` — a regeneration that takes a list from empty to non-empty must not
 * reorder hooks.
 */
function Section({
  icon,
  label,
  count,
  empty,
  children,
}: {
  icon: "AlertTriangle" | "ListChecks";
  label: string;
  count: number;
  /** The sentence shown INSTEAD of a disclosure when there is nothing to list. */
  empty: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("prBrief");
  const [open, setOpen] = React.useState(false);

  if (count === 0) {
    return (
      <section>
        <SectionLabel icon={icon}>{label}</SectionLabel>
        <div style={s.quiet}>{empty}</div>
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t(open ? "sectionCollapse" : "sectionExpand", { label })}
        style={s.sectionHead(open)}
      >
        <SectionLabel
          icon={icon}
          right={
            <span style={s.sectionRight}>
              {/* The count is what keeps a shut section honest: the reader can see
                  there are three risks without opening it. */}
              <Badge color="var(--text-secondary)" style={s.sectionCount}>
                {count}
              </Badge>
              <Icon.ChevronDown size={15} style={s.sectionChevron(open)} />
            </span>
          }
        >
          {label}
        </SectionLabel>
      </button>
      {open ? children : null}
    </section>
  );
}

/**
 * One risk, with all four of its parts at once (AC-39): the severity as a WORD
 * plus an icon, the title, the explanation, and the files it names.
 *
 * The severity vocabulary is `severity.*` and not `level.*`, and the two are
 * deliberately different words for two different facts — the card's level
 * describes the whole pull request, a risk's severity describes one risk.
 *
 * Both omissions here are the ones the intent card's chip row already made, for
 * the same reasons. The explanation is PLAIN TEXT rather than `<Markdown>`: that
 * primitive maps `a`, so a link in model output — text derived from an
 * author-controlled description — would become a live anchor pointing anywhere.
 * And the paths are mono TEXT rather than `MonoLink`: without an `href` that
 * primitive renders a `<button>` that does nothing, which is worse than a label.
 * A risk's references are grounded against the blast map as well as the changed
 * files (AC-22), so there is no promise that one of them is a file this pull
 * request touches — no target, no control. A review-focus row is the opposite
 * case and IS a control.
 */
function RiskRow({
  risk,
  open,
  onToggle,
}: {
  risk: Risk;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("prBrief");
  return (
    <div style={s.riskRow}>
      {/* The head is the disclosure control, not a label. A row's severity, its
          title and its state are what a reader scans; the explanation and the
          paths are what they ask for. Making the whole head the button rather
          than a bare chevron gives the control a real accessible name and a
          target worth aiming at. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t(open ? "riskCollapse" : "riskExpand", { title: risk.title })}
        style={s.riskHead}
      >
        <Badge icon={severityIcon(risk.severity)} color={riskSeverityColor(risk.severity)}>
          {t(`severity.${risk.severity}`)}
        </Badge>
        <span style={s.riskTitle}>{risk.title}</span>
        <Icon.ChevronDown style={s.riskChevron(open)} />
      </button>
      {open ? (
        <>
          <div style={s.riskExplanation}>{risk.explanation}</div>
          {risk.file_refs.length > 0 ? (
            <div>
              <div style={s.statementLabel}>{t("riskFilesLabel")}</div>
              <div style={s.riskRefs}>
                {risk.file_refs.map((ref, i) => (
                  <span key={i} style={s.riskRef}>
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div style={s.quiet}>{t("riskNoFiles")}</div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * One place to look first — a real `<button>`, because it navigates (AC-40).
 *
 * The accessible name is the whole sentence naming the destination rather than
 * the bare path, so a screen-reader reader hears where the control goes; the
 * path is still the visible subject of the row. `aria-label` wins over the row's
 * content for the name, which also makes the control findable by one stable
 * string in a test — and a path carries no consecutive spaces, so the
 * accessible-name whitespace normalisation that bites commands and snippets
 * cannot bite here.
 */
function FocusRow({
  item,
  onOpenFile,
}: {
  item: ReviewFocusItem;
  onOpenFile: BriefCardProps["onOpenFile"];
}) {
  const t = useTranslations("prBrief");
  const label =
    item.line != null
      ? t("reviewFocusOpenLine", { path: item.path, line: item.line })
      : t("reviewFocusOpen", { path: item.path });
  return (
    <button
      type="button"
      style={s.focusRow}
      aria-label={label}
      title={label}
      onClick={() => onOpenFile(item.path, item.line)}
    >
      <span style={s.focusArrow}>
        <Icon.ArrowRight size={13} />
      </span>
      <span>
        <span style={s.focusPath}>{item.path}</span>
        {item.line != null && <span style={s.focusLine}>{`:${item.line}`}</span>}
        <span style={s.focusReason}>{item.reason}</span>
      </span>
    </button>
  );
}

/**
 * The generation's own receipt: the token counts, the cost, what answered, and
 * what it was generated from (AC-52).
 *
 * A null cost is `—` plus the sentence saying no price is known for this model.
 * It is NOT a free call: `$0` is a real value this app renders for a genuinely
 * free model (`formatCost`), so the two must not collapse into one figure.
 *
 * The counts are pre-formatted with a pinned `en-US` grouping rather than handed
 * to ICU as numbers, for the reason `formatTokenTotal` pins it: the app ships
 * only `messages/en`, and an environment-dependent separator makes the jsdom
 * tests non-deterministic.
 */
function Receipt({ brief }: { brief: PrRiskBrief }) {
  const t = useTranslations("prBrief");
  const { provider, model, generated_at, tokens_in, tokens_out, cost_usd, head_sha } = brief;
  const spent = tokens_in != null || tokens_out != null;
  if (!spent && generated_at == null && head_sha == null) return null;

  return (
    <>
      <div style={s.divider} />
      <div className="tnum" style={s.footer}>
        {spent && (
          <span>
            {t("cost", {
              tokensIn: (tokens_in ?? 0).toLocaleString("en-US"),
              tokensOut: (tokens_out ?? 0).toLocaleString("en-US"),
              cost: formatCost(cost_usd),
            })}
          </span>
        )}

        {provider != null && model != null && generated_at != null ? (
          <span>{t("provenance", { provider, model, age: formatAge(generated_at) })}</span>
        ) : generated_at != null ? (
          <span>{t("generatedAt", { age: formatAge(generated_at) })}</span>
        ) : null}

        {head_sha != null && (
          <span style={s.footerMono}>{t("headSha", { sha: head_sha.slice(0, 7) })}</span>
        )}

        {spent && cost_usd == null && <span style={s.footerNote}>{t("costUnpriced")}</span>}
      </div>
    </>
  );
}

/** A notice qualifying the whole card. Same shape the blast card uses, so a
    partial brief and a partial impact map read as the same kind of statement. */
function Notice({
  tone,
  icon,
  title,
  hint,
}: {
  tone: "warn" | "muted";
  icon: "AlertTriangle" | "Info" | "Clock";
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
 * A refused generation, said out loud.
 *
 * The server's own message and nothing else: a second generation for a pull
 * request already generating is REFUSED rather than queued, and this catalogue
 * has no sentence of its own for that — inventing one here would put this
 * feature's copy outside its namespace, and reusing the read failure's wording
 * ("Couldn't load the brief") would describe the wrong thing. What must not
 * happen is silence: a control whose spinner runs and stops with nothing to
 * show is the failure mode this whole feature is careful about.
 */
function GenerateError({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return (
    <div style={s.errorBox} role="alert">
      <span style={s.errorDetail}>{error.message}</span>
    </div>
  );
}

/** AC-47's placeholder: the card's regions, at roughly their own heights, so
    nothing below moves when the brief arrives. `Skeleton` is a bare
    `div.skeleton` with no role of its own, so the wrapper carries the status
    role and the accessible name. */
function LoadingPlaceholder() {
  const t = useTranslations("prBrief");
  return (
    <div style={s.loadingColumn} role="status" aria-live="polite" aria-label={t("loading")}>
      <Skeleton height={14} width="30%" />
      <Skeleton height={38} />
      <Skeleton height={14} width="26%" />
      <Skeleton height={38} />
      <Skeleton height={14} width="55%" />
      <Skeleton height={56} />
    </div>
  );
}
