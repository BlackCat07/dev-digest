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
 *  - contracts/trace      RunTrace, RunEvent, RunLogLine (single-document trace)
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
export * from './contracts/trace.js';
export * from './contracts/platform.js';
export * from './contracts/why.js';
export * from './contracts/eval-ci.js';
export * from './contracts/observability.js';
export * from './contracts/productionize.js';
export * from './adapters.js';
