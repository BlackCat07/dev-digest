/* CaseEditorModal — one eval case, opened from the agent's Evals tab.

   A MODAL and not a route: the negative case's presentation is described as a
   modal, the `Modal` primitive is used everywhere else in this app for the same
   job, and no criterion names a URL for a case. `messages/en/eval.json` still
   carries `page.crumbNewCase` / `page.crumbEvalCase`, which imply a route; they
   stay unused, like the rest of that catalogue's later-lesson keys.

   Three things are editable and the rest is not, and the split follows the
   contract rather than taste: `EvalCaseSave` carries the name, the input diff,
   the expectation, the anchors and the expected output. The name, the diff and
   the expected output get controls; the expectation and the anchors are rendered
   read-only and sent back unchanged, because they are the ASSERTION a stored
   batch's numbers were computed against — changing one silently re-labels every
   figure already recorded, and no criterion asks for it here.

   The JSON gate is derived during render, never mirrored into state: the badge,
   `Save` and `Run case` all read one `parseExpected` call on the current text,
   so a trailing comma flips all three in the same commit. */
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
} from "@devdigest/ui";
import type { EvalAgentCase, EvalBatchCaseResult } from "@devdigest/shared";
import { EVAL_EXPECTATION_BADGE } from "@/lib/eval";
import { formatCost } from "@/lib/format";
import { useSaveEvalCase, useStartEvalBatch } from "@/lib/hooks/eval";
import { DIFF_ROWS, EXPECTED_ROWS, INPUT_TABS, LAST_RUN_COLOR, MODAL_WIDTH } from "./constants";
import {
  formatDurationMs,
  lastRunLabelKey,
  parseExpected,
  resolveLastRun,
  stringifyExpected,
} from "./helpers";
import { s } from "./styles";

export function CaseEditorModal({
  evalCase,
  agentId,
  batchResult,
  onClose,
}: {
  evalCase: EvalAgentCase;
  agentId: string;
  /** This case's row in the agent's most recent completed batch, if it has one. */
  batchResult: EvalBatchCaseResult | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const save = useSaveEvalCase();
  const runCase = useStartEvalBatch();

  /* Seeded from the case and then owned here: this is an editor, so the text
     being edited is genuinely local state and not a mirror of the query cache.
     The case id is part of the key the parent mounts this under, so opening a
     different case remounts rather than needing a reset effect. */
  const [name, setName] = React.useState(evalCase.name);
  const [diff, setDiff] = React.useState(evalCase.input_diff);
  const [expectedText, setExpectedText] = React.useState(() =>
    stringifyExpected(evalCase.expected_output),
  );
  const [inputTab, setInputTab] = React.useState<string>("diff");

  /* Escape closes it. The vendored `Modal` draws a Close button and dims the
     page but binds no key, and a dialog with no keyboard exit is a trap for
     anyone not using a pointer. A window listener rather than a handler on the
     dialog, because focus starts on the page behind it. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const expected = parseExpected(expectedText);
  const negative = evalCase.expectation === "must_not_flag";
  const badge = EVAL_EXPECTATION_BADGE[evalCase.expectation];
  const forbidden = evalCase.expected_anchors[0] ?? null;
  const lastRun = resolveLastRun(evalCase, batchResult);

  const submit = () => {
    if (!expected.valid) return;
    save.mutate({
      caseId: evalCase.id,
      body: {
        name,
        input_diff: diff,
        expectation: evalCase.expectation,
        expected_anchors: evalCase.expected_anchors,
        expected_output: expected.value,
      },
    });
  };

  const run = () => {
    if (!expected.valid) return;
    runCase.mutate({ agentId, caseId: evalCase.id });
  };

  const inputTabs = INPUT_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));
  /* The expected-output column is labelled differently on a negative case: it
     asserts the ABSENCE of a finding at the anchor, which is the opposite of
     what the same JSON means on a positive one. */
  const expectedLabel = negative
    ? t("caseEditor.negativeExpectedOutputLabel")
    : t("caseEditor.expectedOutput");

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("caseEditor.caseTitle", { name: evalCase.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {/* The badge sits with the two controls it gates, so the reason they
              are unavailable is beside them and not at the top of a scroll. */}
          <Badge
            color={expected.valid ? "var(--ok)" : "var(--crit)"}
            bg={expected.valid ? "var(--ok-bg)" : "var(--crit-bg)"}
            icon={expected.valid ? "CheckCircle" : "AlertTriangle"}
          >
            {expected.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
          </Badge>
          <div style={s.footerSpacer} />
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditor.close")}
          </Button>
          {/* `aria-disabled` and not `disabled`: the control stays reachable and
              announces WHY it cannot be used, which is the whole point of
              putting the precondition in its accessible name. The handler
              guards itself, so the name is not the only thing enforcing it. */}
          <Button
            kind="secondary"
            icon="Play"
            onClick={run}
            aria-disabled={!expected.valid || runCase.isPending}
            aria-label={expected.valid ? undefined : t("caseEditor.runDisabledInvalidJson")}
            style={expected.valid ? undefined : s.blocked}
          >
            {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
          </Button>
          <Button
            kind="primary"
            onClick={submit}
            aria-disabled={!expected.valid || save.isPending}
            aria-label={expected.valid ? undefined : t("caseEditor.saveDisabledInvalidJson")}
            style={expected.valid ? undefined : s.blocked}
          >
            {save.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {negative && (
          <div style={s.negativeBanner} role="note">
            <Icon.Slash size={14} />
            <span>
              {t("caseEditor.negativeBanner", {
                file: forbidden?.file ?? "—",
                low: forbidden?.low_line ?? "—",
                high: forbidden?.high_line ?? "—",
              })}
            </span>
          </div>
        )}

        {lastRun && (
          <div style={s.lastRun}>
            <span style={s.lastRunHeading}>{t("caseEditor.lastRunHeading")}</span>
            <Badge color={LAST_RUN_COLOR[lastRun.outcome]} bg="var(--bg-hover)" style={s.labelBadge}>
              {t(lastRunLabelKey(lastRun.outcome))}
              {lastRun.reason ? ` — ${t(`notRunReason.${lastRun.reason}`)}` : ""}
            </Badge>
            <span style={s.lastRunSummary}>
              {t("caseEditor.lastRunSummary", {
                expected: lastRun.expected ?? "—",
                actual: lastRun.actual ?? "—",
                duration: formatDurationMs(lastRun.durationMs),
                cost: formatCost(lastRun.costUsd),
              })}
            </span>
          </div>
        )}

        <FormField label={t("caseEditor.nameLabel")}>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("caseEditor.namePlaceholder")}
            aria-label={t("caseEditor.nameLabel")}
          />
        </FormField>

        <div style={s.columnHeader}>
          <span style={s.columnLabel}>{t("caseEditor.expectationLabel")}</span>
          <Badge color={badge.color} bg={badge.bg} icon={badge.icon} style={s.labelBadge}>
            {t(badge.labelKey)}
          </Badge>
        </div>
        <ul style={s.anchors}>
          {evalCase.expected_anchors.map((a) => (
            <li key={`${a.file}:${a.low_line}-${a.high_line}`} style={s.anchorRow} className="mono">
              {t("caseEditor.anchorRow", {
                file: a.file,
                low: a.low_line,
                high: a.high_line,
              })}
            </li>
          ))}
        </ul>

        <div style={s.columns}>
          <section style={s.column} aria-label={t("caseEditor.inputLabel")}>
            <div style={s.columnHeader}>
              <span style={s.columnLabel}>{t("caseEditor.inputLabel")}</span>
            </div>
            <Tabs tabs={inputTabs} value={inputTab} onChange={setInputTab} pad="0" />
            {inputTab === "diff" && (
              <Textarea
                value={diff}
                onChange={setDiff}
                rows={DIFF_ROWS}
                mono
                placeholder={t("caseEditor.diffPlaceholder")}
              />
            )}
            {/* Read-only: `EvalCaseSave` does not carry either jsonb column, so a
                control here would offer an edit the save cannot send. */}
            {inputTab === "files" && (
              <pre className="mono" style={s.readonlyBlock}>
                {stringifyExpected(evalCase.input_files) || "—"}
              </pre>
            )}
            {inputTab === "prMeta" && (
              <pre className="mono" style={s.readonlyBlock}>
                {stringifyExpected(evalCase.input_meta) || "—"}
              </pre>
            )}
          </section>

          <section style={s.column} aria-label={expectedLabel}>
            <div style={s.columnHeader}>
              <span style={s.columnLabel}>{expectedLabel}</span>
            </div>
            <Textarea
              value={expectedText}
              onChange={setExpectedText}
              rows={EXPECTED_ROWS}
              mono
            />
          </section>
        </div>
      </div>
    </Modal>
  );
}

export default CaseEditorModal;
