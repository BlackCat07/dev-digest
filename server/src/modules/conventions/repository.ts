import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import { SCAN_STALE_AFTER_MS } from './constants.js';

/**
 * Data access for the conventions module.
 *
 * Every read is workspace-scoped, including the ones that already have a repo
 * id: a repo id is a uuid a caller could guess at, and scoping on both is what
 * makes a wrong-tenant id return nothing instead of someone else's candidates.
 *
 * No raw `sql` templates here on purpose — every filter is expressible with
 * `eq`/`and`/`inArray`, and a hand-written template is where a JS `Date` gets
 * interpolated and fails at runtime with a message that names nothing.
 */

export type { ConventionRow, ConventionScanRow };

export interface NewCandidate {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: ConventionRow['category'];
  rule: string;
  rationale: string;
  evidence: ConventionRow['evidence'];
  matcher: string | null;
  adherenceConforming: number | null;
  adherenceViolating: number | null;
  confidence: number;
}

export interface ScanCounters {
  status: ConventionScanRow['status'];
  commitSha?: string | null;
  eligibleFiles?: number;
  sampledFiles?: number;
  proposed?: number;
  droppedUnverified?: number;
  droppedLowAdherence?: number;
  kept?: number;
  costUsd?: number | null;
  error?: string | null;
  finishedAt?: Date | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  // --- scans ---------------------------------------------------------------

  async createScan(
    workspaceId: string,
    repoId: string,
    options: unknown,
  ): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId, status: 'queued', options: options ?? {} })
      .returning();
    return row!;
  }

  async updateScan(scanId: string, patch: ScanCounters): Promise<void> {
    await this.db.update(t.conventionScans).set(patch).where(eq(t.conventionScans.id, scanId));
  }

  async latestScan(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row;
  }

  /**
   * Whether a scan is genuinely in flight for this repo.
   *
   * A `queued`/`running` row only counts as active while it is RECENT. A worker
   * that died mid-scan — a crashed process, a killed dev server — leaves its row
   * `running` forever, and treating that as active bricks the repo: every later
   * scan is refused, the budget reports `scan_running`, and the only cure is
   * editing the database, which is not something a user of this screen can do.
   * After {@link SCAN_STALE_AFTER_MS} the row is abandoned and a new scan may
   * start over it.
   *
   * `now` is a parameter so the rule is testable without waiting five minutes.
   */
  async activeScan(
    workspaceId: string,
    repoId: string,
    now: Date = new Date(),
  ): Promise<ConventionScanRow | undefined> {
    const latest = await this.latestScan(workspaceId, repoId);
    if (!latest) return undefined;
    if (latest.status !== 'queued' && latest.status !== 'running') return undefined;
    const age = now.getTime() - latest.startedAt.getTime();
    return age < SCAN_STALE_AFTER_MS ? latest : undefined;
  }

  // --- candidates ----------------------------------------------------------

  /**
   * The candidate list, in a **total** order.
   *
   * `confidence DESC` alone is not one: a scan routinely produces several rules
   * at the same confidence (a measured 62/62 is 1.0, and so is the next one), and
   * for tied rows Postgres is free to return whatever order the scan happens to
   * read them in. Accepting a candidate UPDATEs its row, which writes a new
   * tuple version elsewhere in the heap — so the card the user just triaged
   * *moved down its tie group* on the next refetch. It looked like a deliberate
   * "sort the triaged to the bottom" feature; it was tie-breaking by physical
   * row position.
   *
   * `createdAt` then `id` make the order fixed: triage can no longer reorder the
   * list, and `composeSkill` (which reads through here) writes the rules in the
   * same order twice for the same input.
   */
  async listCandidates(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(
        desc(t.conventions.confidence),
        asc(t.conventions.createdAt),
        asc(t.conventions.id),
      );
  }

  async insertCandidates(rows: NewCandidate[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(t.conventions).values(rows).returning();
  }

  /**
   * Clear the untriaged candidates of a repo before a fresh scan writes.
   *
   * Only `pending` rows go. An accepted candidate is part of a skill someone
   * generated, and a rejected one is a decision the next scan must respect —
   * deleting either would make re-scanning undo the user's work, which is the
   * one thing that would stop anyone re-scanning.
   */
  async deletePending(workspaceId: string, repoId: string): Promise<number> {
    const deleted = await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      )
      .returning({ id: t.conventions.id });
    return deleted.length;
  }

  async getCandidate(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .limit(1);
    return row;
  }

  async candidatesByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<ConventionRow, 'status' | 'rule' | 'rationale' | 'category' | 'edited'>>,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set(patch)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Record which skill a set of candidates was folded into. */
  async linkSkill(workspaceId: string, ids: string[], skillId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.conventions)
      .set({ skillId })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }
}
