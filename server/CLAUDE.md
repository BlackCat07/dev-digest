# server — `@devdigest/api`, Fastify on :3001

Stack: Fastify 5 · Drizzle 0.38 → Postgres/pgvector · Zod 3 · vitest 2 · tsx.

## Commands

```sh
pnpm dev          # tsx watch src/server.ts
pnpm typecheck
pnpm test         # whole suite (the .it.test.ts half needs Docker)
pnpm exec vitest run --exclude '**/*.it.test.ts'   # hermetic only
pnpm exec vitest run .it.test                      # DB-backed only
pnpm db:generate  # schema change → migration SQL (then db:migrate)
pnpm db:migrate · pnpm db:seed
```

## Map

```
src/modules/<name>/   feature slice: routes.ts → service.ts → repository.ts
                      settings repos pulls polling workspace agents reviews repo-intel
src/adapters/         ports to the outside: github git llm embedder secrets
                      astgrep codeindex depgraph tokenizer auth · mocks.ts
src/platform/         container (DI) · config · errors · jobs · sse · model-router
src/db/schema/        Drizzle tables · src/db/migrations/ = generated
src/vendor/shared/    @devdigest/shared — Zod contracts (see Do-not-touch)
src/prompts/          prompt bodies as .md
test/                 tests live here, not colocated next to source
```

## Conventions

- **Zod schemas double as route schemas** via `fastify-type-provider-zod`. Declare
  `params`/`body` on the route; invalid input 422s before the handler runs. Never
  hand-roll `Schema.parse(req.body)` inside a handler.
- **All I/O goes through `src/adapters/`.** A module never imports `octokit`/`openai`
  directly — it takes the interface off the DI container.
- **Tests inject through `ContainerOverrides`** (`platform/container.ts`) with
  `adapters/mocks.ts`. Services depend on interfaces, so tests make no network calls.
- **`*.it.test.ts` = needs live Postgres** (testcontainers); any other filename must be
  hermetic. That split is exactly what the two CI workflows filter on — naming a
  DB-backed test wrong puts Postgres in the hermetic job and it fails there.
- **`reviewer-core` is consumed as source**, not as a package (tsconfig alias to
  `../reviewer-core/src`). Editing it changes this server's behaviour immediately.
- Plugins register **before** modules, so encapsulated module plugins inherit
  helmet/cors/rate-limit/SSE and the shared error handler.
- Static module registration (see root `CLAUDE.md`) is deliberate: dynamic `import()`
  of `.ts` isn't portable across tsx / bundler / vitest. Don't "fix" it with autoload.

## Gotchas

- **Migrations never run on boot.** `relation ... does not exist` → `pnpm db:migrate`.
  pgvector comes from migration `0000`, so migrate the docker-compose DB, not a local one.
- **`client/src/vendor/shared` is a hand-made copy of `src/vendor/shared` and is behind**
  — missing `openrouter` in `LLMProvider.id`, `sessionId`, `CommitFile`/`CommitFilesPayload`.
  No sync script, no CI check. A client/server type mismatch is usually this, not your
  change. Surface it; do not silently sync (both paths are coordination-only).
- **Secrets don't live only in `.env`** — `~/.devdigest/secrets.json` (mode 0600), written
  by the Settings UI, read via `adapters/secrets/local.ts` with `process.env` as fallback.
  `GITHUB_TOKEN` is canonical, `GITHUB_PAT` accepted as fallback.
- **Boots fine with zero keys** — `loadConfig` marks every secret optional. A missing key
  is a runtime `ConfigError`, not a boot failure. Don't make keys required.
- **The DB schema already contains every table**, including ones no code touches yet.
  An empty table is a later lesson's, not dead schema to drop.
- The engine reaps orphaned `running` runs on boot, so a stuck run clears itself.

## Do not touch

- `src/db/migrations/**` — generated. Edit `src/db/schema/`, then `pnpm db:generate`.
- `src/vendor/shared/**` — cross-package contract; never hand-edit without coordination.
  When a change is agreed: extend with a new file rather than reshaping existing ones.

## Deeper context

- Route map, request/DI flow diagram, error envelope → `README.md`
- Test philosophy, suite/CI matrix, what each suite covers → `../TESTING.md`
- `repo-intel` indexing pipeline internals → `src/modules/repo-intel/README.md`
- PR-level aggregates (score, cost, findings) and their traps → `docs/scores-and-costs.md`
- Curated deep-dives → `docs/README.md`
- What a feature must do → `specs/README.md`
