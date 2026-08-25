/* ExportWizard — the four-step export, as a modal inside the CI tab.

   A modal and not a route: the flow starts and ends on the agent editor, no
   criterion names a route, and a route would need a nav entry, a breadcrumb and
   a `page.tsx` for a dialog. NOT wrapped in `<Suspense>` — a boundary here makes
   the server emit the fallback instead of the screen, which passes every gate
   and paints a blank rectangle (`client/INSIGHTS.md`, 2026-08-04).

   Everything the user entered is held HERE, above the step components, which is
   what makes AC-56 and AC-61 fall out for free: a failed preview or a failed
   install re-renders one step and touches no value. Nothing is mirrored into a
   second `useState` — the file count, the "can continue" flag and the current
   step's component are all derived during render.

   The step indicator is drawn locally rather than with the vendored
   `ExportWizardSteps`: that primitive paints every label after the current one
   `var(--text-muted)`, and AC-65 requires all four to declare
   `var(--text-primary)`. `client/src/vendor/ui/` is not ours to give a prop to,
   so the six lines are composed here at the same sizes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import type { Agent, CiExportInput } from "@devdigest/shared";
import { CI_DEFAULT_POST_AS, CI_DEFAULT_TARGET, CI_DEFAULT_TRIGGERS, isRepoSlug, sortCiFiles } from "@/lib/ci";
import { useCiPreview, useExportToCi } from "@/lib/hooks/ci";
import { STEP_CONFIGURE, STEP_INSTALL, STEP_PREVIEW, STEP_TARGET, WIZARD_STEPS } from "../../constants";
import { s } from "../../styles";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";

/** The numbered rail above the body. Every label declares `--text-primary` (AC-65). */
function WizardSteps({ step, labels }: { step: number; labels: readonly string[] }) {
  return (
    <div style={s.steps}>
      {labels.map((label, i) => (
        <React.Fragment key={label}>
          <div style={s.step}>
            <span
              aria-hidden="true"
              style={{
                ...s.stepBullet,
                background: i < step ? "var(--ok)" : i === step ? "var(--accent)" : "var(--bg-elevated)",
                color: i <= step ? "#fff" : "var(--text-muted)",
                border: i > step ? "1px solid var(--border-strong)" : "none",
              }}
            >
              {i < step ? <Icon.Check size={13} /> : i + 1}
            </span>
            <span style={{ ...s.stepLabel, fontWeight: i === step ? 600 : 500 }}>{label}</span>
          </div>
          {i < labels.length - 1 && (
            <span
              style={{ ...s.stepRule, background: i < step ? "var(--ok)" : "var(--border-strong)" }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function ExportWizard({
  agent,
  initialRepo,
  onClose,
}: {
  agent: Agent;
  /** Pre-filled by the "Update CI" entry — the same path, one field already answered. */
  initialRepo: string;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const [step, setStep] = React.useState(STEP_TARGET);
  const [repo, setRepo] = React.useState(initialRepo);
  const [triggers, setTriggers] = React.useState<string[]>([...CI_DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<CiExportInput["post_as"]>(CI_DEFAULT_POST_AS);

  const preview = useCiPreview();
  const install = useExportToCi();

  // Derived during render, never mirrored into state: a second copy of any of
  // these is the "derive, don't store" antipattern and the one place a wizard
  // reliably grows a stale flag.
  const files = preview.data ? sortCiFiles(preview.data.files) : [];
  const canContinue =
    step === STEP_TARGET ? isRepoSlug(repo) : step === STEP_PREVIEW ? preview.isSuccess : true;

  const request = { agentId: agent.id, repo: repo.trim(), target: CI_DEFAULT_TARGET, post_as: postAs, triggers };

  /**
   * Continue. Leaving Target STARTS the generation — in the handler and not in
   * an effect, because "the user pressed Continue" is an event, not an external
   * system to synchronise with.
   */
  const onContinue = () => {
    if (step === STEP_TARGET) {
      preview.reset();
      preview.mutate(request);
    }
    setStep((cur) => Math.min(cur + 1, STEP_INSTALL));
  };

  return (
    <Modal
      width={760}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={
        <div style={s.wizardFooter}>
          <Button kind="ghost" onClick={() => setStep((c) => Math.max(c - 1, STEP_TARGET))} disabled={step === STEP_TARGET || install.isPending}>
            {t("exportWizard.back")}
          </Button>
          <div style={s.wizardFooterRight}>
            {step < STEP_INSTALL ? (
              <Button kind="primary" icon="ArrowRight" onClick={onContinue} disabled={!canContinue}>
                {t("exportWizard.continue")}
              </Button>
            ) : (
              <Button
                kind="primary"
                icon="Upload"
                onClick={() => install.mutate(request)}
                disabled={install.isPending || install.isSuccess}
                loading={install.isPending}
              >
                {install.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.wizardBody}>
        <WizardSteps step={step} labels={WIZARD_STEPS.map((k) => t(k))} />
        {step === STEP_TARGET && <TargetStep target={CI_DEFAULT_TARGET} repo={repo} onRepo={setRepo} />}
        {step === STEP_PREVIEW && (
          <PreviewStep files={files} isPending={preview.isPending} error={preview.error} />
        )}
        {step === STEP_CONFIGURE && (
          <ConfigureStep triggers={triggers} onTriggers={setTriggers} postAs={postAs} onPostAs={setPostAs} />
        )}
        {step === STEP_INSTALL && (
          <InstallStep
            repo={repo.trim()}
            fileCount={files.length}
            installed={install.isSuccess}
            prUrl={install.data?.pr_url ?? null}
            error={install.error}
          />
        )}
      </div>
    </Modal>
  );
}
