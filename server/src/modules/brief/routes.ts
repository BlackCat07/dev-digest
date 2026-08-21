import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GenerateBriefPayload, type PrRiskBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L05 — brief module.
 *   GET  /pulls/:id/brief          → the pull request's single brief
 *   POST /pulls/:id/brief/generate → 202, enqueues the generation job
 *
 * Both paths hang off `/pulls/:id` because a brief is a property OF a pull
 * request — it has no id of its own, `pr_brief`'s primary key IS the pull-request
 * id, and there is exactly one current brief per pull request. That is the shape
 * `/pulls/:id/intent` and `/repos/:id/onboarding` already use.
 *
 * The read answers `200` with an empty document for a pull request nobody has
 * generated a brief for, never `404`; the only `404` here is a pull request
 * outside the caller's workspace, and it is answered before any intent row, blast
 * fact, document or clone path is reached, because every handler opens with
 * `getContext` and the service's first await is the workspace-scoped pull-request
 * lookup.
 *
 * Transport only: a schema, `getContext`, one service call, a return. The
 * freshness rule, the concurrency refusal, the staleness window and the
 * assembly's budget all belong to `BriefService`, and nothing here holds a copy
 * of any of them. The service's `NotFoundError` is what the shared error handler
 * turns into the `not_found` envelope, and its `ValidationError` is the 422 a
 * concurrent generation is refused with — there is no `ConflictError` in this
 * server, and `OnboardingService.requestGeneration` refuses the same way.
 *
 * NO `response:` schema, matching every other route here: the handler's return
 * type carries the contract and the service tests parse the payload against it.
 *
 * Job-handler registration lives here, exactly as it does in `conventions`,
 * `onboarding` and `repo-intel`: this plugin runs once at boot, and the runner
 * keeps the handler closure rather than the service instance. `app.log` is handed
 * over at the same moment — the service holds no sink of its own, so the one line
 * a completed generation writes lands in the app's own logger.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.brief;
  service.registerJobHandler(app.log);

  app.get(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams },
      // A read is one row, a key computation and a parse, and the card polls it
      // while a generation runs — generous, and still under the global
      // 120/minute.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<PrRiskBrief> => {
      const { workspaceId } = await getContext(container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief/generate',
    {
      // The body is OPTIONAL and `force` is the only field it can carry: the
      // card's regenerate control sends `{ force: true }`, and a caller that
      // means to rebuild must SEND it — a mutation that omits an optional flag is
      // a silently successful no-op (`client/INSIGHTS.md`, 2026-08-11).
      schema: { params: IdParams, body: GenerateBriefPayload.nullish() },
      // Per PULL REQUEST, not per caller: a generation spends a model call, and
      // `## Non-functional` states the cap that way. The plugin keys on IP by
      // default, which cannot express it.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          keyGenerator: (req: FastifyRequest) =>
            `brief:${(req.params as { id?: string }).id ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const force = req.body?.force;
      const accepted = await service.requestGeneration(
        workspaceId,
        req.params.id,
        force === undefined ? {} : { force },
        app.log,
      );
      reply.code(202);
      return accepted;
    },
  );
}
