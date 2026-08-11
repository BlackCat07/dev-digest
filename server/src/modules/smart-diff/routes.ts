import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * L03b — smart-diff module.
 *   GET /pulls/:id/smart-diff  → the PR's changed files, grouped by role
 *
 * Hangs off `/pulls/:id` for the same reason the intent routes do: this is a
 * property OF a pull request, derived fresh on every read, with no id of its own.
 *
 * The module owns NO repository — `pr_files`, `reviews` and `findings` belong to
 * the review domain's data layer and are reached through `container.reviewRepo`.
 * See the note above the queries in `../reviews/repository/pull.repo.ts`.
 *
 * NO per-route rate limit, unlike `POST /pulls/:id/intent`. That one is throttled
 * because it costs a model round-trip; this is a workspace-scoped read of rows the
 * same request already loaded for the diff, so the global 120/min is the right
 * bound and a tighter one would only make the tab feel broken on a refresh.
 *
 * NO `response:` schema, because no route in this server has one — the handler's
 * return type carries the contract. `SmartDiff` is nonetheless parsed at runtime
 * in `test/smart-diff.it.test.ts`, which is what stands in for the serializer this
 * codebase does not use.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // From the container rather than `new`-ed here, for the reason
  // `intent/routes.ts` gives: the composition root is the one construction path.
  const service = container.smartDiff;

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(container, req);
      return service.build(workspaceId, req.params.id, req.log);
    },
  );
}
