/* EvalCaseDraftModal — the modal `Turn into eval case` opens, over a case that
   does not exist yet.

   **The button files nothing.** It derives a draft (`POST /eval/cases/drafts`,
   which writes no row) and opens this; `Save` is the only control that adds
   anything to the agent's eval set. That is the whole reason the unit exists: an
   eval set is the dataset an agent's recall, precision and citation accuracy are
   computed from, and a set that grows by one row per button press is a set whose
   numbers nobody trusts.

   **`Run case` is the point of the modal, not a preview.** It runs the draft
   against the agent as it is configured right now and records NOTHING — no
   batch, no run row, no dashboard movement — so a reader can press it three or
   four times and watch whether the finding actually reproduces before committing
   it. The strip on the right states every run and tallies them, because "passed
   twice out of three" is the answer a single green banner would hide.

   Three things are read-only and one is editable, and the split follows what a
   draft IS. The diff, the files and the PR meta are the evidence cut out of the
   pull request the finding was reported on — presenting them as fields would
   invite editing the evidence. The expectation and its anchors are derived from
   the human decision on the finding and are not the client's to change. The
   name and the expected output are the two things a curator genuinely writes,
   so those get controls.

   The JSON gate closes `Save` and deliberately NOT `Run case`: the expected
   output is what will be stored, while a run is scored on the expectation and
   the anchors alone. Blocking a run on a trailing comma would refuse to answer a
   question the comma has nothing to do with. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  Modal,
  Tabs,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { EvalAgentCase, EvalCaseDraft, EvalTrialRunResult } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format";
import {
  EVAL_EXPECTATION_BADGE,
  EVAL_OUTCOME_COLOR,
  formatDurationMs,
  lastRunLabelKey,
  parseExpected,
  stringifyExpected,
} from "@/lib/eval";
import {
  useCreateEvalCase,
  useStartEvalBatch,
  useTrialRunEvalCase,
} from "../../../../../../../lib/hooks/eval";
import { EXPECTED_ROWS, INPUT_TABS, MODAL_WIDTH, TRIAL_HISTORY_LIMIT } from "./constants";
import { anchorLines, diffLines, outcomesDisagree, tallyTrials } from "./helpers";
import { s } from "./styles";

export function EvalCaseDraftModal({
  draft,
  onClose,
  onSaved,
}: {
  /** The derived case, as the server computed it. Nothing about it is stored. */
  draft: EvalCaseDraft;
  /** Dismissed without saving. */
  onClose: () => void;
  /** Saved — the case now exists, and the finding card says so. */
  onSaved: (created: EvalAgentCase) => void;
}) {
  const t = useTranslations("eval");
  const trial = useTrialRunEvalCase();
  const create = useCreateEvalCase();
  const runBatch = useStartEvalBatch();

  /* Seeded from the draft and then owned here: this is an editor, so the text
     being edited is genuinely local state. The parent mounts this keyed on the
     finding id, so opening a different finding remounts rather than needing a
     reset effect. */
  const [name, setName] = React.useState(draft.name);
  const [expectedText, setExpectedText] = React.useState(() =>
    stringifyExpected(draft.expected_output),
  );
  const [inputTab, setInputTab] = React.useState<string>("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);

  /**
   * Every trial run of this draft, newest first.
   *
   * A LIST and not the latest result, because the question the button answers is
   * whether the finding reproduces — one green run says nothing about that, and
   * the mutation itself only ever holds its most recent answer. Capped, so a
   * reader who presses it twenty times still gets one readable line.
   */
  const [runs, setRuns] = React.useState<EvalTrialRunResult[]>([]);

  /**
   * The case, once it exists.
   *
   * Only reachable when `Run on save` was on and the batch it asked for did not
   * start: the save succeeded, so the modal must not offer to save again, and it
   * stays open purely to say what happened. Every other successful save closes.
   */
  const [saved, setSaved] = React.useState<EvalAgentCase | null>(null);

  /* Escape closes it. The vendored `Modal` draws a Close button and dims the
     page but binds no key, and a dialog with no keyboard exit is a trap for
     anyone not using a pointer. A window listener rather than a handler on the
     dialog, because focus starts on the page behind it. */
  const dismiss = React.useCallback(() => {
    if (saved) onSaved(saved);
    else onClose();
  }, [saved, onSaved, onClose]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const expected = parseExpected(expectedText);
  const negative = draft.expectation === "must_not_flag";
  const badge = EVAL_EXPECTATION_BADGE[draft.expectation];
  const anchor = draft.expected_anchors[0];
  const lines = anchorLines(anchor);
  const latest = runs[0];
  const tally = tallyTrials(runs);
  const busy = trial.isPending || create.isPending || runBatch.isPending;

  const run = () => {
    if (busy) return;
    trial.mutate(
      {
        agentId: draft.agent_id,
        name,
        // The draft's own diff, verbatim: the case that gets saved must be the
        // one that was run, and the diff is not editable here for that reason.
        input_diff: draft.input_diff,
        expectation: draft.expectation,
        expected_anchors: draft.expected_anchors,
      },
      { onSuccess: (r) => setRuns((prev) => [r, ...prev].slice(0, TRIAL_HISTORY_LIMIT)) },
    );
  };

  const save = () => {
    if (!expected.valid || busy || saved) return;
    create.mutate(
      {
        finding_id: draft.source.finding_id,
        name,
        input_diff: draft.input_diff,
        expected_output: expected.value,
      },
      {
        onSuccess: (created) => {
          if (!runOnSave) {
            onSaved(created);
            return;
          }
          /* `Run on save` starts a real, RECORDED batch over this one case —
             which is the difference between it and `Run case` above, and the
             reason it is off by default: a recorded run moves the agent's
             dashboard, and that is a thing to opt into. The case is already
             saved by the time this fires, so a refusal (another batch is
             running) keeps the modal open to say so rather than losing the
             save. */
          setSaved(created);
          runBatch.mutate(
            { agentId: draft.agent_id, caseId: created.id },
            { onSuccess: () => onSaved(created) },
          );
        },
      },
    );
  };

  const errorMessage = (err: unknown): string =>
    err instanceof ApiError ? err.message : String(err);

  const inputTabs = INPUT_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));
  const expectedLabel = negative
    ? t("caseEditor.negativeExpectedOutputLabel")
    : t("caseEditor.expectedOutput");

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("caseEditor.caseTitle", { name })}
      subtitle={t("caseDraft.subtitle", { decision: t(`caseDraft.decision.${draft.source.decision}`) })}
      onClose={dismiss}
      footer={
        <div style={s.footer}>
          {/* Off by default, unlike the design's mock: this one starts a
              RECORDED batch, and a control that moves an agent's metrics is
              opted into rather than out of. */}
          <label style={s.runOnSave}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={15} />
            {t("caseDraft.runOnSave")}
          </label>
          <span style={s.runNote}>{t("caseDraft.targetSet", { agent: draft.agent_name })}</span>
          <Button kind="ghost" onClick={dismiss}>
            {saved ? t("caseEditor.close") : t("caseDraft.cancel")}
          </Button>
          {/* Not gated on the JSON: a run is scored on the expectation and the
              anchors, and a trailing comma in the stored assertion has nothing
              to do with whether the finding reproduces. */}
          <Button
            kind="secondary"
            icon="Play"
            onClick={run}
            aria-disabled={busy || !!saved || undefined}
            style={busy || saved ? s.blocked : undefined}
          >
            {trial.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
          </Button>
          {/* `aria-disabled` and not `disabled`: the control stays reachable and
              announces WHY it cannot be used, which is the whole point of
              putting the precondition in its accessible name. The handler
              guards itself, so the name is not the only thing enforcing it. */}
          <Button
            kind="primary"
            icon="Check"
            onClick={save}
            aria-disabled={!expected.valid || busy || !!saved || undefined}
            aria-label={expected.valid ? undefined : t("caseEditor.saveDisabledInvalidJson")}
            style={expected.valid && !saved ? undefined : s.blocked}
          >
            {create.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <section style={s.inputs} aria-label={t("caseEditor.inputLabel")}>
          {/* What this case asserts, in words, before anything else. A reader who
              misses the direction reads every number below it backwards. */}
          <div style={s.assertion(negative)} role="note">
            <Icon.Target size={15} style={{ color: negative ? "var(--text-muted)" : "var(--accent)", flexShrink: 0 }} />
            <span>
              <b style={s.assertionKind(negative)}>
                {negative ? t("caseDraft.negativeCase") : t("caseDraft.positiveCase")}
              </b>
              {negative
                ? t("caseDraft.assertMustNotFlag", { file: draft.source.file, lines })
                : t("caseDraft.assertMustFind", { title: draft.source.title, file: draft.source.file, lines })}
            </span>
          </div>

          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput
              value={name}
              onChange={setName}
              mono
              placeholder={t("caseEditor.namePlaceholder")}
              aria-label={t("caseEditor.nameLabel")}
            />
          </FormField>

          <div style={s.sectionLabel}>{t("caseEditor.inputLabel")}</div>
          <Tabs tabs={inputTabs} value={inputTab} onChange={setInputTab} pad="0" />

          {/* Read-only, all three: this is the evidence the finding was reported
              on, and the fragment's line numbers are what the anchors point at.
              A text area here would invite editing the diff out from under the
              anchor with nothing to catch it. */}
          {inputTab === "diff" && (
            <pre className="mono" style={s.pane}>
              {diffLines(draft.input_diff).map((line, i) => (
                <div key={i} style={s.diffLine(line.kind)}>
                  {line.text || " "}
                </div>
              ))}
            </pre>
          )}
          {inputTab === "files" && (
            <pre className="mono" style={s.pane}>
              {stringifyExpected(draft.input_files) || "—"}
            </pre>
          )}
          {inputTab === "prMeta" && (
            <pre className="mono" style={s.pane}>
              {stringifyExpected(draft.input_meta) || "—"}
            </pre>
          )}
        </section>

        <section style={s.expected} aria-label={expectedLabel}>
          <div style={s.columnHeader}>
            <span style={s.sectionLabel}>{expectedLabel}</span>
            <Badge
              color={expected.valid ? "var(--ok)" : "var(--crit)"}
              bg={expected.valid ? "var(--ok-bg)" : "var(--crit-bg)"}
              icon={expected.valid ? "CheckCircle" : "AlertTriangle"}
              style={s.labelBadge}
            >
              {expected.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </Badge>
            <Badge color={badge.color} bg={badge.bg} icon={badge.icon} style={s.labelBadge}>
              {t(badge.labelKey)}
            </Badge>
            <div style={s.headerSpacer} />
            {/* Puts the seeded skeleton back — the finding as the agent reported
                it. A reader who edited the assertion into nonsense has one press
                back to the derived one, which is why it is here and not only in
                the first render. */}
            <Button
              kind="ghost"
              size="sm"
              icon="Plus"
              title={t("caseDraft.findingSkeletonHint")}
              onClick={() => setExpectedText(stringifyExpected(draft.expected_output))}
            >
              {t("caseDraft.findingSkeleton")}
            </Button>
          </div>

          {/* No `aria-label` here: the vendored `Textarea` takes five props and
              forwards nothing else, so one would be silently dropped rather than
              rendered. The enclosing `<section aria-label>` names the region,
              which is what a reader lands on. */}
          <Textarea
            value={expectedText}
            onChange={setExpectedText}
            rows={EXPECTED_ROWS}
            mono
          />

          {/* The run strip. `role="status"` because it changes in response to a
              press the reader just made, and it is progress rather than an
              alert. */}
          <div role="status">
            {latest ? (
              <div style={s.runResult(EVAL_OUTCOME_COLOR[latest.outcome])}>
                <Icon.CheckCircle
                  size={16}
                  style={{ color: EVAL_OUTCOME_COLOR[latest.outcome], flexShrink: 0 }}
                />
                <span>
                  <b style={s.runOutcome(EVAL_OUTCOME_COLOR[latest.outcome])}>
                    {t(lastRunLabelKey(latest.outcome))}
                    {latest.not_run_reason ? ` — ${t(`notRunReason.${latest.not_run_reason}`)}` : ""}
                  </b>{" "}
                  ·{" "}
                  {t("caseDraft.runSummary", {
                    expected: latest.expected_count ?? "—",
                    actual: latest.actual_count ?? "—",
                    duration: formatDurationMs(latest.duration_ms),
                    cost: formatCost(latest.cost_usd),
                  })}
                </span>
              </div>
            ) : (
              <div style={s.runNote}>
                <Icon.FlaskConical size={14} />
                <span>{t("caseDraft.notRunYet")}</span>
              </div>
            )}
          </div>

          {/* The tally, and the hint that earns the whole modal: a case that
              passed twice out of three will flake in every batch it appears in,
              and one green banner hides exactly that. */}
          {runs.length > 0 && (
            <div style={s.runNote}>
              <span>{t("caseDraft.runTally", { runs: tally.runs, passed: tally.passed })}</span>
              {(runs.length < 2 || outcomesDisagree(runs)) && <span>{t("caseDraft.reproHint")}</span>}
            </div>
          )}

          {trial.error && (
            <div role="alert" style={s.error}>
              {t("caseDraft.runError", { message: errorMessage(trial.error) })}
            </div>
          )}
          {create.error && (
            <div role="alert" style={s.error}>
              {t("caseDraft.saveError", { message: errorMessage(create.error) })}
            </div>
          )}
          {runBatch.error && (
            <div role="alert" style={s.error}>
              {t("caseDraft.runOnSaveFailed", { message: errorMessage(runBatch.error) })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

export default EvalCaseDraftModal;
