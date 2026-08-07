# enforcement — the dependency-cruiser gate

Companion to [SKILL.md](SKILL.md). The dependency rule is machine-checked, not remembered.

Config: `server/.dependency-cruiser.cjs`. `dependency-cruiser` is **already** a `server/`
dependency (it backs `adapters/depgraph`), so the gate needs no install.

## Running it

```sh
cd server
./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src
```

Or the wrapper script:

```sh
cd server && npm run lint:arch      # same command; run the binary directly if pnpm balks
```

Run the **binary directly** rather than through `pnpm <script>`: pnpm's pre-script dep-status
check shells out to `pnpm install`, which trips this repo's supply-chain policy with
`ERR_PNPM_IGNORED_BUILDS` and exits 1 before the script starts (`server/INSIGHTS.md`,
2026-08-02).

Pass both roots. `src` alone leaves the core unchecked, because `reviewer-core` is consumed as
source through a tsconfig alias and lives outside `server/src`.

Other useful outputs: `--output-type dot | dot -Tsvg > arch.svg` for a picture,
`--output-type json` when you want to script over the violations.

## What the gate checks

Measured against the real graph on **2026-08-04: 0 errors, 18 warnings, exit 0**.
152 modules, 471 dependencies cruised.

| Rule | Severity | Violations | Guards |
|---|---|---|---|
| `modules-no-raw-sdk` | error | 0 | a feature module importing `octokit`, `openai`, `@anthropic-ai/sdk`, `simple-git`, `@ast-grep/napi`, `postgres`, `js-tiktoken`, `dependency-cruiser` |
| `core-stays-pure` | error | 0 | `reviewer-core` reaching into server code, the DB, or HTTP |
| `ports-import-nothing` | error | 0 | `vendor/shared` growing a dependency other than `zod` |
| `adapters-are-leaves` | error | 0 | an adapter importing a feature module or the container |
| `platform-not-module-aware` | error | 0 | cross-cutting `platform/*` learning which modules exist |
| `routes-no-data-access` | warn | 6 | transport touching `db/**` or `drizzle-orm` |
| `application-no-db-schema` | warn | 5 | services/helpers importing `db/schema` |
| `no-circular` | warn | 5 | import cycles |
| `no-cross-module-internals` | warn | 1 | a module reaching into a sibling |
| `row-types-stay-in-persistence` | warn | 1 | a Drizzle Row type in an application/transport signature |

Counts are **edges**, not files — one `routes.ts` that imports both `db/schema` and
`drizzle-orm` contributes two.

## Why the severities split this way (the ratchet)

`error` means *this boundary is unbroken today*. All five error rules sit at zero, so the gate
exits 0 and CI is green from day one — while any new violation of them fails immediately. That
is the whole trick: a gate that starts red gets disabled within a week.

`warn` means *known drift with a burn-down list*. It is tracked, not tolerated: warns are not
licence to add more. When a warn rule's backlog reaches zero, **promote it to `error`** in the
same PR that clears the last one, so the ground gained is locked in. Never demote a rule to
clear a violation — fix the violation or add a named exception below.

Do not add `--ignore-known` / a `.dependency-cruiser-known-violations.json` baseline here. The
severity split already does that job, and a baseline file hides *which* rule is drifting behind
a hash.

## Exception ledger

Encoded as `pathNot` in the config. Each one is a deliberate, named trade — not a silent pass.

| Exception | Where | Why it stands |
|---|---|---|
| `adapters/depgraph` and `adapters/astgrep` may import `modules/repo-intel/constants.ts` | `adapters-are-leaves` | Both need `SUPPORTED_EXT`, which currently lives in the feature module. Clean fix: relocate the constant to `adapters/` or `vendor/shared`, then drop the exception. |
| `platform/container.ts` is exempt from `platform-not-module-aware` | `platform-not-module-aware` | It is the composition root; binding ports to adapters is its entire job. |
| `reviewer-core` may import `src/vendor/shared` | `core-stays-pure` | The port ring is logically inside the core but physically lives in `server/`, reached via the `@devdigest/shared` alias. Removing this exception would require moving `vendor/shared` into its own package. |
| `modules/_shared/**` is not a cross-module reach | `no-cross-module-internals` | `getContext` and `IdParams` are the sanctioned module kernel. |
| `modules/repo-intel/service.ts` may import `adapters/codeindex/extract` and `adapters/astgrep` | `application-no-db-schema` does not cover it; no rule forbids it | repo-intel **is** the indexer subsystem — it behaves as infrastructure and is reached only through the `container.repoIntel` facade. If a rule is ever added forbidding application→adapter imports, repo-intel needs an explicit carve-out. |
| `test/**` is excluded entirely | `options.exclude` | Tests legitimately reach through every ring to assemble fixtures. |

## Burn-down list

In the order that buys the most:

1. **`routes-no-data-access` → 0** (3 files). `polling/routes.ts`, `workspace/routes.ts`,
   `pulls/routes.ts`. `settings/` was cleaned up on 2026-08-04 and is the reference shape:
   `routes.ts` → `service.ts` → `repository.ts`. `workspace` is 34 lines and one `select`, so
   consider whether it needs the full split at all (see "When NOT to add a layer" in SKILL.md).
   `pulls/routes.ts` is the real work: 388 lines of GitHub sync, upserts and three aggregates,
   whose traps are documented in `server/docs/scores-and-costs.md`.
2. **`application-no-db-schema` → 0** (4 files). `reviews/run-executor.ts`,
   `reviews/diff-loader.ts`, `repos/helpers.ts`, `settings/feature-models.ts`.
3. **`row-types-stay-in-persistence` → 0** (1 edge). `ReviewService.resolveTargets()` returns
   `AgentRow[]`; map to a DTO.
4. **`no-cross-module-internals` → 0** (1 edge). `repos/service.ts` imports
   `repo-intel/constants.ts` — same `SUPPORTED_EXT` problem as the adapter exception, so one
   relocation clears both.
5. **`no-circular` → 0** (5 cycles), last because most of it is structural. Four run through
   the DI root (`container ↔ repo-intel/service` and its pipeline files) and are an artifact of
   services taking the whole `Container`; they dissolve when a service takes narrow ports
   instead. The fifth, `agents/helpers ↔ agents/repository`, is a genuine two-file cycle worth
   breaking on its own.

## Config gotchas (both measured on this tree)

- **`tsConfig: { fileName: 'tsconfig.json' }` is mandatory.** Without it the `@devdigest/*`
  path aliases resolve to nothing and rules touching the core or the ports silently pass.
- **Never anchor a package pattern.** Under pnpm, resolved paths look like
  `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/node_modules/drizzle-orm/index.cjs`, so
  `^node_modules/drizzle-orm` matched **0** dependencies while `node_modules/drizzle-orm/`
  matched **4**. Every package pattern in the config is unanchored and ends in a slash. An
  anchored rule reads as "clean" — the worst possible failure mode for a gate.
- `tsPreCompilationDeps: true` is needed to see **type-only** imports. Without it a
  `import type { AgentRow }` boundary crossing is invisible.

## Adding it to CI

Not wired yet. When it is: the gate needs no database, so it belongs in
`.github/workflows/server-unit.yml` (the hermetic job) as a step after install, not in
`server-integration.yml`. Keep it a separate step from `typecheck` so a boundary failure is
legible in the job summary.

## Changing the rules

The config is not a do-not-touch file, but it is a shared contract:

- Adding a rule → run it first and land it at the severity its real count supports.
- Tightening a severity → only with the backlog at zero.
- Adding an exception → add a row to the ledger above in the same change, with the clean fix
  named. An unexplained `pathNot` is indistinguishable from a bug.
