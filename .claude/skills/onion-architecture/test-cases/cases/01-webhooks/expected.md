# Answer key — fixture A (`webhooks` module)

Planted violations: **3**. Clean control files: `repository.ts`, `constants.ts`.

| # | File | Line(s) | Violation | Rule | Correct shape |
|---|---|---|---|---|---|
| A1 | `server/src/modules/webhooks/routes.ts` | 3, 5, 51-70 | Transport imports `drizzle-orm` and `db/schema` and runs a `select`/`innerJoin` directly in the `GET /webhooks/:id/deliveries` handler | `routes-no-data-access` (warn) + layer table: Transport must never import `db/schema` or `drizzle-orm` | Move the query into `WebhooksRepository.listDeliveries(workspaceId, id)`; route calls `service.deliveries(...)` |
| A2 | `server/src/modules/webhooks/service.ts` | 3, 44-47 | Application ring imports the **concrete adapter class** `OctokitGitHubClient` from `src/adapters/github/octokit.js` and constructs it with a hand-fetched token | Layer table: Application must never import `src/adapters/**`; decision framework #1 and #3 (depend on interfaces via `container`) | `const github = await this.container.github()` — the container owns construction and the secret |
| A3 | `server/src/modules/webhooks/service.ts` | 4, 42 | Reaches into a sibling module internal, `../repos/helpers.js` (`normalizeRepoFullName`) | `no-cross-module-internals` (warn); decision framework #6 | Lift the helper to `modules/_shared/`, or reach the capability through `container.*` |

## False-positive traps (must NOT be reported as violations)

- `repository.ts` importing `drizzle-orm` + `db/schema` — that is exactly the ring that may.
- `routes.ts` importing `@devdigest/shared` contracts and declaring Zod route schemas — correct transport behaviour.
- `service.ts` importing `./repository.js` and `./constants.js` — own-module imports are fine.
- `service.ts` taking `Container` in the constructor — the skill explicitly says existing services taking `Container` are **not** a refactor target.
