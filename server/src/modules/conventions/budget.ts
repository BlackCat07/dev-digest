import type {
  ConventionBudgetCap,
  ConventionScanBlocker,
  ConventionScanBudget,
} from '@devdigest/shared';
import { MAX_SAMPLE_FILES, MAX_SAMPLE_TOKENS, SCAN_CATEGORIES } from './constants.js';

/**
 * What a scan would cost, worked out before running one.
 *
 * The point is to answer honestly for a two-file repo and a four-thousand-file
 * one with the same call, cheaply enough to run on page load. So nothing here
 * walks a directory: the file counts come from `file_rank`, which the indexer
 * already wrote, and the size comes from `stat`-ing the planned sample — at most
 * {@link MAX_SAMPLE_FILES} paths we already know the names of.
 *
 * The estimate is deliberately an over-estimate of what a scan will read: it
 * assumes every planned file is read in full, while the real scan drops
 * oversized files and stops at the token ceiling. A budget that came in over the
 * quoted figure would be worse than useless.
 */

/**
 * Bytes → tokens for source code.
 *
 * The tokenizer would be exact, but it needs the text, and reading 120 files to
 * price a scan the user has not asked for yet defeats the purpose. Four bytes
 * per token is the same heuristic `approxTokens` uses, and it runs slightly high
 * on code — which is the direction an estimate should err.
 */
export function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export interface BudgetInput {
  /** Files the indexer indexed for this repo. */
  indexedFiles: number;
  /** Ranked, junk-filtered paths this scan could choose from, after subtrees. */
  eligibleFiles: number;
  /** Total bytes of the planned sample, from `stat`. */
  sampleBytes: number;
  /** Files in the planned sample (already capped). */
  plannedSample: number;
  /** How many categories this scan would ask about. */
  categories?: number;
  /** Price for the resolved model, or null when unknown. */
  estimatedCostUsd: number | null;
  blockedReason: ConventionScanBlocker | null;
}

/**
 * Which ceiling a scan of this size would hit.
 *
 * Tokens wins when both bind, because that is the one attached to a bill: told
 * "capped by files" a user raises the file cap and is surprised nothing changes.
 */
export function capFor(eligibleFiles: number, plannedTokens: number): ConventionBudgetCap | null {
  if (plannedTokens >= MAX_SAMPLE_TOKENS) return 'tokens';
  if (eligibleFiles > MAX_SAMPLE_FILES) return 'files';
  return null;
}

export function computeBudget(input: BudgetInput): ConventionScanBudget {
  const categories = input.categories ?? SCAN_CATEGORIES.length;
  const plannedTokens = Math.min(tokensFromBytes(input.sampleBytes), MAX_SAMPLE_TOKENS);

  return {
    indexed_files: input.indexedFiles,
    eligible_files: input.eligibleFiles,
    planned_sample: input.plannedSample,
    planned_tokens: plannedTokens,
    // One selection call, then one extraction call per category.
    planned_calls: input.blockedReason ? 0 : categories + 1,
    estimated_cost_usd: input.estimatedCostUsd,
    capped_by: capFor(input.eligibleFiles, plannedTokens),
    can_scan: input.blockedReason === null,
    blocked_reason: input.blockedReason,
  };
}

/**
 * The budget of a repo that cannot be scanned at all.
 *
 * Reported rather than thrown: the screen still has to render, and "this repo
 * has not been cloned yet" is a state with its own copy and a disabled button,
 * not an error dialog.
 */
export function blockedBudget(reason: ConventionScanBlocker): ConventionScanBudget {
  return {
    indexed_files: 0,
    eligible_files: 0,
    planned_sample: 0,
    planned_tokens: 0,
    planned_calls: 0,
    estimated_cost_usd: null,
    capped_by: null,
    can_scan: false,
    blocked_reason: reason,
  };
}
