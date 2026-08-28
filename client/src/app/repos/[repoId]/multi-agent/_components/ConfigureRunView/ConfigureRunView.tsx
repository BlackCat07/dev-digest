/* ConfigureRunView — the Configure-run screen at /repos/:repoId/multi-agent.

   Two numbered steps, in this order and never the other (AC-52): choose a pull
   request, then choose the agents to fan it out to. The order is the whole
   design — the agent step cannot show an agent's last verdict, and the run
   action cannot know where to POST, until a pull request is picked, so step 2
   renders disabled with an explanation rather than half-live (AC-54).

   Three things here are easy to get subtly wrong and are each pinned by a test:

   1. The pull-request step lists OPEN pull requests only (AC-53) — open meaning
      a status that is neither `merged` nor `closed`. The sidebar's Pull
      Requests badge counts `needs_review` alone, so it can never equal this
      count; the two numbers legitimately differ and neither is to be changed to
      agree with the other.
   2. The aggregate's duration is the MAXIMUM of the selected means and its cost
      is their SUM (AC-57). The agents run concurrently, so the fan-out finishes
      with its slowest member while every member is still paid for.
   3. Every figure here is an ESTIMATE, and the word is in the copy. It is the
      mean of what this agent's last ten successful runs took anywhere in the
      workspace — a statement about the past, not a prediction about this diff.
      A 4 000-line pull request will overrun it (EC-26).

   All copy comes from the `runs` namespace, which is this feature's own and the
   one the trace drawer already reads; keys resolve out of any namespace, so a
   wrong one shows another feature's words with no warning at all. */
"use client";

import React from "react";
import { notFound, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  SelectInput,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, AgentRunEstimate } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { formatDurationSeconds } from "@/lib/format";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useAgents, usePrReviews, usePulls } from "@/lib/hooks";
import { useAgentEstimates, useStartMultiRun } from "@/lib/hooks/multi-agent";
import { NO_ESTIMATE } from "./constants";
import {
  aggregateEstimate,
  estimatesByAgent,
  formatEstimateCost,
  latestReviewByAgent,
  openPullsDescending,
  type AggregateEstimate,
} from "./helpers";
import { s } from "./styles";

export function ConfigureRunView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: pulls, isLoading: pullsLoading, isError: pullsError } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const startRun = useStartMultiRun();

  // The two selections are the only state this screen owns. Everything else on
  // the page — the option list, the aggregate, the run action's count — is
  // derived during render from these two plus the queries, because a stored
  // copy is a second source of truth that goes stale the moment an agent is
  // deleted or a pull request is merged under the open tab.
  const [selectedNumber, setSelectedNumber] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([]);

  const openPulls = openPullsDescending(pulls ?? []);
  const selectedPull = openPulls.find((p) => String(p.number) === selectedNumber) ?? null;

  // Scoped to the SELECTED pull request (AC-55) and to nothing while none is
  // selected — the hook is disabled on a null id, so step 2 costs no request
  // until it has something to say.
  const { data: reviews } = usePrReviews(selectedPull?.id ?? null);

  const agentList = agents ?? [];
  const estimateOf = estimatesByAgent(estimates ?? []);
  const reviewOf = latestReviewByAgent(reviews ?? []);

  // Intersected with the agents that still exist rather than trusted as stored:
  // an id left behind by a deleted agent would otherwise inflate the run
  // action's count and be POSTed to a 404.
  const selected = agentList.filter((a) => selectedIds.includes(a.id));
  const aggregate = aggregateEstimate(selected.map((a) => estimateOf.get(a.id)));

  const canRun = selected.length > 0 && selectedPull?.id != null && !startRun.isPending;

  const toggleAgent = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAll = () => setSelectedIds(agentList.map((a) => a.id));

  const run = () => {
    const prId = selectedPull?.id;
    if (!canRun || !prId || !selectedPull) return;
    startRun.mutate(
      { prId, agentIds: selected.map((a) => a.id) },
      { onSuccess: () => router.push(`/repos/${repoId}/multi-agent/${selectedPull.number}`) },
    );
  };

  // A :repoId matching no repo belongs to the repo-scoped 404 boundary that owns
  // that copy for every screen under /repos, exactly as the PR list, Conventions
  // and Project Context screens do it. After the hooks, never before.
  if (repoNotFound) notFound();

  const repoName = activeRepo?.full_name ?? repoId;

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("page.crumb") }]}>
      <div style={s.page}>
        <header style={s.header}>
          <h1 style={s.title}>{t("configure.title")}</h1>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
        </header>

        <section style={s.step}>
          <PullRequestStep
            loading={pullsLoading}
            error={pullsError}
            options={openPulls.map((p) => ({
              value: String(p.number),
              label: t("page.prItem", { number: p.number, title: p.title }),
            }))}
            value={selectedNumber}
            onChange={setSelectedNumber}
          />
        </section>

        <section style={s.step}>
          <StepHead index={2} label={t("configure.step2")} disabled={!selectedPull}>
            {selectedPull && agentList.length > 0 && (
              <span style={s.stepHeadSpacer}>
                <Button kind="tertiary" size="sm" onClick={selectAll}>
                  {t("configure.selectAll")}
                </Button>
              </span>
            )}
          </StepHead>

          {/* AC-54: worded, not merely dimmed. The sentence is the carrier, and
              the icon and the muted palette only echo it. The heading reuses
              the step's own label rather than inventing a second name for the
              step — no new copy key enters the catalogue for a restyle. */}
          {!selectedPull && (
            <div style={s.disabledStep}>
              <span style={s.disabledIcon}>
                <Icon.GitPullRequest size={21} aria-hidden />
              </span>
              <div style={s.disabledTitle}>{t("configure.selectPrFirstTitle")}</div>
              <p style={s.disabledBody}>{t("configure.selectPrFirst")}</p>
            </div>
          )}

          {selectedPull && agentList.length === 0 && (
            <EmptyState
              icon="Users"
              title={t("page.noAgents.title")}
              body={t("page.noAgents.body")}
              cta={t("page.noAgents.cta")}
              onCta={() => router.push("/agents")}
            />
          )}

          {selectedPull && agentList.length > 0 && (
            <div style={s.cards}>
              {agentList.map((agent) => (
                <AgentRunCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedIds.includes(agent.id)}
                  onToggle={() => toggleAgent(agent.id)}
                  estimate={estimateOf.get(agent.id)}
                  verdict={reviewOf.get(agent.id)?.summary ?? null}
                />
              ))}
            </div>
          )}
        </section>

        <div style={s.runBar}>
          <Button
            kind="primary"
            icon="Play"
            aria-disabled={!canRun}
            loading={startRun.isPending}
            onClick={run}
          >
            {t("configure.run", { count: selected.length })}
          </Button>
          {/* Beside the action, and announced when it changes: the number the
              reviewer is committing to is the one thing on this screen that
              moves without the page moving. */}
          <div role="status" aria-live="polite">
            <EstimateText estimate={aggregate} className="mono" style={s.aggregate} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Step 1 — the open pull requests of this one repository (AC-53, AC-105).
 *
 * The step's own heading is the `<label>` that names the select: `SelectInput`
 * accepts neither `aria-label` nor arbitrary props, and it belongs to the
 * vendored design system, which is extended with new files and never restyled
 * or re-propped for one screen.
 */
function PullRequestStep({
  loading,
  error,
  options,
  value,
  onChange,
}: {
  loading: boolean;
  error: boolean;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("runs");

  const head = <StepHead index={1} label={t("configure.step1")} disabled={false} />;

  if (loading) {
    return (
      <>
        {head}
        <Skeleton height={42} style={s.skeletonRow} />
      </>
    );
  }

  if (error) {
    return (
      <>
        {head}
        <ErrorState title={t("configure.step1")} />
      </>
    );
  }

  // AC-105 / EC-31 — every pull request merged or closed. The step renders its
  // empty state and NOT a select with no options: a picker you can open and
  // find nothing in reads as a broken read, while an empty state reads as an
  // answer.
  //
  // The title is the SENTENCE, not the step heading. Repeating "Choose a pull
  // request" as the title of the thing telling you there is nothing to choose
  // says only what the step is called; AC-105 asks for the state to be stated.
  // The numbered heading still renders above it, so the two steps are in order
  // either way.
  if (options.length === 0) {
    return (
      <>
        {head}
        <EmptyState icon="GitPullRequest" title={t("configure.noOpenPulls")} />
      </>
    );
  }

  return (
    <label style={s.stepBlock}>
      {head}
      <SelectInput
        value={value}
        onChange={onChange}
        mono={false}
        options={[{ value: "", label: t("page.selectPr") }, ...options]}
      />
    </label>
  );
}

/**
 * A step's head row: the numbered badge, the step's label, and whatever the
 * step hangs on the right.
 *
 * The badge is drawn from the step's own INDEX rather than parsed out of the
 * copy — the catalogue owns the words, and a component that split a string on
 * `·` would break the moment the copy is translated. The copy used to open with
 * the digit itself ("1 · Choose a pull request"); it no longer does, because the
 * badge became the carrier and the two together printed the number twice. AC-52
 * asks for two NUMBERED steps in order, and the badge is what numbers them.
 */
function StepHead({
  index,
  label,
  disabled,
  children,
}: {
  index: number;
  label: string;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  return (
    <span style={s.stepHead}>
      <span aria-hidden style={s.stepBadge(disabled)}>
        {index}
      </span>
      <span style={s.stepLabel(disabled)}>{label}</span>
      {children}
    </span>
  );
}

/** One agent card: the checkbox, the name, the last verdict here, the estimate. */
function AgentRunCard({
  agent,
  selected,
  onToggle,
  estimate,
  verdict,
}: {
  agent: Agent;
  selected: boolean;
  onToggle: () => void;
  estimate: AgentRunEstimate | undefined;
  verdict: string | null;
}) {
  return (
    // A group, and named after the agent: the checkbox, the verdict and the
    // estimate are three facts about one agent, and without the grouping a
    // screen reader reads the estimate of card 4 straight after the name of
    // card 3. It also gives this card's contents a name to be scoped by.
    <div role="group" aria-label={agent.name} style={s.card(selected)}>
      {/* The agent's name IS the checkbox's accessible name — an unnamed
          checkbox in a grid of five is invisible to a screen reader, and there
          is nothing else on the card that identifies which agent it toggles. */}
      <Checkbox
        checked={selected}
        onChange={onToggle}
        label={<span style={s.cardName}>{agent.name}</span>}
      />

      {/* AC-55: an agent that has never run on THIS pull request renders no
          verdict line at all — an empty one reads as "it ran and said nothing",
          which is a different and much worse claim. */}
      {verdict && verdict.trim() !== "" && <div style={s.cardVerdict}>{verdict}</div>}

      <EstimateText estimate={toAggregate(estimate)} className="mono" style={s.cardEstimate} />
    </div>
  );
}

/** One agent's estimate in the shape the aggregate renderer already speaks. */
function toAggregate(estimate: AgentRunEstimate | undefined): AggregateEstimate {
  return {
    durationMs: estimate?.mean_duration_ms ?? null,
    costUsd: estimate?.mean_cost_usd ?? null,
  };
}

/**
 * An estimate, or the fact that there isn't one (AC-58, AC-59).
 *
 * Never `0.0s · $0.00`: a missing estimate and a genuinely instant, free run are
 * different answers, and only one of them is worth showing as a number. A
 * present duration with an absent cost is a real combination — an agent on an
 * unpriced model — so the cost half dashes on its own rather than taking the
 * whole line down with it.
 */
function EstimateText({
  estimate,
  style,
  className,
}: {
  estimate: AggregateEstimate;
  style?: React.CSSProperties;
  className?: string;
}) {
  const t = useTranslations("runs");
  // One null check rather than two: the shared formatter already answers `null`
  // for an absent figure, which is the same state this branch renders.
  const duration = formatDurationSeconds(estimate.durationMs);
  if (duration == null) {
    return (
      <span className={className} style={style}>
        {t("configure.estimateUnavailable")}
      </span>
    );
  }
  return (
    <span className={className} style={style}>
      {t("configure.estimate", {
        duration,
        cost: estimate.costUsd == null ? NO_ESTIMATE : formatEstimateCost(estimate.costUsd),
      })}
    </span>
  );
}

export default ConfigureRunView;
