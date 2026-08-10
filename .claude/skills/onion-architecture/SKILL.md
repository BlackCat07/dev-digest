---
name: onion-architecture
description: "Onion / ports-and-adapters layering for the DevDigest backend (server/ + reviewer-core/). Use when adding or reviewing a backend module — placing routes/services/repositories/adapters, deciding where a DB query or an external SDK call (LLM, GitHub, git, ripgrep, ast-grep) may live, wiring DI in platform/container.ts, defining a new port in @devdigest/shared, or keeping reviewer-core pure. Enforces the dependency rule (imports point inward) and ships a dependency-cruiser gate. NOT for the client/ frontend (use frontend-ui-architecture) or React code."
version: "1.0.0"
---

# Onion Architecture — DevDigest backend

The backend **already is** an onion / ports-and-adapters architecture; this skill names it,
maps it onto our files, and **forces** it with a `dependency-cruiser` gate. Use it whenever
you add or review code under `server/` or `reviewer-core/`.

For provenance and the full reading list, see [README.md](README.md).

## The one rule

**All imports point inward.** A file may depend on layers more central than itself; it may
never depend on a layer further out. Coupling always runs toward the core. This is the
Dependency Inversion Principle in practice: inner layers declare interfaces (ports), outer
layers implement them, and the composition root wires the two together.

```
 ┌───────────────────────────────────────────────────────────┐
 │ Transport — modules/*/routes.ts, Fastify plugins          │ ← outermost
 │  ┌─────────────────────────────────────────────────────┐  │
 │  │ Infrastructure — adapters/**, db/**, */repository.ts │  │
 │  │  ┌───────────────────────────────────────────────┐   │  │
 │  │  │ Application — modules/*/service.ts            │   │  │
 │  │  │  ┌─────────────────────────────────────────┐  │   │  │
 │  │  │  │ Ports — vendor/shared (@devdigest/shared)│ │   │  │
 │  │  │  │  ┌───────────────────────────────────┐  │  │   │  │
 │  │  │  │  │ Core — reviewer-core/src (pure)   │  │  │   │  │
 │  │  │  │  └───────────────────────────────────┘  │  │   │  │
 │  │  │  └─────────────────────────────────────────┘  │   │  │
 │  │  └───────────────────────────────────────────────┘   │  │
 │  └─────────────────────────────────────────────────────┘  │
 │   composition root: platform/container.ts (binds ports↔adapters) │
 └───────────────────────────────────────────────────────────┘
```

The composition root sits across the rings on purpose: it is the one place allowed to name
concrete classes. `platform/` (errors, config, jobs, sse, model-router, resilience) is
cross-cutting — any ring may use it, but only `container.ts` may know that modules exist.

## The layers

| Layer | Files | May import | Must never import |
|---|---|---|---|
| Core | `reviewer-core/src/**` | ports (contract **types**), `zod` | any I/O: `fastify`, `drizzle-orm`, `octokit`, `simple-git`, `postgres`, `src/adapters/**`, `db/**` |
| Ports | `@devdigest/shared` (`src/vendor/shared/**`) | `zod`, other shared types | anything concrete |
| Application | `modules/*/service.ts`, `run-executor.ts` | ports, `container`, own `repository`/`helpers`, `platform/*` | `src/adapters/**` (concrete SDKs), `db/schema` |
| Infrastructure | `src/adapters/**`, `db/**`, `modules/*/repository*.ts` | ports, drivers/SDKs, `db/schema` | `modules/**` (a feature) |
| Composition root | `platform/container.ts` | everything (binds ports↔adapters) | — |
| Transport | `modules/*/routes.ts` + plugins | own `service`, `_shared`, contracts | `src/adapters/**`, `db/schema`, `drizzle-orm` (go through the service) |

Ring-by-ring detail, the tool→port→adapter table and a "where does it go?" cheatsheet:
→ **[layer-map.md](layer-map.md)**

## Decision framework (placing a change)

Apply in order; the first match wins.

1. **Is it an external call** (HTTP, DB, git, an LLM, a CLI like ripgrep/ast-grep)? It belongs
   behind a **port** in `@devdigest/shared` (`src/vendor/shared/adapters.ts`), implemented by
   an **adapter** in `src/adapters/<kind>/`. Never call an SDK from a service or a route.
2. **Is it a DB query?** It lives in `modules/<name>/repository.ts` (or
   `repository/*.repo.ts`) — the only files allowed to touch `db/schema` + `drizzle-orm`.
   Repositories return rows or domain values, never a leaked query builder. The **service**
   owns the transaction boundary: it opens `db.transaction` and passes `tx` down.
3. **Is it business orchestration?** It lives in `modules/<name>/service.ts` (heavy run logic
   in `run-executor.ts`). The service depends on **interfaces** via `container`, never on a
   concrete adapter class.
4. **Is it HTTP wiring?** `modules/<name>/routes.ts` only: Zod schema (request validation +
   response serialization) → call the service → map the result. No logic, no DB, no SDK.
5. **Pure domain logic** (diff → prompt → grounded findings, scoring)? It lives in
   `reviewer-core` and stays pure — its only outside contact is the injected `LLMProvider`.
   Need a config value, a clock or a token? Pass it in as a parameter.
6. **Cross-module need?** Reach the other capability through `container.*` (e.g.
   `container.repoIntel.*`, `container.agentsRepo`, `container.reviewRepo`), never by
   importing another `modules/<other>/` internal. `modules/_shared/` is the one sanctioned
   kernel every module may import.

Every boundary **parses**; it never casts. Request, response, jsonb read back from Postgres,
LLM output, GitHub payload. An `as` on a boundary already shipped `$NaN` to the client — see
`server/INSIGHTS.md` (2026-08-02).

## Adding a new external dependency (the canonical move)

1. **Define the port first** — an interface in `src/vendor/shared/adapters.ts` that speaks the
   application's language ("I need to post a review comment"), with **no** vendor name in it.
   Extend with a new symbol; never reshape an existing one (the file is a cross-package
   contract — see root `CLAUDE.md`).
2. **Implement the adapter** in `src/adapters/<kind>/<impl>.ts`, wrapping the SDK.
3. **Add a mock** in `src/adapters/mocks.ts` so tests inject it.
4. **Wire it in the container** (`platform/container.ts`) as a lazy getter, and add a field to
   `ContainerOverrides` so tests can inject the mock.
5. **Services consume `container.<port>`** — they never see the SDK.

This is exactly how `LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`,
`AuthProvider` and `SecretsProvider` already work.

New services should take the **ports they need** rather than the whole container —
`constructor(deps: { agents: AgentsRepository; llm: LLMProvider })` makes the dependencies
visible in the signature. Existing services (`AgentsService`, `ReviewService`,
`RepoIntelService`) take `Container` and are **not** a refactor target: `ContainerOverrides`
already delivers the testability onion asks for.

## Enforcement (this is what makes the skill "force" the architecture)

The dependency rule is not a convention you remember — it is a `dependency-cruiser` gate, and
`dependency-cruiser` is **already** a dependency of `server/`. The config lives at
`server/.dependency-cruiser.cjs`; the severity rationale and the exception ledger are in
→ **[enforcement.md](enforcement.md)**.

Before claiming a backend change is done:

```sh
cd server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src
```

Run the binary directly — `pnpm <script>` dies on this repo's supply-chain policy before the
script starts (`server/INSIGHTS.md`, 2026-08-02). The `lint:arch` script wraps the same call.

Validated against the real graph on 2026-08-04: **0 errors, 18 warnings**. The gate exits
non-zero only on an `error`, so it is green today and blocks any *new* `error`. `warn`s are
**known drift** on a burn-down list, not licence to add more. Severities are a **ratchet**:
promote a `warn` to `error` once its backlog is cleared.

## Known drift & exceptions (do not "fix" silently)

Encoded `pathNot` **exceptions** — legitimate, kept green:

- `modules/repo-intel/service.ts` imports adapters (`codeindex/extract`, `astgrep`) directly.
  repo-intel **is** the indexer subsystem; it behaves as infrastructure and is reached only
  through the `container.repoIntel` facade.
- `src/adapters/depgraph` and `src/adapters/astgrep` import `modules/repo-intel/constants.ts`
  (`SUPPORTED_EXT`) — an infrastructure→feature edge. The clean fix is relocating that
  constant; until then it is a named exception, not a silent pass.

Current `warn` drift (real violations to burn down, then promote the rule):

- **7 files touch `db/schema` outside a repository** — the `routes.ts` of `polling`, `pulls`
  and `workspace`, plus `reviews/run-executor`, `reviews/diff-loader`, `repos/helpers`,
  `settings/feature-models`. (`settings/routes.ts` was cleaned up on 2026-08-04 and is now
  the reference shape: `routes.ts` → `service.ts` → `repository.ts`.)
- **1 cross-module edge** — `repos/service.ts → repo-intel/constants.ts`.
- **1 Row type in an application signature** — `ReviewService.resolveTargets(): AgentRow[]`.
- **5 cycles** — four run through the DI root (`container ↔ repo-intel/service` and its
  pipeline) plus the genuine `agents/helpers ↔ agents/repository` pair.

`agents/` is the shape to copy: `routes.ts` → `service.ts` → `repository.ts`, with
`helpers.ts` doing `toAgentDto`.

## When NOT to add a layer

Palermo is explicit that onion "is not appropriate for small websites", and DevDigest grows
one lesson at a time:

- **A repository earns its place on the second consumer of a query, or when a route passes
  ~50 lines or two tables.** `workspace/routes.ts` is 34 lines and one `select`; wrapping it
  buys nothing. `pulls/routes.ts` (388 lines) passed both thresholds long ago.
- **No rich entity classes.** Zod contracts plus pure functions are the deliberate choice
  here; `reviewer-core` carries real domain logic without them. An "anemic model" is not a
  defect in this codebase.
- **A repository does not exist to make the database swappable.** It exists so SQL stops
  leaking across rings.
- **Never rename or move files just to match the shape.** Onion is about the direction of
  dependencies, not folder vocabulary.

## Files

- `SKILL.md` — the one rule, the layer table, the decision framework, the "add a dependency"
  recipe.
- [layer-map.md](layer-map.md) — every ring mapped to real files, the tool→port→adapter table,
  and a "where does it go?" cheatsheet.
- [enforcement.md](enforcement.md) — the `dependency-cruiser` config explained, the npm
  script, the severity ratchet, and the exception ledger.
- [README.md](README.md) — provenance and the reading list this skill distills.
