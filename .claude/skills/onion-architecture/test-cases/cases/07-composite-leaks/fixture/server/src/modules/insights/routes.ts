import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type InsightsReport } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { InsightsService } from './service.js';

/**
 * L07 — insights.
 *   GET /insights?from=&to=  -> the reliability report for the window
 */
export default async function insightsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new InsightsService(app.container.insights);

  app.get('/insights', async (req): Promise<InsightsReport> => {
    await getContext(app.container, req);
    const { from, to } = req.query as { from: string; to: string };
    return service.report(from, to);
  });
}
