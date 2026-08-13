/* IntentCard — the INTENT block on the PR Overview tab (L03).

   PROP-DRIVEN AND PRESENTATIONAL ON PURPOSE. It calls no data hook: `OverviewTab`
   is the container that owns `usePrIntent`/`useDeriveIntent`, which is what lets
   this card be mounted with `NextIntlClientProvider` alone — no QueryClient — the
   way every other pinned unit on this screen is.

   The states it must tell apart are the whole point of the feature: a derivation
   that never ran is not a failure, a `partial` one is not an error, and an intent
   derived against an older commit is stale rather than wrong. Nothing here ever
   fills a gap in with a guess — an unread source is shown as unread. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { RiskAreas } from "./_components/RiskAreas";
import type { PrIntent } from "@devdigest/shared";
import { s } from "./styles";

export interface IntentCardProps {
  /** The stored derivation, or null when this PR has never been classified. */
  intent: PrIntent | null;
  isLoading: boolean;
  isDeriving: boolean;
  /** Query error — the intent could not be READ (distinct from a failed derivation). */
  error: unknown;
  /** Current head of the PR; drives the "derived from an earlier commit" note. */
  headSha: string | null | undefined;
  onRederive: () => void;
}

export function IntentCard({
  intent,
  isLoading,
  isDeriving,
  error,
  headSha,
  onRederive,
}: IntentCardProps) {
  const t = useTranslations("intent");

  return (
    <section>
      <div style={s.card}>
        {/* The label lives INSIDE the card, top-left, with the derivation's own
            confidence and the re-derive control on the same line at the right.
            Confidence belongs here rather than buried below the columns: it is the
            number that says whether the two lists under it are worth reading. */}
        <div style={s.header}>
          <span style={s.headerLabel}>
            <Icon.Target size={14} />
            {t("label")}
          </span>
          <span style={s.headerRight}>
            {intent && intent.status !== "failed" && (
              <span style={s.metaRow}>
                <span style={s.metaLabel}>{t("card.confidence")}</span>
                <span style={s.confidence(intent.confidence)}>
                  {Math.round(intent.confidence * 100)}%
                </span>
              </span>
            )}
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={isDeriving}
              disabled={isDeriving}
              onClick={onRederive}
            >
              {isDeriving ? t("card.deriving") : t("card.rederive")}
            </Button>
          </span>
        </div>

        <IntentBody
          intent={intent}
          isLoading={isLoading}
          isDeriving={isDeriving}
          error={error}
          headSha={headSha}
        />
      </div>
    </section>
  );
}

/**
 * The card's interior, split out so each state is one early return instead of a
 * ladder of ternaries. Colocated rather than promoted: the header above is the
 * only caller and it always renders, whatever this returns.
 */
function IntentBody({
  intent,
  isLoading,
  isDeriving,
  error,
  headSha,
}: Omit<IntentCardProps, "onRederive">) {
  const t = useTranslations("intent");

  // A derivation in flight REPLACES what was there. Showing a "Deriving…" note
  // above the previous answer left two intents on screen at once — the old text
  // still reading as current — which is the opposite of what the control means.
  if (isLoading || isDeriving) {
    return (
      <div style={s.loadingColumn}>
        <Skeleton height={18} width="70%" />
        <Skeleton height={14} width="45%" />
        <Skeleton height={60} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={s.errorBox} role="alert">
        <span>{t("card.error")}</span>
        {error instanceof Error && <span style={s.errorDetail}>{error.message}</span>}
      </div>
    );
  }

  if (!intent) {
    return <EmptyState icon="Target" title={t("unavailable")} body={t("unavailableHint")} />;
  }

  if (intent.status === "failed") {
    return (
      <>
        <div style={s.errorBox} role="alert">
          <span>{t("card.failed")}</span>
          {intent.error && <span style={s.errorDetail}>{intent.error}</span>}
        </div>
        <MissingContext items={intent.missing_context} />
      </>
    );
  }

  // A derivation made against a different commit than the PR now points at. Both
  // sides must be known — an unknown head SHA is not evidence of staleness.
  const stale = !!intent.head_sha && !!headSha && intent.head_sha !== headSha;

  return (
    <>
      {stale && (
        <div style={s.note("warn")}>
          <Icon.Clock size={14} />
          <span>{t("card.staleHeadSha")}</span>
        </div>
      )}

      {intent.intent && <blockquote style={s.quote}>{`\u201C${intent.intent}\u201D`}</blockquote>}

      <div style={s.columns}>
        <ScopeColumn
          tone="ok"
          icon="Check"
          label={t("card.inScope")}
          items={intent.in_scope}
          emptyLabel={t("card.noneListed")}
        />
        <ScopeColumn
          tone="muted"
          icon="X"
          label={t("card.outOfScope")}
          items={intent.out_of_scope}
          emptyLabel={t("card.noneListed")}
        />
      </div>

      {/* Below the scope columns and above the derivation's own receipt, per the
          design mock. `RiskAreas` renders nothing at all for an empty list, so the
          divider and the label are inside this guard rather than around it — an
          empty section with a heading would imply we checked and found none. */}
      {intent.risk_areas.length > 0 && (
        <>
          <div style={s.divider} />
          <section>
            <SectionLabel icon="AlertTriangle">{t("card.riskAreas")}</SectionLabel>
            <RiskAreas risks={intent.risk_areas} />
          </section>
        </>
      )}

      {/* ALWAYS last, whatever the status. The gap is a footnote to the answer,
          not a preamble to it: `partial` used to promote it above the intent
          sentence, which put "could not read X" between the card's header and the
          sentence it qualifies and read as an error banner. The list already names
          what failed, so nothing is lost by keeping it in one predictable place. */}
      <MissingContext items={intent.missing_context} />
    </>
  );
}

/** One of the two bullet columns: what the PR is for, and what it is not. */
function ScopeColumn({
  tone,
  icon,
  label,
  items,
  emptyLabel,
}: {
  tone: "ok" | "muted";
  icon: "Check" | "X";
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  const I = Icon[icon];
  return (
    <div>
      <div style={s.columnHead(tone)}>
        <I size={13} />
        <span>{label}</span>
      </div>
      {items.length === 0 ? (
        <div style={s.emptyBullets}>{emptyLabel}</div>
      ) : (
        <ul style={s.bullets}>
          {/* Index keys: this list is re-rendered wholesale from immutable
              server data, is never reordered and holds no per-item state — and
              two bullets are allowed to carry the same text.

              The `·` is a real element, not a list marker: it has to be tinted per
              column, and `list-style` colour follows the text. `aria-hidden` keeps
              it out of the accessible name — a screen reader announces the list
              item, not a decorative dot. */}
          {items.map((item, i) => (
            <li key={i} style={s.bullet}>
              <span aria-hidden="true" style={s.bulletDot(tone)}>
                ·
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the classifier could not read, stated plainly. Never rendered empty.
 *
 * Uses the vendored `SectionLabel` with an icon, exactly as RISK AREAS does, so
 * an optional block that only sometimes appears still reads as a peer of the
 * card's other sections rather than as a stray paragraph. `EyeOff` because that
 * is literally the claim: this is the material we did NOT get to see.
 *
 * Going through `SectionLabel` also settles the type scale for free — it renders
 * at the same 12px as INTENT, CONFIDENCE and RISK AREAS, where this label used to
 * be a hand-rolled 11.5.
 */
function MissingContext({ items }: { items: string[] }) {
  const t = useTranslations("intent");
  if (items.length === 0) return null;
  return (
    <section>
      <SectionLabel icon="EyeOff">{t("card.missingContext")}</SectionLabel>
      <ul style={s.bullets}>
        {items.map((item, i) => (
          <li key={i} style={s.bullet}>
            <span aria-hidden="true" style={s.bulletDot("muted")}>
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

