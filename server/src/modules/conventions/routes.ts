import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ConventionScanOptions,
  CreateConventionSkillPayload,
  UpdateConventionPayload,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * L02 — conventions module.
 *   GET   /repos/:id/conventions         → scan + budget + candidates, one payload
 *   GET   /repos/:id/conventions/budget  → what a scan would cost, before running one
 *   POST  /repos/:id/conventions/scan    → 202, enqueues the extraction job
 *   PATCH /conventions/:id               → accept / reject / edit one candidate
 *   POST  /repos/:id/conventions/skill   → compose accepted candidates into skills
 *   POST  /repos/:id/conventions/skill/preview → the same composition, unsaved
 *
 * The last route is served here but does not WRITE here: the row goes through
 * `SkillsService.createExtracted`, which owns the `skills` invariants (the
 * version-1 snapshot, and the `source` column that decides whether a body
 * reaches a prompt as instructions or as delimiter-wrapped data). This module
 * owns which candidates are eligible; that one owns what a skill row may be.
 *
 * The two path shapes are deliberate too. A scan is a property of a repo, so it
 * hangs off `/repos/:id`; a candidate has an id of its own and outlives the scan
 * that produced it, so triage does not need the repo in the path.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // Registered once at boot, the same shape as repos/repo-intel: the JobRunner
  // keeps the handler closure, so a locally-constructed service is equivalent
  // to a container-held one — both share the DB.
  const service = new ConventionsService(container);
  service.registerScanJobHandler();

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.payload(workspaceId, req.params.id);
  });

  app.get('/repos/:id/conventions/budget', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.budget(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/scan',
    { schema: { params: IdParams, body: ConventionScanOptions } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const scan = await service.requestScan(workspaceId, req.params.id, req.body);
      reply.code(202);
      return scan;
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateConventionSkillPayload } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const skills = await service.generateSkills(workspaceId, req.params.id, req.body);
      reply.code(201);
      return skills;
    },
  );

  // Declared before the create route documents itself as the writing one: this
  // is the same composition with nothing persisted, so the modal previews the
  // exact text the next call saves.
  app.post(
    '/repos/:id/conventions/skill/preview',
    { schema: { params: IdParams, body: CreateConventionSkillPayload } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.previewSkills(workspaceId, req.params.id, req.body);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionPayload } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );
}
