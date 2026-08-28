import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Digest, DigestRow } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { DigestService } from './service.js';
import { DIGEST_MAX_ROWS, DIGEST_WINDOW_DAYS } from './constants.js';

/**
 * F12 — weekly digest.
 *   GET /digest          → the assembled digest for the current window
 *   GET /digest/counts   → just the headline numbers, for the nav badge
 */
export default async function digestRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestService(app.container);

  app.get('/digest', async (req): Promise<Digest> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.assemble(workspaceId);
  });

  /**
   * The badge needs two integers and nothing else, so it reads them directly
   * rather than assembling the whole digest and discarding the body.
   */
  app.get('/digest/counts', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 86_400_000);

    const [counts] = await app.container.db
      .select({
        reviews: sql<number>`count(distinct ${t.reviews.id})`.mapWith(Number),
        findings: sql<number>`count(${t.findings.id})`.mapWith(Number),
      })
      .from(t.reviews)
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.reviews.workspaceId, workspaceId), gte(t.reviews.createdAt, since)));

    const recent: DigestRow[] = await app.container.db
      .select({ id: t.reviews.id, score: t.reviews.score, createdAt: t.reviews.createdAt })
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), gte(t.reviews.createdAt, since)))
      .orderBy(desc(t.reviews.createdAt))
      .limit(DIGEST_MAX_ROWS);

    return { ...counts, recent };
  });
}
