/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, and the five-control action row. Accept/dismiss reflect persisted
   timestamps.

   The action row is five controls: `Accept`, `Dismiss`, `Turn into eval case`,
   `Learn` and `Reply to author`. Only the first three do anything — `Learn` and
   `Reply to author` are rendered `aria-disabled` and carry no handler, because
   the design's action row is five wide while those two features are not built.
   They are announced as unavailable rather than merely dimmed, which is the
   difference between "not yet" and "broken".

   `Turn into eval case` is the one control that arrives as an OPTIONAL prop: the
   mutation belongs to the panel that owns the list (`FindingsPanel`), and a card
   rendered by anything that does not own it simply gets no eval control instead
   of reaching for a hook it cannot satisfy. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import {
  EVAL_REFUSAL_FALLBACK_KEY,
  EVAL_REFUSAL_MESSAGE_KEY,
  SEV_COLOR,
  SEV_COLOR_FALLBACK,
} from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

/**
 * Where this card's eval case stands. Passed in, never stored here: the panel
 * owns the request, so it owns the state, and a copy in this component would be
 * a second source of truth for one press.
 *
 * `opening` and NOT `adding`: the press derives a draft and opens an editor over
 * it, and nothing is added to the agent's eval set until a human saves that
 * draft. A label promising otherwise would be the one sentence on this screen
 * that describes the previous behaviour.
 */
export type EvalCaseState = "idle" | "opening" | "added";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  targeted,
  onAction,
  pending,
  repoFullName,
  headSha,
  onTurnIntoEvalCase,
  evalCaseState = "idle",
  evalRefusalCode,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  /**
   * This card is what the screen was navigated to (`?finding=<id>`), so it brings
   * itself into view. See the effect below for why that is this component's job.
   */
  targeted?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * Open an eval case derived from this finding, for the agent that produced it.
   *
   * OPTIONAL, and the control renders only when it is supplied — the request is a
   * mutation, and a card cannot own one without the query client its parent
   * provides. Absent, the row is four controls and nothing breaks.
   *
   * It ADDS NOTHING. The parent derives a draft and opens an editor over it; the
   * eval set changes when that editor is saved and at no other moment.
   *
   * It is called only on a DECIDED finding: an accepted or dismissed finding is
   * what carries the expectation the case is scored against, and the server
   * derives that expectation itself.
   */
  onTurnIntoEvalCase?: () => void;
  /** Where that request stands for THIS card. */
  evalCaseState?: EvalCaseState;
  /**
   * The server's named refusal for this card, straight off `ApiError.code`, or
   * null/undefined when there is nothing to say.
   *
   * A `string` rather than the `EvalRefusalReason` union on purpose: what arrives
   * over the wire is whatever the server sent, including a code this build has
   * never heard of, and narrowing that at the prop boundary would be a cast
   * pretending to be a check. The lookup below handles the unknown case.
   */
  evalRefusalCode?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);

  /**
   * Scroll a targeted card into view, exactly once.
   *
   * It lives here rather than in the panel because only the card knows its own
   * element, and the panel would have to reach for it by id right after a render
   * that may not have mounted it yet. The effect touches nothing but the DOM and a
   * ref, which is what an effect is for.
   *
   * The ref is the idempotence guard: an accept, a dismiss or a re-fetch re-renders
   * this card with `targeted` still true, and without the guard every one of those
   * would yank the page back. `block: "start"` plus the measured
   * `scrollMarginTop` in `styles.ts` is what keeps the title clear of the sticky
   * PR header.
   */
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const landed = React.useRef(false);
  React.useEffect(() => {
    if (!targeted || landed.current) return;
    landed.current = true;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [targeted]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  /**
   * A finding becomes an eval case only once a human has decided it — the
   * decision IS the expectation (`must_find` for an accepted finding,
   * `must_not_flag` for a dismissed one), so there is nothing to derive before
   * one exists.
   *
   * The control is still rendered in that state, `aria-disabled`, with the
   * precondition in its accessible name. Hiding it would leave nothing on screen
   * to teach the reader that the order is decide-then-add.
   *
   * Everything below is derived from props on each render; none of it is state.
   */
  const decided = accepted || dismissed;
  const evalInert = !decided || evalCaseState !== "idle";
  const evalLabel =
    evalCaseState === "opening"
      ? t("finding.turnIntoEvalCaseOpening")
      : evalCaseState === "added"
        ? t("finding.turnIntoEvalCaseAdded")
        : t("finding.turnIntoEvalCase");
  const evalRefusal = evalRefusalCode
    ? t(EVAL_REFUSAL_MESSAGE_KEY[evalRefusalCode] ?? EVAL_REFUSAL_FALLBACK_KEY)
    : null;

  return (
    <div ref={rootRef} data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {/* Only 'out_of_scope' is badged. In-scope needs no marker, and an
                UNLABELLED finding (scope null — every finding written before the
                Intent Layer) must look exactly as it did before. */}
            {f.scope === "out_of_scope" && (
              <span style={s.outOfScopeTag}>{t("finding.outOfScope")}</span>
            )}
            {/* One chip, never two: the server clears the other timestamp, and
                the chip is the state in WORDS — the only channel that does not
                depend on the reader distinguishing green from grey. */}
            {decided && (
              <span style={s.decisionTag(accepted)}>
                {accepted ? t("finding.accepted") : t("finding.dismissed")}
              </span>
            )}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            {/* `active` is NOT passed to either control, and its absence is the
                fix: `Button` honours that prop only for `kind: "tertiary"`, so on
                a `secondary` and a `ghost` it was silently inert and neither
                button ever showed which one had been pressed. `s.chosenAction`
                goes through `style`, which the primitive spreads last.

                `aria-pressed` carries the same fact to a screen reader, where a
                background colour carries nothing at all. */}
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              aria-pressed={accepted}
              style={accepted ? s.chosenAction(true) : undefined}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              aria-pressed={dismissed}
              style={dismissed ? s.chosenAction(false) : undefined}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {onTurnIntoEvalCase && (
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                /* `aria-disabled`, NOT `disabled`: the control stays focusable
                   and announced so a screen reader reaches the sentence that
                   names the precondition. The handler is simply absent while it
                   is inert, which is what makes a click a no-op — there is no
                   guard to forget inside a callback that was never attached. */
                aria-disabled={evalInert || undefined}
                aria-label={decided ? undefined : t("finding.turnIntoEvalCaseDisabled")}
                style={evalInert ? s.inertAction : undefined}
                /* Wrapped, not passed straight through: `onClick` would hand the
                   click event to a callback declared as taking nothing, and the
                   panel's handler already knows which finding this is. */
                onClick={evalInert ? undefined : () => onTurnIntoEvalCase()}
              >
                {evalLabel}
              </Button>
            )}
            {/* Not built (spec non-goal N3), and rendered anyway: the action row
                is five controls wide in the design, and a reader who cannot see
                them has no way to know these exist. Announced as unavailable
                rather than silently dead — no handler, ever. */}
            <Button
              kind="ghost"
              size="sm"
              icon="Lightbulb"
              aria-disabled
              aria-label={t("finding.learnDisabled")}
              style={s.inertAction}
            >
              {t("finding.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="MessageSquare"
              aria-disabled
              aria-label={t("finding.replyToAuthorDisabled")}
              style={s.inertAction}
            >
              {t("finding.replyToAuthor")}
            </Button>
          </div>

          {/* The refusal sits BELOW the actions and disables none of them: it is
              about the eval case, not about the finding, so accepting or
              dismissing stays available while it is on screen. `role="alert"`
              because it appears in response to a press the reader just made. */}
          {evalRefusal && (
            <div role="alert" style={s.evalRefusal}>
              {evalRefusal}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
