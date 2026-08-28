import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq } from 'drizzle-orm';
import { WebhookCreate, type WebhookDelivery } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { WebhooksService } from './service.js';

/**
 * F9 — outbound webhooks.
 *   GET    /webhooks                  → the workspace's endpoints
 *   POST   /webhooks                  → register an endpoint
 *   DELETE /webhooks/:id              → remove an endpoint
 *   GET    /webhooks/:id/deliveries   → recent delivery attempts, newest first
 *
 * An endpoint is a URL plus the set of events it wants. Delivery is retried by
 * the job runner, so the rows here are a log rather than a queue.
 */
export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhooksService(app.container);

  app.get('/webhooks', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/webhooks', { schema: { body: WebhookCreate } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.register(workspaceId, userId, req.body);
  });

  app.delete('/webhooks/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { id } = req.params as { id: string };
    return service.remove(workspaceId, id);
  });

  /**
   * The deliveries panel is a straight read of the last 50 attempts for one
   * endpoint. It is scoped by workspace as well as by endpoint id so a guessed
   * uuid from another workspace cannot enumerate delivery history.
   */
  app.get('/webhooks/:id/deliveries', async (req): Promise<WebhookDelivery[]> => {
    const { workspaceId } = await getContext(app.container, req);
    const { id } = req.params as { id: string };

    const rows = await app.container.db
      .select({
        id: t.webhookDeliveries.id,
        event: t.webhookDeliveries.event,
        statusCode: t.webhookDeliveries.statusCode,
        attempt: t.webhookDeliveries.attempt,
        createdAt: t.webhookDeliveries.createdAt,
      })
      .from(t.webhookDeliveries)
      .innerJoin(t.webhooks, eq(t.webhooks.id, t.webhookDeliveries.webhookId))
      .where(and(eq(t.webhookDeliveries.webhookId, id), eq(t.webhooks.workspaceId, workspaceId)))
      .orderBy(desc(t.webhookDeliveries.createdAt))
      .limit(50);

    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      statusCode: r.statusCode,
      attempt: r.attempt,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
