import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { TagRename, type Tag } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { TagsService } from './service.js';

/**
 * F11 — tags.
 *   GET /tags          → the workspace's tags, alphabetical
 *   PUT /tags/:id      → rename one
 */
export default async function tagsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new TagsService(app.container);

  app.get('/tags', async (req): Promise<Tag[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.put('/tags/:id', { schema: { body: TagRename } }, async (req): Promise<Tag> => {
    const { workspaceId } = await getContext(app.container, req);
    const { id } = req.params as { id: string };
    return service.rename(workspaceId, id, req.body.name);
  });
}
