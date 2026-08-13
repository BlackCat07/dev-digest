import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DeriveIntentPayload, type PrIntent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { INTENT_JOB_KIND } from './constants.js';

/**
 * L03 — intent module.
 *   GET  /pulls/:id/intent  → the stored derivation for this PR, or null
 *   POST /pulls/:id/intent  → derive it now, synchronously; 200 with the record
 *
 * Both paths hang off `/pulls/:id` because an intent is a property OF a pull
 * request — it has no id of its own, `pr_intent`'s primary key IS the PR id, and
 * there is exactly one current intent per PR. That is the opposite of
 * `conventions`, whose candidates outlive the scan that produced them and are
 * therefore addressed directly.
 *
 * The module owns NO repository: `pr_intent` belongs to the review domain's data
 * layer and is reached through `container.reviewRepo`. See the note above the
 * queries in `../reviews/repository/pull.repo.ts`.
 *
 * `null` is a real answer on the GET, not a 404: a PR that has never been
 * classified has no row, and the card renders its "not derived yet" state from
 * that rather than from an error.
 */

/**
 * Payload of a background derivation job.
 *
 * VALIDATED rather than cast, unlike the neighbouring conventions handler: what
 * arrives here is `unknown` off `JobRunner`, and a job kind is addressable by
 * string from anywhere in the process. A malformed payload should fail the job
 * row with a readable message rather than reach `derive` as `undefined`.
 *
 * `safeParse` + an explicit throw, never `.parse` (zod `parse-use-safeparse`):
 * the raw `ZodError` would travel through `withRetry` and land in `jobs.error`
 * as an issue array, which says less than the one line below.
 */
const IntentJobPayload = z.object({
  workspaceId: z.string().uuid(),
  prId: z.string().uuid(),
});

export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // Registered once at boot. The service comes from the container rather than
  // being constructed here: `container.intent` is the binding every other
  // consumer uses (`run-executor.ts`, `pulls/routes.ts`), and a second instance
  // — while harmless, the service being stateless — meant two construction paths
  // for one service and a `new` outside the composition root.
  const service = container.intent;
  container.jobs.register(INTENT_JOB_KIND, async (payload) => {
    const parsed = IntentJobPayload.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`invalid ${INTENT_JOB_KIND} payload: expected { workspaceId, prId }`);
    }
    await service.derive(parsed.data.workspaceId, parsed.data.prId);
  });

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams } },
    async (req): Promise<PrIntent | null> => {
      const { workspaceId } = await getContext(container, req);
      return (await service.get(workspaceId, req.params.id)) ?? null;
    },
  );

  // Tight per-route limit, for the same reason `POST /pulls/:id/review` carries
  // one: the call costs a model round-trip. Lower than the review route's 10
  // because this endpoint is a single button on a card, not a fan-out over the
  // workspace's agents.
  //
  // The body is OPTIONAL: the card re-derives with a body-less POST (declaring
  // `content-type: application/json` with no body is what Fastify rejects), and
  // `force` is the only field it could ever carry.
  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, body: DeriveIntentPayload.nullish() },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req): Promise<PrIntent> => {
      const { workspaceId } = await getContext(container, req);
      const force = req.body?.force;
      return service.derive(workspaceId, req.params.id, force === undefined ? {} : { force });
    },
  );
}
