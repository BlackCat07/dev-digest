import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ExportItem } from './types.js';

/** F13 — data-access for the export bundle. */
export class ExportsRepository {
  constructor(private readonly db: Db) {}

  itemsFor(
    workspaceId: string,
    prNumbers: number[],
    includeFindings: boolean,
  ): Promise<ExportItem[]> {
    return this.db
      .select({
        prNumber: t.pullRequests.number,
        title: t.pullRequests.title,
        score: t.reviews.score,
        findingCount: includeFindings
          ? sql<number>`count(${t.findings.id})`.mapWith(Number)
          : sql<number>`0`.mapWith(Number),
      })
      .from(t.pullRequests)
      .leftJoin(t.reviews, eq(t.reviews.prId, t.pullRequests.id))
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          inArray(t.pullRequests.number, prNumbers),
        ),
      )
      .groupBy(t.pullRequests.number, t.pullRequests.title, t.reviews.score);
  }
}
