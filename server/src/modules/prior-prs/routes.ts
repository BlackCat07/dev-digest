import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrPriorPrs } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L04 — prior-prs module.
 *   GET /pulls/:id/prior-prs  → earlier pull requests that touched the same files
 *
 * Hangs off `/pulls/:id` like the intent, smart-diff and blast routes, for the same
 * reason: this is a property OF a pull request, derived fresh on every read, with
 * no id of its own.
 *
 * A SEPARATE module from `blast/` even though the client renders both inside one
 * card. Blast Radius is a read of the codebase index and says so in its spec; this
 * is a read of pull-request history. Folding it into that route would have cost the
 * impact map its simplest true statement — "every fact here comes from the index" —
 * and given the card one loading state where two are more useful: the map is the
 * headline and must not wait on a history query.
 *
 * NO per-route rate limit and NO `response:` schema, both for the reasons
 * `blast/routes.ts` states: this is a workspace-scoped read of already-stored rows,
 * and no route in this server declares a response schema — the handler's return
 * type carries the contract, and `test/prior-prs.it.test.ts` parses the real
 * payload against it.
 */
export default async function priorPrsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = container.priorPrs;

  app.get(
    '/pulls/:id/prior-prs',
    { schema: { params: IdParams } },
    async (req): Promise<PrPriorPrs> => {
      const { workspaceId } = await getContext(container, req);
      return service.build(workspaceId, req.params.id);
    },
  );
}
