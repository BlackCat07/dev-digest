import type {
  ConventionAdherence,
  ConventionScan,
  ExtractedConvention,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';

/**
 * Pure helpers for the conventions module — row ⇄ DTO mapping and the dedup key.
 * No I/O.
 */

/** Map a persisted candidate row to the public DTO. */
export function toConventionDto(row: ConventionRow): ExtractedConvention {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    rationale: row.rationale,
    evidence: row.evidence,
    confidence: row.confidence,
    adherence: toAdherence(row),
    status: row.status,
    edited: row.edited,
    skill_id: row.skillId,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * The two adherence columns are null together or set together, so one nullable
 * object models them better than two nullable numbers on the wire — a client
 * cannot then render "312 conforming, — violating".
 */
export function toAdherence(
  row: Pick<ConventionRow, 'adherenceConforming' | 'adherenceViolating'>,
): ConventionAdherence | null {
  if (row.adherenceConforming === null || row.adherenceViolating === null) return null;
  return { conforming: row.adherenceConforming, violating: row.adherenceViolating };
}

/** Map a scan row to the public DTO. */
export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    status: row.status,
    commit_sha: row.commitSha,
    eligible_files: row.eligibleFiles,
    sampled_files: row.sampledFiles,
    proposed: row.proposed,
    dropped_unverified: row.droppedUnverified,
    dropped_low_adherence: row.droppedLowAdherence,
    kept: row.kept,
    cost_usd: row.costUsd,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    error: row.error,
  };
}

/**
 * The key two rules are "the same rule" under.
 *
 * A re-scan re-asks the same model the same question, so it proposes the same
 * rules in slightly different words — "Route handlers must not call fetch" and
 * "route handlers never call fetch directly" are one rule. Stripping everything
 * but letters and digits collapses casing, punctuation and filler, which is
 * blunt but predictable; the alternative is embeddings, and a scan that silently
 * merged two genuinely different rules because they scored 0.91 cosine would be
 * much harder to explain than one that occasionally keeps a near-duplicate.
 *
 * Load-bearing for one acceptance rule in particular: a candidate the user
 * REJECTED must not come back on the next scan, and this is what recognises it.
 */
export function ruleKey(rule: string): string {
  return rule.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Scan status from what actually happened.
 *
 * `partial` says the sample was capped — the scan succeeded over less than the
 * whole repository. Keeping that distinct from `done` is what stops the screen
 * from implying it looked everywhere.
 */
export function scanStatusFor(capped: boolean): 'done' | 'partial' {
  return capped ? 'partial' : 'done';
}

/**
 * Highest confidence first, then the better-evidenced rule.
 *
 * Ties broken on evidence count rather than on rule text: when two rules are
 * equally adherent, the one shown in three places is the one worth reading
 * first.
 */
export function byConfidence(a: ExtractedConvention, b: ExtractedConvention): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return b.evidence.length - a.evidence.length;
}
