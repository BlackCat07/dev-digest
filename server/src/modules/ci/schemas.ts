import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { REPO_PATTERN } from './helpers.js';
import { RUNS_PAGE_MAX, RUNS_PAGE_SIZE } from './constants.js';

/**
 * Every request shape the CI routes accept, declared once and attached to the
 * route (`params` / `body` / `querystring`) rather than parsed inside a handler.
 *
 * That placement is the point of the file. A schema on the route runs BEFORE the
 * handler, so an invalid id becomes a clean `422 validation_error` from the
 * shared error handler and never reaches `getContext`, the service, GitHub or
 * Postgres; a `Schema.parse(req.body)` inside a handler runs after the workspace
 * lookup and turns the same bad input into a `500`. It also means every handler's
 * `req.params` and `req.body` are typed off these declarations, so nothing in
 * `routes.ts` needs a cast.
 */

/** `/agents/:id/…` — the agent being exported, or whose installations are read. */
export const AgentIdParams = z.object({ id: z.string().uuid() });
export type AgentIdParams = z.infer<typeof AgentIdParams>;

/**
 * The export/preview body: the shared contract, with `repo` narrowed.
 *
 * `.extend()` rather than a hand-written copy, so `target`, `action`, `post_as`,
 * `triggers` and `base` stay the contract's — including their defaults, which the
 * Configure step's controls are specified against. The one override is `repo`:
 * the contract types it `z.string().min(1)` because it is also the shape the
 * client stores mid-wizard, and both halves of it reach a URL path, a commit
 * message and a pull-request body. An allow-listed `owner/name` is the cheapest
 * possible place to stop `../` and a second slash, and it is stopped before the
 * handler runs rather than inside it.
 */
export const CiExportBody = CiExportInput.extend({
  repo: z.string().regex(REPO_PATTERN, 'Repository must be "owner/name"'),
});
export type CiExportBody = z.infer<typeof CiExportBody>;

/**
 * `?limit=` on both run reads.
 *
 * `coerce`, because a query string is always text; bounded, because the ceiling
 * is what stops one request asking for the whole table. The default is the page
 * size the screen renders.
 */
export const CiRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(RUNS_PAGE_MAX).default(RUNS_PAGE_SIZE),
});
export type CiRunsQuery = z.infer<typeof CiRunsQuery>;
