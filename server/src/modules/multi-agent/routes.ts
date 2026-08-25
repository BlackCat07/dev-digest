import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { MultiAgentRun } from '@devdigest/shared';

import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * Multi-Agent Review — the read.
 *   GET /pulls/:id/multi-agent → the pull request's most recent multi-agent run
 *
 * It hangs off `/pulls/:id` because a multi-run is a property OF a pull request
 * — there is exactly one most-recent fan-out per pull request and the client
 * addresses it that way — which is the shape `/pulls/:id/brief`,
 * `/pulls/:id/intent` and `/pulls/:id/runs` already use.
 *
 * Transport only: a schema, `getContext`, one service call, a return
 * (`DDG-ARCH-001`). Which multi-run is "most recent", which score is the real
 * one, how a total is computed and what a group falls back to are all decisions
 * the service makes, and nothing here holds a copy of any of them. Its
 * `NotFoundError` is what the shared error handler turns into the
 * `{"error":{"code":"not_found",…}}` envelope — the SERVICE's envelope, which is
 * the only observable difference between this module being registered in
 * `modules/index.ts` and not being registered at all (`server/INSIGHTS.md`,
 * 2026-08-20), and the reason the route test asserts the body of the 404 rather
 * than only its status.
 *
 * `IdParams` on `params` is the whole input surface: the one user-controlled
 * value this route accepts is a path segment that reaches a query, so it is
 * validated as a uuid at the edge and 422s before the handler runs
 * (`DDG-SEC-003`). The workspace comes from `getContext`, never from the
 * request, and the service scopes every query it issues by it — an id belonging
 * to another tenant answers `404`, not with that tenant's data.
 *
 * NO `response:` schema, matching every other route in this server: the
 * handler's return type carries the contract, and the tests parse the payload
 * against `MultiAgentRun` rather than paying for a serializer to do it on every
 * poll.
 *
 * NO per-route `config.rateLimit`, deliberately. The results view polls this
 * every 2 000 ms while any column is running, so a limit tight enough to be
 * worth declaring is also tight enough for two open tabs to trip; the global
 * 120/minute already covers it, and the read is a handful of indexed selects
 * with no model call and no external I/O behind it.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams } },
    async (req): Promise<MultiAgentRun> => {
      const { workspaceId } = await getContext(container, req);
      return container.multiAgent.latest(workspaceId, req.params.id);
    },
  );
}
