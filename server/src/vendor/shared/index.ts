/**
 * @devdigest/shared — single source of truth for cross-package contracts.
 *
 * Exports (Zod schemas + inferred TS types):
 *  - contracts/findings   Review, Finding, Severity, Verdict, FindingAction, trifecta
 *  - contracts/brief      Intent, BlastRadius, Risks, PrHistory, SmartDiff, PrBrief
 *  - contracts/knowledge  Conformance, Onboarding, EvalRun/EvalCase, MemoryItem,
 *                         Skill/CommunitySkill, ConventionCandidate, Agent
 *  - contracts/skills     SkillVersion, SkillUsage/SkillWithUsage, SkillStats,
 *                         SkillImportPayload (L02; extends Skill, never edits it)
 *  - contracts/conventions ExtractedConvention, ConventionScan/Budget, the scan
 *                         and skill-generation payloads (L02; extends
 *                         ConventionCandidate, never edits it)
 *  - contracts/intent     IntentSource, IntentStatus, PrIntent, DeriveIntentPayload
 *                         (L03; extends PrIntentRecord, never edits it)
 *  - contracts/blast      BlastStatus/BlastReason, BlastEndpoint, BlastDownstream,
 *                         PrBlastRadius (L04; reuses brief's ChangedSymbol /
 *                         DownstreamImpact, never edits them)
 *  - contracts/prior-prs  PriorPr, PriorPrsCoverage, PrPriorPrs (L04; the history
 *                         half of the Blast Radius card, deliberately its own
 *                         document rather than a field on PrBlastRadius)
 *  - contracts/project-context ProjectDoc, ProjectDocList, ContextAttachment,
 *                         ContextAttachmentInput, EffectiveContextDoc (L05; new
 *                         symbols only — SpecFile, IndexStatus and
 *                         RunTrace.specs_read are consumed unchanged)
 *  - contracts/onboarding OnboardingSectionKind/Status/Reason, OnboardingCommand,
 *                         OnboardingPathNote, OnboardingTask,
 *                         OnboardingTourSection, OnboardingTour (L05; new symbols
 *                         only — knowledge's Onboarding/OnboardingSection are
 *                         untouched and OnboardingLink is reused by import)
 *  - contracts/pr-brief   RiskLevel, BriefStatus/BriefReason, BriefSourceKind/
 *                         Status, BriefSource, ReviewFocusItem, BriefDiffStats,
 *                         BriefGenerationState, PrRiskBrief, GenerateBriefPayload
 *                         (L05; new symbols only — brief's PrBrief is untouched
 *                         and Risk / RiskSeverity are reused by import)
 *  - contracts/trace      RunTrace, RunEvent, RunLogLine (single-document trace)
 *  - contracts/eval-batch EvalExpectation/Anchor, EvalCaseOutcome/NotRunReason,
 *                         EvalRefusalReason, EvalAgentCase, EvalCaseSave,
 *                         EvalBatch/Status/CaseResult, EvalMetrics,
 *                         EvalComparison, EvalBatchTrendPoint, EvalPeriod,
 *                         EvalDashboardRow, EvalWorkspaceDashboard,
 *                         EvalRunAllResult (L06; new symbols only — knowledge's
 *                         EvalCase/EvalOwnerKind and eval-ci's EvalRunRecord /
 *                         EvalTrendPoint / EvalDashboard are untouched)
 *  - contracts/platform   Settings, ConnTestResult, Repo, PrMeta/PrDetail, SpecFile, …
 *  - adapters             adapter interfaces + ModelInfo
 *
 * Feature agents (A1–A6) and F2 import everything from here. The barrel is
 * stable — feature agents EXTEND with new files, they do not edit existing ones.
 */

export * from './contracts/findings.js';
export * from './contracts/review-api.js';
export * from './contracts/brief.js';
export * from './contracts/knowledge.js';
export * from './contracts/skills.js';
export * from './contracts/conventions.js';
export * from './contracts/intent.js';
export * from './contracts/blast.js';
export * from './contracts/prior-prs.js';
export * from './contracts/project-context.js';
export * from './contracts/onboarding.js';
export * from './contracts/pr-brief.js';
export * from './contracts/trace.js';
export * from './contracts/platform.js';
export * from './contracts/why.js';
export * from './contracts/eval-ci.js';
export * from './contracts/eval-batch.js';
export * from './contracts/eval-draft.js';
export * from './contracts/observability.js';
export * from './contracts/productionize.js';
export * from './adapters.js';
