import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import {
  AgentIdParams,
  BatchIdParams,
  CaseIdParams,
  CreateEvalCaseBody,
  DraftEvalCaseBody,
  EvalCompareQuery,
  EvalPeriodQuery,
  SaveEvalCaseBody,
  StartEvalBatchPayload,
  TrialRunEvalCaseBody,
} from './schemas.js';

/**
 * L06 — eval module.
 *   POST   /eval/cases/drafts                → derive a case from a finding, store nothing
 *   POST   /eval/cases                       → file a derived (and edited) case
 *   POST   /eval/agents/:agentId/trial-runs  → run one unsaved draft, record nothing
 *   GET    /eval/agents/:agentId/cases       → that agent's whole set
 *   PUT    /eval/cases/:caseId               → save a hand-edited case
 *   DELETE /eval/cases/:caseId               → drop a case (batch history is kept)
 *   POST   /eval/agents/:agentId/batches     → start a batch (whole set, or one case)
 *   GET    /eval/batches/:batchId            → one batch + its per-case results
 *   GET    /eval/batches/:batchId/events     → SSE progress, keyed on the batch id
 *   GET    /eval/agents/:agentId/batches     → that agent's batch history
 *   GET    /eval/agents/:agentId/dashboard   → that agent's page payload
 *   GET    /eval/compare                     → two batches of one agent, side by side
 *   GET    /eval/dashboard                   → one row per agent + recent batches
 *   POST   /eval/dashboard/runs              → one batch per eligible agent
 *
 * **Transport only.** A schema, `getContext`, one service call, a return. No
 * query, no aggregate, no branching business rule and no SDK: every decision this
 * feature makes — the six creation refusals, the staleness window that unblocks
 * an orphaned batch, the comparison rules, the dashboard's per-agent grouping —
 * belongs to `EvalService`, and nothing here holds a copy of any of it. A route
 * that needed a value the service does not expose would get a service method, not
 * a reach into the repository.
 *
 * **The workspace lookup is the authorization check, and the service performs
 * it.** Every handler opens with `getContext`, and every service method takes that
 * workspace id first: an agent, a case or a batch outside the caller's workspace
 * raises the service's own `NotFoundError`, which the shared error handler turns
 * into `{"error":{"code":"not_found",…}}`. That envelope — and not Fastify's
 * route-not-found — is the observable difference between "this id is not yours"
 * and "this module is not mounted", so no eval read is reachable by id alone.
 *
 * **Refusals pass through untouched.** `EvalRefusal` extends `AppError` with the
 * `EvalRefusalReason` as its CODE, because that code is what the finding card
 * keys its message off. A `try`/`catch` here that rewrapped one as a validation
 * error would answer the right status with the wrong code and silently blank
 * every refusal sentence in the UI. There is no `try`/`catch` in this file.
 *
 * NO `response:` schema, matching every other route module here: the handler's
 * return type carries the contract and the service tests parse the payload
 * against it.
 */
export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.eval;

  // ---- cases --------------------------------------------------------------

  /**
   * The draft behind `Turn into eval case`.
   *
   * A POST that writes nothing, and `200` rather than `201` says so: there is no
   * resource created and no `Location` to point at. It is a POST at all because
   * the finding id is the input to a derivation, and because every refusal this
   * feature answers with is applied here — the reader learns that a finding
   * cannot become a case BEFORE a modal opens on it, not after they have edited
   * one.
   */
  app.post('/eval/cases/drafts', { schema: { body: DraftEvalCaseBody } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.draftCaseFromFinding(workspaceId, req.body.finding_id);
  });

  app.post('/eval/cases', { schema: { body: CreateEvalCaseBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const created = await service.createCaseFromFinding(workspaceId, req.body);
    reply.code(201);
    return created;
  });

  /**
   * One trial run of an unsaved draft.
   *
   * Synchronous, unlike a batch, and the difference is one case against many: it
   * is bounded by a single `CASE_DEADLINE_MS`, and there is no row its answer
   * could be recovered from afterwards, so returning it is the only way the
   * caller gets it. Nothing is persisted and nothing is published — pressing
   * `Run case` four times must not move the agent's dashboard four times.
   *
   * The limit is looser than a batch's because the work is smaller by the size
   * of the set: this is one model request, and the whole point of the control is
   * that a reader presses it repeatedly to see whether a finding reproduces.
   */
  app.post(
    '/eval/agents/:agentId/trial-runs',
    {
      schema: { params: AgentIdParams, body: TrialRunEvalCaseBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.trialRunCase(workspaceId, req.params.agentId, req.body);
    },
  );

  app.get(
    '/eval/agents/:agentId/cases',
    { schema: { params: AgentIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.agentId);
    },
  );

  app.put(
    '/eval/cases/:caseId',
    { schema: { params: CaseIdParams, body: SaveEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.saveCase(workspaceId, req.params.caseId, req.body);
    },
  );

  app.delete('/eval/cases/:caseId', { schema: { params: CaseIdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.deleteCase(workspaceId, req.params.caseId);
    return { ok: true };
  });

  // ---- batches ------------------------------------------------------------

  app.post(
    '/eval/agents/:agentId/batches',
    {
      schema: { params: AgentIdParams, body: StartEvalBatchPayload },
      // Tight per-route limit, the shape `/pulls/:id/review` already uses: one
      // call fans out to up to fifty model requests. The acknowledgement is
      // immediate, so a client has no reason to retry in a burst.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const body = req.body ?? {};
      const batch = await service.startBatch(workspaceId, req.params.agentId, {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.case_id !== undefined ? { caseId: body.case_id } : {}),
      });
      // 202: the batch is acknowledged as `running` BEFORE its first case
      // executes, and the work outlives this request.
      reply.code(202);
      return batch;
    },
  );

  app.get('/eval/batches/:batchId', { schema: { params: BatchIdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getBatch(workspaceId, req.params.batchId);
  });

  /**
   * Live progress for one batch — replay buffer first, then live, ending when the
   * batch completes.
   *
   * No rate limit: this is one long-lived connection, not burst traffic, and the
   * global limiter counts it as a request per subscriber.
   *
   * The bridge below is `modules/reviews/routes.ts`'s `/runs/:id/events` bridge,
   * keyed on the BATCH id instead of a run id — the runner publishes to the same
   * `RunBus`, so there is no second transport to build. `subscribe` replays the
   * buffer to a late subscriber and `onDone` fires immediately for a batch that
   * already completed, which is what makes "a subscriber arriving after
   * completion gets a replay and then the stream closes" true with no new
   * machinery.
   *
   * `getBatch` runs FIRST and is not decoration: it is what makes a batch id from
   * another workspace answer `404` with the service envelope instead of opening a
   * stream on someone else's progress.
   */
  app.get(
    '/eval/batches/:batchId/events',
    { schema: { params: BatchIdParams }, config: { rateLimit: false } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const batchId = req.params.batchId;
      await service.getBatch(workspaceId, batchId);

      reply.sse(
        (async function* () {
          const queue: RunEvent[] = [];
          let resolve: (() => void) | null = null;
          let done = false;

          const unsubscribe = container.runBus.subscribe(batchId, (e) => {
            queue.push(e);
            resolve?.();
          });
          const offDone = container.runBus.onDone(batchId, () => {
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
    },
  );

  app.get(
    '/eval/agents/:agentId/batches',
    { schema: { params: AgentIdParams, querystring: EvalPeriodQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listBatches(workspaceId, req.params.agentId, req.query.period);
    },
  );

  app.get(
    '/eval/compare',
    { schema: { querystring: EvalCompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.query.a, req.query.b);
    },
  );

  // ---- dashboards ---------------------------------------------------------

  app.get(
    '/eval/agents/:agentId/dashboard',
    { schema: { params: AgentIdParams, querystring: EvalPeriodQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.agentDashboard(workspaceId, req.params.agentId, req.query.period);
    },
  );

  app.get('/eval/dashboard', { schema: { querystring: EvalPeriodQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.workspaceDashboard(workspaceId, req.query.period);
  });

  /**
   * One batch per eligible agent.
   *
   * No body schema at all, deliberately: the client sends no body, and
   * `apiFetch` therefore sends no `content-type` — declaring a body here would
   * make the request that actually arrives the only one this route rejects.
   */
  app.post(
    '/eval/dashboard/runs',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runAllAgents(workspaceId);
      reply.code(202);
      return result;
    },
  );
}
