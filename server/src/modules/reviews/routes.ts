import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentRunRequest, ReviewRunRequest } from '@devdigest/shared';
import type { MultiAgentRun, RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true} | {agentIds} → run review(s)
 *   POST   /pulls/:id/multi-agent-run  {agentIds}      → fan out, as ONE multi-run
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  //
  // The body is now the CONTRACT schema rather than a manual parse inside the
  // handler, so a body of the wrong shape is a `422` from the validator before
  // anything runs (`DDG-SEC-003`). The `preprocess` keeps the one tolerance the
  // manual parse had (`RunRequest.parse(req.body ?? {})`): all three selectors
  // are optional, and a request with NO body still reaches the handler, where
  // "you named nothing" is a refusal with a NAME rather than a validator's
  // anonymous complaint. It is `?? {}` and not `.default({})` because Fastify
  // hands an absent body to the validator as `null`, and a zod default only
  // fires on `undefined` — measured, not assumed.
  //
  // What the schema deliberately does NOT do is reject an empty `agentIds` or
  // the `agentIds`+`all` pair. Both are refused by name in the service (AC-3,
  // AC-6), and `ReviewRunRequest` carries no `.min(1)` for exactly that reason —
  // see its own comment in `contracts/review-api.ts`.
  app.post(
    '/pulls/:id/review',
    {
      schema: {
        params: IdParams,
        body: z.preprocess((body) => body ?? {}, ReviewRunRequest),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = req.body;
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Fan a PR out to an explicit set of agents, as ONE multi-agent run ----
  //
  // Its own route rather than a mode of the one above, because it answers a
  // different question: `/review` returns the runs it started, this returns the
  // MULTI-RUN — the record the results screen then polls at
  // `GET /pulls/:id/multi-agent`. The list is non-empty by contract here
  // (`MultiAgentRunRequest` carries the `.min(1)` that `ReviewRunRequest`
  // deliberately does not), so an empty list is the validator's `422` and not a
  // named refusal — which is the whole difference between the two bodies.
  //
  // The same 10/minute limit `/review` carries: one call fans out to as many as
  // eight model runs, and the response is immediate, so a client has no reason
  // to burst. Every refusal — the cap, the unknown agent, the fan-out already in
  // flight — is the service's (`DDG-ARCH-001`); this handler validates, resolves
  // the workspace and returns.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<MultiAgentRun> => {
      const { workspaceId } = await getContext(container, req);
      return service.createMultiAgentRun(workspaceId, req.params.id, req.body.agentIds, req.log);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
