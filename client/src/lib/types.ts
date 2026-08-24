/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  SpecFile,
  IndexStatus,
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";

/**
 * Eval Pipeline (L06) — `contracts/eval-batch.ts`.
 *
 * TYPES ONLY, like everything else in this file. The runtime values these
 * screens need — the period options, the metric order, the expectation badges
 * and the percentage-point formatter — live in `src/lib/eval.ts` and are never
 * taken from the contract's zod enums: a VALUE import of `@devdigest/shared`
 * resolves under `tsc` and under `vitest`, then 500s every route that
 * transitively reaches it (`client/INSIGHTS.md`, 2026-08-03).
 */
export type {
  EvalExpectation,
  EvalAnchor,
  EvalCaseOutcome,
  EvalNotRunReason,
  EvalRefusalReason,
  EvalAgentCase,
  EvalCaseSave,
  EvalBatchStatus,
  EvalBatch,
  EvalBatchCaseResult,
  EvalMetrics,
  EvalComparison,
  EvalPeriod,
  EvalBatchTrendPoint,
  EvalDashboardRow,
  EvalWorkspaceDashboard,
  EvalRunAllResult,
} from "@devdigest/shared";

/** UI-only view model for a PR list row (derives display fields from PrMeta). */
export interface PrRowView {
  number: number;
  title: string;
  author: string;
  size: "S" | "M" | "L";
  sizeLines: string;
  score: number;
  findings: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  status: "needs_review" | "reviewed" | "stale";
  updated: string;
}
