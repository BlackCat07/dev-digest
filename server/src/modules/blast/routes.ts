import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L04 — blast module.
 *   GET /pulls/:id/blast  → the PR's impact map (symbols → callers → endpoints)
 *
 * Hangs off `/pulls/:id` for the same reason the intent and smart-diff routes do:
 * this is a property OF a pull request, derived fresh on every read, with no id of
 * its own.
 *
 * The module owns NO repository — `pr_files` belongs to the review domain's data
 * layer and is reached through `container.reviewRepo`; every codebase fact comes
 * through the `repoIntel` facade. See `types.ts` for why both are narrow ports
 * rather than the container.
 *
 * NO per-route rate limit, unlike `POST /pulls/:id/intent`. That one is throttled
 * because it costs a model round-trip; this is a workspace-scoped read of already
 * computed index rows, so the global 120/min is the right bound and a tighter one
 * would only make the card feel broken on a refresh.
 *
 * NO `response:` schema, because no route in this server has one — the handler's
 * return type carries the contract. `PrBlastRadius` is nonetheless parsed at
 * runtime in `test/blast.it.test.ts`, which is what stands in for the serializer
 * this codebase does not use.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // From the container rather than `new`-ed here, for the reason
  // `intent/routes.ts` gives: the composition root is the one construction path.
  const service = container.blast;

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<PrBlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      return service.build(workspaceId, req.params.id);
    },
  );
}
