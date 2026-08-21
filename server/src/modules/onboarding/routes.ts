import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OnboardingTour } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L05 — onboarding module.
 *   GET  /repos/:id/onboarding          → the repository's single tour
 *   POST /repos/:id/onboarding/generate → 202, enqueues the generation job
 *
 * A tour is a property of a repository, so both routes hang off `/repos/:id` —
 * the shape `/repos/:id/conventions` + `/repos/:id/conventions/scan` already
 * uses. The read answers `200` with no sections for a repository nobody has
 * generated one for, never `404` (AC-2); the only `404` here is a repository
 * outside the caller's workspace.
 *
 * Transport only: a schema, `getContext`, one service call, a return. Every
 * handler opens with `getContext`, which is what makes the workspace resolution
 * the first thing a request does — the service's own `NotFoundError` is what the
 * shared error handler turns into the `not_found` envelope, and its
 * `ValidationError` is the 422 a concurrent generation is refused with (there is
 * no `ConflictError` in this server, and `ConventionsService.requestScan` refuses
 * the same way).
 *
 * NO `response:` schema, matching every other route here: the handler's return
 * type carries the contract and the service tests parse the payload against it.
 *
 * Job-handler registration lives here, exactly as it does in `conventions` and
 * `repo-intel`: this plugin runs once at boot, and the runner keeps the handler
 * closure rather than the service instance. `app.log` is handed over at the same
 * moment — the service holds no sink of its own, so the one line a completed
 * generation writes (AC-13) lands in the app's own logger.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.onboarding;
  service.registerJobHandler(app.log);

  app.get(
    '/repos/:id/onboarding',
    {
      schema: { params: IdParams },
      // A read is one row and a parse, and the screen polls it while a
      // generation runs — generous, and still under the global 120/minute.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<OnboardingTour> => {
      const { workspaceId } = await getContext(container, req);
      return service.getTour(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      schema: { params: IdParams },
      // Per REPOSITORY, not per caller: a generation spends a model call, and
      // `## Non-functional` states the cap that way. The plugin keys on IP by
      // default, which cannot express it.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (req: FastifyRequest) =>
            `onboarding:${(req.params as { id?: string }).id ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const accepted = await service.requestGeneration(workspaceId, req.params.id, app.log);
      reply.code(202);
      return accepted;
    },
  );
}
