# layer-map — every ring, mapped to real files

Companion to [SKILL.md](SKILL.md). This is the "which file am I actually looking at" reference.
Paths are relative to `server/` unless they start with `reviewer-core/`.

## Ring by ring

### Core — `reviewer-core/src/**`

The domain. `diff → prompt → LLM → grounded findings`, plus deterministic scoring.

| File | Owns |
|---|---|
| `prompt.ts` | `assemblePrompt`, `wrapUntrusted`, `INJECTION_GUARD` |
| `grounding.ts` | `groundFindings`, `groundingSummary` — the citation gate |
| `llm/structured.ts` | Zod → JSON Schema, `extractJson`, `parseWithRepair` |
| `review/run.ts` | `reviewPullRequest` — orchestrates one run |
| `review/reduce.ts` | `reduceReviews`, `sliceDiff` — the map-reduce path |
| `output/to-review.ts` | `toReview` — the CI payload shape |
| `index.ts` | the entire public API surface (consumers import the barrel, not deep paths) |

Purity is the contract: no DB, no GitHub, no filesystem, no `process.env`. The only side
effect is an LLM call through an **injected** `LLMProvider`. Two consequences that are easy to
miss:

- It is consumed **as source** through a tsconfig alias, not as a built package. Editing it
  changes the running server immediately.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are *meant* to be absent
  until a later lesson feeds them. A missing slot is not a bug to fill in.

### Ports — `src/vendor/shared/**`, imported as `@devdigest/shared`

Interfaces and Zod contracts. Depends on `zod` and nothing else.

`adapters.ts` declares the ports: `LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`,
`CodeIndex`, `AuthProvider`, `SecretsProvider`. `contracts/*.ts` declares the wire shapes
shared with the client (`findings`, `review-api`, `trace`, `observability`, `knowledge`,
`brief`, `platform`, `eval-ci`, `productionize`, `why`).

Three standing facts about this directory:

- It is **coordination-only** and physically lives inside `server/` while being logically
  inside the core. `reviewer-core` importing it is the one permitted outward edge.
- `client/src/vendor/shared` is a **hand-made copy that is behind**. A client/server type
  mismatch is usually that, not your change. Surface it; do not silently sync.
- Change it by **adding a new symbol or file**, never by reshaping an existing one.

**Deviation worth knowing:** two ports are declared adapter-side rather than in
`vendor/shared` — `DepGraph` (`adapters/depgraph/index.ts`) and `Tokenizer`
(`adapters/tokenizer/index.ts`). Both are read only by the repo-intel indexer pipeline, so
they never cross the package boundary. Follow the pattern only for a port with exactly one
in-package consumer; anything a feature or the client touches goes in `vendor/shared`.

### Application — `modules/*/service.ts`

Use cases. Orchestrates ports and repositories, owns transaction and job boundaries, maps
rows to DTOs, publishes run events.

`agents/service.ts` is the reference: it holds a repository, calls `toAgentDto`, and exposes
no Drizzle type. `reviews/service.ts` keeps the public method surface while the bulky run
execution lives in `reviews/run-executor.ts`. `repo-intel/service.ts` is the indexer facade
behind `container.repoIntel`.

### Infrastructure

| Kind | Files |
|---|---|
| Repositories | `modules/*/repository.ts`, `modules/reviews/repository/{pull,review,run}.repo.ts`, `modules/settings/repository.ts` |
| DB | `db/client.ts` (the Drizzle handle), `db/schema/**` (tables), `db/rows.ts` (`$inferSelect` types), `db/migrations/**` (generated — never hand-edit) |
| Adapters | `src/adapters/**` (see the table below) |

`db/rows.ts` exists so cross-cutting consumers can name a row shape without importing another
module's data layer. That is a persistence-ring courtesy, not a licence to put Row types in
application signatures.

### Composition root — `platform/container.ts` + `app.ts`

`Container` holds config, the Drizzle handle, the `JobRunner` and the SSE bus, and constructs
adapters as **lazy getters** resolved through `SecretsProvider`. `ContainerOverrides` is the
test seam. Shared repositories for cross-cutting entities (`agentsRepo`, `reviewRepo`) are
constructed here so a module never reaches into a sibling's folder.

`app.ts` registers plugins **before** modules, so every encapsulated module plugin inherits
helmet/cors/rate-limit/SSE and the shared error handler. That inheritance *is* the layering —
don't re-register cross-cutting concerns inside a module.

### Transport — `modules/*/routes.ts`

One Fastify plugin per module, registered statically in `modules/index.ts` (dynamic
`import()` of `.ts` is not portable across tsx / bundler / vitest — don't "fix" it with
autoload). Zod schemas double as route schemas via `fastify-type-provider-zod`; invalid input
422s before the handler runs.

## Tool → port → adapter

Every external system we touch, and the file that owns it.

| Tool / SDK | Port | Adapter |
|---|---|---|
| `octokit` | `GitHubClient` | `adapters/github/octokit.ts` |
| `simple-git` | `GitClient` | `adapters/git/simple-git.ts` (+ `git/diff-parser.ts`) |
| `openai` | `LLMProvider` | `adapters/llm/openai.ts` |
| `@anthropic-ai/sdk` | `LLMProvider` | `adapters/llm/anthropic.ts` |
| OpenRouter (HTTP) | `LLMProvider` | `reviewer-core/src/llm/openrouter.ts` — in the core because the CI runner shares it |
| `openai` embeddings | `Embedder` | `adapters/embedder/openai.ts` |
| `@vscode/ripgrep` | `CodeIndex` | `adapters/codeindex/ripgrep.ts` (+ `codeindex/extract.ts`) |
| `@ast-grep/napi` | — (repo-intel internal) | `adapters/astgrep/index.ts` |
| `dependency-cruiser` | `DepGraph` (adapter-side) | `adapters/depgraph/index.ts` |
| `js-tiktoken` | `Tokenizer` (adapter-side) | `adapters/tokenizer/index.ts` |
| `~/.devdigest/secrets.json`, `process.env` | `SecretsProvider` | `adapters/secrets/local.ts` |
| local no-auth workspace | `AuthProvider` | `adapters/auth/local.ts` |
| `postgres` + `drizzle-orm` | — (repositories are the seam) | `db/client.ts` |
| every port, faked | — | `adapters/mocks.ts` |

Secrets note: `GITHUB_TOKEN` is canonical (`GITHUB_PAT` is accepted as a fallback), and the
app boots fine with zero keys — a missing key is a runtime `ConfigError`, not a boot failure.

## Where does it go?

| Thing | Home |
|---|---|
| A SQL query, `insert`, `onConflictDoUpdate`, aggregate | `modules/<name>/repository.ts` |
| A transaction spanning two writes | the service: `db.transaction(async (tx) => …)`, passing `tx` into repository methods |
| Use-case orchestration, step sequencing | `modules/<name>/service.ts` |
| A rule needing neither DB nor network | `reviewer-core/src/` |
| A module-specific pure function | `modules/<name>/helpers.ts` |
| A call to an external system | new adapter in `src/adapters/<kind>/` + port in `vendor/shared` |
| The interface of an external dependency | `src/vendor/shared/adapters.ts`, as a new symbol |
| HTTP request/response shape | Zod schema at the route, or `modules/_shared/schemas.ts` |
| A contract shared with the client | `vendor/shared/contracts/`, as a **new file** |
| A Drizzle Row type | `db/rows.ts`, re-exported from the owning repository |
| A DTO and its Row → DTO mapper | `modules/<name>/helpers.ts` |
| A magic number or a default | `modules/<name>/constants.ts` |
| Error taxonomy | `platform/errors.ts` — `AppError` and subclasses |
| Adapter construction, secret caching, cache invalidation | `platform/container.ts` |
| Module registration | `modules/index.ts`, statically |
| Tenancy scoping | `getContext(container, req)` at the route; `workspaceId` threaded down |
| Background work | `platform/jobs.ts`, kicked off from a service |
| Event streaming | `platform/sse.ts` / `runBus`, published by a service |
| A prompt body | `src/prompts/*.md` |
| A mock adapter for a test | `adapters/mocks.ts` + `ContainerOverrides` |
| A test | `server/test/`, not colocated. `*.it.test.ts` means it needs live Postgres |
