/* FindingDetail — the expanded half of a finding row in tabs mode (AC-72,
   AC-74, AC-75, AC-76).

   **Three worded actions, and that is a decision rather than an omission.** The
   design's action row is five wide: `Accept`, `Dismiss`, `Turn into eval case`,
   `Learn` and `Reply to author`. The last two are not built and not rendered
   here — there is no memory module behind `Learn`, and `Reply to author` exists
   on the pull-request page only as an `aria-disabled` placeholder with no
   handler. Shipping two dead controls on a brand-new screen is a review finding,
   not fidelity (SPEC-06 N-1, N-2). The pull-request page renders them because
   it inherited them; this screen never will.

   **Nothing here is new machinery.** `Accept` and `Dismiss` go through the
   existing `POST /findings/:id/(accept|dismiss)` and `Turn into eval case`
   through the existing `POST /eval/cases`, both via the hooks the pull-request
   page already uses. What this unit adds is the two sections above them and the
   refusal below them.

   **The collapsed row is not re-rendered here.** It stays in `AgentTabsPane`,
   wrapped in a disclosure, so the severity chip, the CATEGORY tag and the
   confidence read identically before and after expanding — AC-104 asks for
   exactly that, and it is only free while there is one row. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Markdown } from "@devdigest/ui";
import type { AgentColumnFinding } from "@devdigest/shared";
import { useCreateEvalCase, useFindingAction } from "@/lib/hooks";
import { refusalReason } from "./helpers";
import { s } from "./styles";

/**
 * The two decisions this screen records.
 *
 * A narrowing of the contract's `FindingActionKind`, whose other two members
 * (`learn`, `reply`) name the routes behind the two controls this screen does
 * not ship. Narrowing here is what makes "a fourth action, while you are there"
 * a type error rather than a judgement call.
 */
export type FindingDecision = "accept" | "dismiss";

export function FindingDetail({
  finding,
  accepted,
  dismissed,
  onDecided,
}: {
  finding: AgentColumnFinding;
  /** Already accepted — by the server's timestamp, or by a press in this session. */
  accepted: boolean;
  dismissed: boolean;
  /**
   * A decision landed. The row above owns that fact, not this panel: a panel
   * unmounts when the reader collapses the row, and a decision that vanished on
   * collapse would be a lie about what the server holds.
   */
  onDecided: (decision: FindingDecision) => void;
}) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  const evalCase = useCreateEvalCase();

  /**
   * What to say when a press did not land — and never nothing.
   *
   * Two sources, in this order:
   *
   *  - a NAMED refusal, rendered as the server's own sentence. `Turn into eval
   *    case` is deliberately left OPERABLE on an undecided finding, because the
   *    refusal it earns (`finding_has_no_decision`) is the sentence that teaches
   *    the reader the order is decide-then-add, and pre-disabling the control
   *    would replace that sentence with silence;
   *  - any OTHER failure — a 500, a dropped connection, an accept that never
   *    reached the server — rendered as the product's own generic sentence.
   *    `refusalReason` returns null for these because there is no server
   *    sentence worth quoting, and null used to mean nothing was drawn at all:
   *    the reader pressed a button and the screen did not move.
   *
   * Both finding actions feed the same slot. A failed `Accept` is as silent as
   * a failed eval case and is the same defect, so it is not left for later.
   */
  const failure =
    refusalReason(evalCase.error) ??
    (evalCase.isError || action.isError ? t("detail.actionFailed") : null);

  const decide = (decision: FindingDecision) =>
    action.mutate(
      { findingId: finding.id, action: decision },
      { onSuccess: () => onDecided(decision) },
    );

  return (
    <div style={s.panel}>
      {/* No `RATIONALE` label. The reference opens the panel on the agent's
          prose directly, and it is right to: the panel is reached by expanding
          a finding, so the first paragraph in it can only be that finding's
          reasoning, and a label over it names what the reader has already been
          told. `SUGGESTED FIX` below keeps its label because it is the one
          section that is sometimes absent — there, the label is what tells the
          reader which of the two blocks they are looking at. AC-72 asks for the
          rationale to be SHOWN, and does not ask for it to be titled. */}
      <div style={s.prose}>
        <Markdown>{finding.rationale}</Markdown>
      </div>

      {/* No heading above nothing (AC-72): `suggestion` is nullish on the
          contract, and an agent that proposed no fix must not leave a
          `SUGGESTED FIX` label standing over empty space. */}
      {finding.suggestion ? (
        <section style={s.section}>
          <span style={s.sectionLabel}>{t("detail.suggestion")}</span>
          <div style={s.prose}>
            <Markdown>{finding.suggestion}</Markdown>
          </div>
        </section>
      ) : null}

      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          active={accepted}
          disabled={action.isPending}
          onClick={() => decide("accept")}
        >
          {t("detail.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          active={dismissed}
          disabled={action.isPending}
          onClick={() => decide("dismiss")}
        >
          {t("detail.dismiss")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="FlaskConical"
          disabled={evalCase.isPending}
          /* `{ finding_id }` alone is the untouched-draft body `useCreateEvalCase`
             documents: L06 (c3e1930) widened this mutation from a bare finding id
             to `EvalCaseCreate`, whose other three fields the pull-request page's
             draft modal fills in. This detail pane has no such modal and files the
             case as derived, which is what the bare body means. */
          onClick={() => evalCase.mutate({ finding_id: finding.id })}
        >
          {t("detail.turnIntoEvalCase")}
        </Button>
      </div>

      {/* `role="alert"`: it appears in response to a press the reader has just
          made, and it is the only thing on screen that says why nothing
          happened. */}
      {failure ? (
        <div role="alert" style={s.refusal}>
          {failure}
        </div>
      ) : null}
    </div>
  );
}

export default FindingDetail;
