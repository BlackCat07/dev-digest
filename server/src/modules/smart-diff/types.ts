/**
 * Ports and row shapes for the Smart Diff module (L03b).
 *
 * Types only — no runtime code — so nothing here can participate in an import
 * cycle and the whole module's dependency surface is readable in one file.
 */
import type { SmartDiffRole } from '@devdigest/shared';

/** One changed file, as much of `pr_files` as this module reads. */
export interface SmartDiffPrFile {
  /**
   * Included solely as the last-resort tiebreaker in the within-group order.
   * `pr_files` has no unique index on `(pr_id, path)`, so `path` alone is not
   * provably total — see `groups.ts`.
   */
  id: string;
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/**
 * A changed file with its role decided.
 *
 * Classification happens ONCE, in the service, and both consumers — the groups
 * and the split suggestion — take the result. Letting each call `classifyPath`
 * itself would be two sources of one truth, and a split whose buckets disagreed
 * with the groups on screen would be the least debuggable kind of wrong.
 */
export interface ClassifiedFile {
  readonly file: SmartDiffPrFile;
  readonly role: SmartDiffRole;
}

/**
 * One `reviews` row, as much of it as the findings reduction reads.
 *
 * `agentId` is nullable and that is load-bearing, not defensive typing:
 * `reviews.agent_id` carries neither an FK nor `notNull`, and the SEEDED review
 * has it as `null`. `kind` is `string` rather than the table's union because
 * this module filters it itself — `reviewsForPull` does not.
 */
export interface SmartDiffReviewRow {
  id: string;
  agentId: string | null;
  kind: string;
}

/** One `findings` row, as much of it as the join reads. */
export interface SmartDiffFindingRow {
  file: string;
  startLine: number;
}

/**
 * The persistence this module reads, stated as a port.
 *
 * Implemented by `ReviewRepository` (`modules/reviews/repository.ts`), which
 * satisfies it STRUCTURALLY — this module names no Drizzle row type, imports
 * nothing from `src/db/`, and owns no repository of its own. That last part is
 * deliberate and follows `modules/intent/`: `pr_files`, `reviews` and `findings`
 * belong to the review domain's data layer, and two repositories over one table
 * is the failure onion layering exists to prevent.
 *
 * `reviewsForPull` returns rows NEWEST-FIRST. The reduction in `findings.ts`
 * depends on that and cannot verify it, so it is part of this contract.
 */
export interface SmartDiffStore {
  getPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;
  getPrFiles(prId: string): Promise<readonly SmartDiffPrFile[]>;
  reviewsForPull(prId: string): Promise<
    readonly { review: SmartDiffReviewRow; findings: readonly SmartDiffFindingRow[] }[]
  >;
}

/**
 * Everything Smart Diff needs from the outside world — one port.
 *
 * That single entry is the feature's central claim, expressed in the type
 * system: there is **no LLM port here**, no GitHub, no git, no job queue and no
 * clock. The module is structurally incapable of making a model request, which
 * is why the route can be a plain synchronous read with no job, no cache table
 * and no cost. `test/smart-diff-service.test.ts` pins this with a `Proxy` that
 * throws on any key other than `reviewRepo`.
 *
 * A structural interface rather than `Container`, for the reason `IntentDeps`
 * states: `platform/container.ts` names this module, so naming `Container` here
 * would close a `no-circular` cycle (`server/INSIGHTS.md`, 2026-08-10). The
 * composition root still passes itself straight in.
 */
export interface SmartDiffDeps {
  readonly reviewRepo: SmartDiffStore;
}

/**
 * The one line this module ever writes, as a port.
 *
 * Optional on `build` so tests call it with nothing, and structural so
 * `req.log` (Pino) satisfies it without this module importing Fastify. Debug
 * level, never warn: the thing it reports — findings citing files the PR no
 * longer changes — is expected drift rather than a fault, and a warn would train
 * readers to ignore the log.
 */
export interface SmartDiffLog {
  debug(payload: Record<string, unknown>, message: string): void;
}
