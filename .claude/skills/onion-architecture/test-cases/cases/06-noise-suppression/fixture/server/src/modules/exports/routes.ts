import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { ExportsService } from './service.js';
import { ExportRequest, filenameFor } from './types.js';

/**
 * F13 — exports.
 *   POST /repos/:repoFullName/export → a downloadable bundle in the chosen format
 */
export default async function exportsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ExportsService(app.container);

  app.post(
    '/repos/:repoFullName/export',
    { schema: { body: ExportRequest } },
    async (req, reply) => {
      const { workspaceId, workspaceSlug } = await getContext(app.container, req);
      const { repoFullName } = req.params as { repoFullName: string };

      const body = await service.build(workspaceId, repoFullName, req.body);
      reply.header('content-disposition',
        `attachment; filename="${filenameFor(req.body.format, workspaceSlug)}"`);
      return body;
    },
  );
}
