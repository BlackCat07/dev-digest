# Rule IDs

Stable identifiers for the rules this skill carries, so a finding can cite the rule it
rests on instead of asserting "this violates the dependency rule". The scheme mirrors this
repository's own `DDG-<AREA>-<NNN>` convention (see `.claude/skills/pr-self-review/routing.md`
Part 2).

**Cite the ID in a finding.** `OA-TRANS-001` is checkable; "bad layering" is not. An ID also
makes it obvious when two findings are one root cause.

**These IDs are the contract.** `test-cases/cases/*/expected-findings.json` references them,
and `test-cases/scripts/check-fixture-hygiene.sh` fails if a case cites an ID that is not
in the table below. Add a row here before using a new ID.

The `Gate` column names the `dependency-cruiser` rule in `server/.dependency-cruiser.cjs`
that mechanically catches the rule, and its severity. **`—` means no gate catches it**: the
rule is real but invisible to CI, which is exactly when a reviewer has to carry it.

## Core — `reviewer-core/src/**`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-CORE-001` | The core performs no I/O: no `fastify`, `drizzle-orm`, `octokit`, `simple-git`, `postgres`, no `node:fs`, no `process.env`. Its one side effect is the injected `LLMProvider` | `core-stays-pure` | error (npm/`src` edges only — `node:fs` and `process.env` are **not** caught) |
| `OA-CORE-002` | The core's only permitted outward edge is the port ring (`@devdigest/shared`). It never imports `server/src/**` | `core-stays-pure` | error |
| `OA-CORE-003` | A config value, a clock or a token is a **parameter**, never something the core reaches for | — | — |

## Ports — `src/vendor/shared/**`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-PORT-001` | The port ring declares contracts only; `zod` is its single dependency | `ports-import-nothing` | error |
| `OA-PORT-002` | A new external dependency gets its **port first** (`vendor/shared/adapters.ts`, no vendor name in it), then an adapter, then a mock, then a lazy container getter and a `ContainerOverrides` field | — | — |
| `OA-PORT-003` | `vendor/shared` is a hand-synced cross-package contract: extend with a new symbol, never reshape an existing one, and both copies move together | `DDG-DNT-001` (self-review) | CRITICAL |

## Application — `modules/*/service.ts`, `run-executor.ts`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-APP-001` | A service never imports `src/adapters/**`. It takes the interface off `container` | — (**the gate only sees direct npm edges**) | — |
| `OA-APP-002` | A module never imports a vendor SDK directly | `modules-no-raw-sdk` | error |
| `OA-APP-003` | The application ring does not know the Drizzle schema, and no Row type appears in an application or transport signature | `application-no-db-schema`, `row-types-stay-in-persistence` | warn |
| `OA-APP-004` | A **new** service takes the ports it needs, not the whole `Container`. `AgentsService`, `ReviewService` and `RepoIntelService` taking `Container` are **not** a refactor target | `no-circular` (indirectly) | warn |

## Infrastructure — `src/adapters/**`, `db/**`, `modules/*/repository*.ts`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-INFRA-001` | DB queries live in `modules/<name>/repository.ts`; those files alone touch `db/schema` + `drizzle-orm`. A repository returns rows or domain values, never a leaked query builder | `routes-no-data-access`, `application-no-db-schema` | warn |
| `OA-INFRA-002` | An adapter is a leaf: it knows nothing about a feature module or the composition root | `adapters-are-leaves` | error |
| `OA-INFRA-003` | The **service** owns the transaction boundary: it opens `db.transaction` and passes `tx` down | — | — |

## Transport — `modules/*/routes.ts`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-TRANS-001` | A route is Zod schema → call the service → map the result. No logic, no DB, no SDK | `routes-no-data-access` | warn |

## Composition root — `platform/**`

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-ROOT-001` | Only `platform/container.ts` may know that modules exist. The rest of `platform/` is cross-cutting and sits below every feature | `platform-not-module-aware` | error |

## Cross-module

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-MOD-001` | A module never reaches into a sibling's internals. Go through `container.*`, or lift the shared part to `modules/_shared/`. `import type` does **not** exempt it | `no-cross-module-internals` | warn |

## Boundaries

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-BND-001` | Every boundary **parses**; it never casts. Request, response, jsonb read back from Postgres, LLM output, GitHub payload | — | — |

## Sizing — when NOT to add a layer

Nothing mechanical catches any of these, and nothing else in the repository states them.
They are the rules a reviewer only applies if something reminds them to.

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-SIZE-001` | A repository earns its place on the **second consumer** of a query, or when a route passes ~50 lines or two tables | — | — |
| `OA-SIZE-002` | No rich entity classes. Zod contracts plus pure functions are the deliberate choice; an "anemic model" is not a defect here | — | — |
| `OA-SIZE-003` | Never rename or move files just to match the shape. Onion is about the direction of dependencies, not folder vocabulary | — | — |

## Composite — legal per edge, illegal in composition

Nothing mechanical can catch these: each individual import is permitted and the defect is in
what they add up to. See SKILL.md, "Following the chain".

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-DEEP-001` | An import is only as pure as what it imports. `ports-import-nothing` bans `^src/` from the port ring but not `node:*`, so a port-ring file doing I/O at module scope makes every importer impure — the core included — with both purity rules still green. Follow one hop into the port ring or `_shared` and read its imports | — | — |
| `OA-DEEP-002` | A port that cannot be faked is not a port. Every type in a consumer-declared port signature must belong to the port ring or to the consuming module; a Drizzle Row type in a port signature has moved the schema into the contract, and the cast in the fake is the tell | — | — |

## Review process

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-REV-001` | A green gate is evidence about the rules that exist, not about the diff. An adapter-class import, a Node builtin, anything at `warn`, and a missing `modules/index.ts` registration all pass a clean `depcruise` run — check them by reading | — | — |
| `OA-REV-002` | Before approving a module's structure, name what earns each ring the diff introduces. If nothing does, recommend removing it: less structure is a normal review outcome | — | — |

## Enforcement

| ID | Rule | Gate | Severity |
|---|---|---|---|
| `OA-GATE-001` | A `warn` is **known drift on a burn-down list, not licence to add more**. Severities are a ratchet: promote a `warn` to `error` once its backlog is cleared. A green `--output-type err` run is not evidence a patch is clean | — | — |
| `OA-GATE-002` | The exception ledger is closed: `modules/repo-intel/service.ts` importing adapters, and `adapters/depgraph` + `adapters/astgrep` reading `repo-intel/constants.ts`, are **named** exceptions encoded as `pathNot`. A new adapter→feature edge is not covered by them, and no rule requires a "ledger row" for anything else | encoded `pathNot` | — |
