import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { AgentIdParams, CiExportBody, CiRunsQuery } from './schemas.js';

/**
 * L06 — Export to CI.
 *   POST /agents/:id/export-ci/preview  → every file that WOULD be committed
 *   POST /agents/:id/export-ci          → commit them and open (or reuse) the PR
 *   GET  /agents/:id/ci-installations   → this agent's repositories + latest run
 *   GET  /ci-runs                       → the workspace's CI runs, newest first
 *   POST /ci-runs/refresh               → read new runs back, then the list
 *
 * **Transport only.** A schema, `getContext`, one service call, a return. No
 * query, no aggregate, no branching business rule and no SDK: the target refusal,
 * the trigger intersection, the reuse-or-open decision, the four unreadable-
 * artifact reasons and the read throttle all belong to `CiService`, and nothing
 * here holds a copy of any of them. A route needing a value the service does not
 * expose gets a service method, not a reach into the repository.
 *
 * **The workspace lookup is the authorization check, and the service performs
 * it.** Every handler opens with `getContext` and passes that workspace id first;
 * an agent outside the caller's workspace raises the service's own
 * `NotFoundError`, which the shared error handler turns into
 * `{"error":{"code":"not_found",…}}`. That envelope — and not Fastify's
 * route-not-found — is the observable difference between "this id is not yours"
 * and "this module is not mounted".
 *
 * Modules declare full paths here; there is no prefix.
 *
 * NO `response:` schema, matching every other route module: the handler's return
 * type carries the contract and the service tests parse the payload against it.
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.ci;

  app.post(
    '/agents/:id/export-ci/preview',
    { schema: { params: AgentIdParams, body: CiExportBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: AgentIdParams, body: CiExportBody },
      // Tight per-route limit, the shape `/pulls/:id/review` already uses: one
      // call makes four GitHub round trips and writes into somebody's repository.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.exportToCi(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/agents/:id/ci-installations',
    { schema: { params: AgentIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listInstallations(workspaceId, req.params.id);
    },
  );

  app.get('/ci-runs', { schema: { querystring: CiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.query.limit);
  });

  /**
   * Read runs back on demand.
   *
   * No body schema at all, deliberately: the client sends no body, and `apiFetch`
   * therefore sends no `content-type` — declaring a body here would make the
   * request that actually arrives the only one this route rejects. The service's
   * own throttle is what bounds the GitHub traffic; the rate limit bounds ours.
   */
  app.post(
    '/ci-runs/refresh',
    {
      schema: { querystring: CiRunsQuery },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.refresh(workspaceId, req.query.limit);
    },
  );
}
