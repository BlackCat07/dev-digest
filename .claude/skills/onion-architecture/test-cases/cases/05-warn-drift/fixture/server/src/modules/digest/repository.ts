import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ReviewRow } from './service.js';

/** Digest data-access over the `reviews` table. */
export class DigestRepository {
  constructor(private readonly db: Db) {}

  reviewsSince(workspaceId: string, since: Date): Promise<ReviewRow[]> {
    return this.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), gte(t.reviews.createdAt, since)))
      .orderBy(desc(t.reviews.createdAt));
  }
}
