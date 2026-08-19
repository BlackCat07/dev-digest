/* OnboardingView — the Onboarding Tour screen: five sections written from this
   repository's own index, with an on-this-page rail beside them.

   The screen is FIVE STATES, written as early returns rather than nested ternaries —
   loading, a failed request, never generated, running, and the tour. Each returns its
   own `<AppShell>`, which is the point rather than repetition: AC-34 and AC-44 both
   promise that the rest of the app stays usable while this screen is busy or broken,
   and a state that returned bare markup would be making that promise from outside the
   shell. `AppShell` mounts cleanly in jsdom with only `next/navigation` mocked, a
   `QueryClient` and the `shell` namespace (`client/INSIGHTS.md`, 2026-08-19), so the
   promise is assertable against the real sidebar rather than a faked one.

   Four things this screen exists to get right:

   1. **One empty state, not five empty cards** (AC-33). A repository nobody has
      generated a tour for returns `generation_state: "never_generated"` with no
      sections; rendering the five kinds as blank cards would say "the tour is written
      and says nothing", which is the one inference this feature must not invite.
   2. **The order is the server's** (AC-35). `sections` arrives in the contract's fixed
      `OnboardingSectionKind` order and is rendered as given — no sort, no filter, no
      per-kind lookup. The rail is built from the same array in the same pass, so the two
      cannot disagree about what is on the page.
   3. **The rail and the headings share one id function.** `sectionHeadingId` comes from
      `TourSection`'s barrel; a rail that built its own `#id` from the same `kind` would
      be a hand-synced invariant with nothing tying the halves, and the failure is a link
      that silently scrolls nowhere.
   4. **A notice never replaces the sections** (AC-41, AC-42). It sits above them and
      they still render below — including on a degraded tour, whose five sections are the
      deterministic skeleton and are labelled as such rather than hidden.

   Nothing here owns a timer. `useOnboardingTour`'s function-form `refetchInterval` polls
   only while the payload says `running` and stops itself, so the running state clears
   without an effect this component would have to tear down on unmount, on a repository
   change and on completion — and get one of the three wrong. */
"use client";

import React from "react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useGenerateOnboarding, useOnboardingTour } from "@/lib/hooks/onboarding";
import { noticeLevel, reasonMessageKey, tourProvenance } from "@/lib/onboarding";
import { TourSection, sectionHeadingId } from "../TourSection";
import { s } from "./styles";

/** How long the `Share link` control confirms itself before returning to its label. */
const SHARE_COPIED_MS = 1600;

export function OnboardingView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { data, isLoading, isError } = useOnboardingTour(repoId);
  const generate = useGenerateOnboarding(repoId);
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const [shareCopied, setShareCopied] = React.useState(false);

  // The design's breadcrumb is `acme/payments-api › Onboarding Tour`. The repo name is
  // data rather than copy, so it needs no message key — and it is dropped rather than
  // given a placeholder when the repos list has not resolved, because an empty crumb is
  // quieter than a crumb that says "unknown".
  const crumb = [
    ...(activeRepo?.full_name ? [{ label: activeRepo.full_name, mono: true }] : []),
    { label: t("title") },
  ];

  // A :repoId matching no repo belongs to the repo-scoped 404 boundary that owns that
  // copy for every screen under /repos, exactly as the PR list and Project Context do.
  if (repoNotFound) notFound();

  /**
   * AC-46: this screen's own URL, and nothing else.
   *
   * No token is minted, no alternate host is composed, no expiring parameter is
   * appended and no request leaves the browser — there is nothing to mint (N14). The
   * write is optional-chained because `navigator.clipboard` is absent in jsdom and on a
   * non-secure origin, and a missing clipboard must not throw a render out of the
   * screen.
   */
  const onShare = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), SHARE_COPIED_MS);
  };

  // The generation request's own failure, worded inline beside the control that caused
  // it. Distinct from AC-44's tour-request error below: a refused generation (the server
  // answers 422 while one is already running) must leave the tour on screen untouched.
  const generateError = generate.isError ? generate.error.message || t("unknownError") : null;

  // The tour request 404s for a repository that is gone, and can resolve before the
  // repos list does. Holding the error until that list has loaded is what stops a
  // generic error flashing in front of the 404 boundary.
  if (isLoading || (isError && !reposLoaded)) {
    // The vendored `Skeleton` is a bare `div.skeleton` with no role and no aria, which
    // is why a test asserts a loading state through `container.getElementsByClassName`.
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={34} width={320} />
          <div style={{ height: 20 }} />
          <Skeleton height={160} />
        </div>
      </AppShell>
    );
  }

  // AC-44: inline, on this screen, with the sidebar and the breadcrumb still in the
  // tree. A full-screen error or a segment-level error.tsx would take the navigation
  // away with it, and the failure is one request's rather than the shell's.
  if (isError || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState title={t("loadError.title")} body={t("loadError.body")} />
        </div>
      </AppShell>
    );
  }

  // AC-33. Branching on `generation_state` and never on `sections.length`: a degraded
  // tour and a never-generated repository both arrive with little to render, and only
  // the state and the status tell them apart.
  if (data.generation_state === "never_generated") {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState
            icon="Sparkles"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
            onCta={() => generate.mutate()}
            ctaLoading={generate.isPending}
          />
          {generateError && <div style={s.note("crit")}>{generateError}</div>}
        </div>
      </AppShell>
    );
  }

  // AC-34. `role="status"` rather than a bare div: the state arrives after a poll, so a
  // screen reader has to be told about it, and it is the assertable half of "the running
  // indicator renders" without reaching for a test id.
  if (data.generation_state === "running") {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.headRow}>
            <h1 style={s.heading}>{t("title")}</h1>
          </div>
          <div role="status" style={s.running}>
            <Icon.RefreshCw size={16} />
            <div>
              <div style={s.runningTitle}>{t("running.title")}</div>
              <div style={s.runningBody}>{t("running.body")}</div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Derived at render, never stored: both are pure functions of the payload, and a
  // `useState` mirror of either would be a second source of truth for what the server
  // already said.
  const provenance = tourProvenance(data);
  const level = noticeLevel(data);

  // AC-43 lives in `reasonMessageKey`, which is a lookup with a generic-sentence
  // default: a reason this build has never heard of must not reach the screen as an enum
  // literal, and passing an unknown key to next-intl would put the KEY PATH there
  // instead. The sentence is worded whenever there is a reason to word — and on a
  // degraded tour regardless, because naming the cause is that criterion (AC-42).
  const reasonText =
    level === "degraded" || data.reason != null ? t(reasonMessageKey(data.reason)) : null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.headRow}>
          <h1 style={s.heading}>{t("title")}</h1>
          {activeRepo?.full_name && (
            <span className="mono" style={s.repoName}>
              {activeRepo.full_name}
            </span>
          )}
          <div style={s.spacer} />
          {/* Both controls are real `<button>`s with an accessible name, so their
              keyboard activation is the browser's own (AC-45). */}
          <Button
            kind="ghost"
            icon={shareCopied ? "Check" : "Link"}
            aria-label={t("share.ariaLabel")}
            onClick={onShare}
          >
            {shareCopied ? t("share.copied") : t("share.label")}
          </Button>
          {/* Always enabled, including on a degraded tour: that is precisely the tour a
              reader wants to retry, and disabling it after a model timeout strands them. */}
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? t("regenerating") : t("regenerate")}
          </Button>
        </div>

        {/* AC-40: this tour's OWN recorded figures, never the current index state's, so
            an old tour cannot claim today's coverage. `tourProvenance` is where that
            rule lives. */}
        <div className="tnum" style={s.caption}>
          {t("sectionCount", { count: data.sections.length })} ·{" "}
          {t("meta.generated", { files: provenance.files, age: provenance.age })}
          {provenance.skipped > 0 &&
            ` · ${t("meta.filesSkipped", { count: provenance.skipped })}`}
        </div>

        {generateError && <div style={s.note("crit")}>{generateError}</div>}

        {/* AC-41, AC-42: above the sections, which still render below it. */}
        {level && (
          <div style={s.notice(level)}>
            <div style={s.noticeTitle}>{t(`notice.${level}.title`)}</div>
            <div style={s.noticeBody}>{t(`notice.${level}.body`)}</div>
            {reasonText && <div style={s.noticeBody}>{reasonText}</div>}
          </div>
        )}

        <div style={s.body}>
          <div style={s.sections}>
            {data.sections.map((section) => (
              /* Keyed on `kind`, never on the index: the five kinds are unique by
                 contract, and an index key would remount every card if the server ever
                 answered a shorter list. */
              <TourSection
                key={section.kind}
                section={section}
                repoFullName={activeRepo?.full_name}
                indexedSha={data.indexed_sha}
              />
            ))}
          </div>

          {/* AC-35: one link per section, in the same order, resolving to the heading id
              the card renders. A `<nav>` with an accessible name, so it is announced as
              navigation and skippable. */}
          <nav aria-label={t("rail.label")} style={s.rail}>
            <div style={s.railLabel}>{t("rail.label")}</div>
            {data.sections.map((section) => (
              <a
                key={section.kind}
                href={`#${sectionHeadingId(section.kind)}`}
                style={s.railLink}
              >
                {/* The server's title wins and the catalogue's is the fallback — the
                    same rule the card applies to the heading this link points at, so a
                    degraded skeleton's untitled section is named identically in both. */}
                {section.title.trim() || t(`sectionTitle.${section.kind}`)}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </AppShell>
  );
}

export default OnboardingView;
