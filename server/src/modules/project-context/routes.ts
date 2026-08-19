import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachmentInput,
  type ContextAttachment,
  type ProjectDocList,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { LIST_RATE_LIMIT } from './constants.js';
import type { ProjectDocContent } from './types.js';

/**
 * L05 — project-context module.
 *   GET  /repos/:id/context            → every markdown document in the clone
 *   GET  /repos/:id/context/doc?path=  → one document's text
 *   GET  /agents/:id/context           → that agent's attachments
 *   POST /agents/:id/context           → replace them, for one repository
 *   GET  /skills/:id/context           → that skill's attachments
 *   POST /skills/:id/context           → replace them, for one repository
 *
 * The first two are the routes `useContextFiles` has always called and that 404
 * today: nothing named `context` was registered in `modules/index.ts`, so the
 * whole feature was four-fifths pre-wired with no server module behind it
 * (`server/INSIGHTS.md`, 2026-08-18).
 *
 * THE ATTACHMENT ROUTES HANG OFF THIS MODULE, not off `agents`/`skills`, and
 * that is deliberate: an attachment is a project-context fact that happens to be
 * addressed by an owner, and mounting it here means no existing module is
 * reshaped to gain a feature it does not own. Fastify's router does not care
 * which plugin declared a path.
 *
 * Transport only — a schema, a service call, a return. Every handler opens with
 * `getContext`, which is what makes the workspace resolution the FIRST thing a
 * request does (AC-12); the 404 for anything outside that workspace is the
 * service's `NotFoundError`, mapped to the `not_found` envelope by the shared
 * error handler.
 *
 * NO `response:` schema, matching every other route in this server: the
 * handler's return type carries the contract, and the service tests parse the
 * assembled payloads against it.
 */

/**
 * `?path=` rather than a wildcard segment, so a path holding a space, a `#` or
 * non-ASCII survives the round trip (EC-15). Fastify has already
 * percent-decoded the value by the time this schema sees it; the confinement
 * that makes an attacker-supplied path safe is the adapter's, not this schema's
 * — a length bound is all that belongs here.
 */
const DocQuery = z.object({ path: z.string().min(1).max(1024) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.projectContext;

  app.get(
    '/repos/:id/context',
    {
      schema: { params: IdParams },
      // Tighter than the global 120/min: this is the only route in the module
      // whose cost is set by the size of the repository rather than by ours.
      config: { rateLimit: { ...LIST_RATE_LIMIT } },
    },
    async (req): Promise<ProjectDocList> => {
      const { workspaceId } = await getContext(container, req);
      return service.listDocs(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req): Promise<ProjectDocContent> => {
      const { workspaceId } = await getContext(container, req);
      // A refusal is a 200 carrying a reason, never a throw (AC-10): a document
      // that vanished between the list and the click is the ordinary case.
      return service.readDoc(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams } },
    async (req): Promise<ContextAttachment[]> => {
      const { workspaceId } = await getContext(container, req);
      // No querystring: the caller gets every repository's attachments and
      // filters client-side, because the `Context` tab shows one repository at a
      // time but the badge counts the agent.
      return service.listAgentDocs(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentInput } },
    async (req): Promise<ContextAttachment[]> => {
      const { workspaceId } = await getContext(container, req);
      return service.setAgentDocs(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams } },
    async (req): Promise<ContextAttachment[]> => {
      const { workspaceId } = await getContext(container, req);
      return service.listSkillDocs(workspaceId, req.params.id);
    },
  );

  app.post(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentInput } },
    async (req): Promise<ContextAttachment[]> => {
      const { workspaceId } = await getContext(container, req);
      return service.setSkillDocs(workspaceId, req.params.id, req.body);
    },
  );
}
