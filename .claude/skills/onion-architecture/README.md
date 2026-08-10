# onion-architecture — provenance & sources

A local, hand-authored skill (not pulled from a registry — it is deliberately **not** in
`skills-lock.json`, which pins only vendored skills). It names the onion / ports-and-adapters
layering the DevDigest backend already follows, maps it onto real files, and ships a
`dependency-cruiser` gate to enforce it.

- **Scope:** `server/` (Fastify 5 + Drizzle 0.38 + Postgres/pgvector + Zod 3) and
  `reviewer-core/` (the pure domain core).
- **Out of scope:** `client/` → use `frontend-ui-architecture` and `react-best-practices`.
  API-level rules for the tools themselves → `fastify-best-practices`,
  `drizzle-orm-patterns`, `zod`, `postgresql-table-design`.
- **Grounded in:** root `CLAUDE.md`, `server/CLAUDE.md`, `reviewer-core/CLAUDE.md`,
  `server/README.md`, `server/INSIGHTS.md`, `server/docs/scores-and-costs.md`,
  `server/src/platform/container.ts`, `server/src/app.ts`, `server/src/modules/index.ts`,
  `server/src/vendor/shared/adapters.ts`, `server/tsconfig.json`.

Every claim about this codebase in these files was checked against the tree, and every
violation count came from an actual `depcruise` run rather than a grep estimate. Two claims
that a naive reading gets wrong, both recorded in `server/INSIGHTS.md` (2026-08-04): a
`dependency-cruiser` package pattern anchored as `^node_modules/<pkg>` never fires under pnpm,
and omitting `tsConfig` makes every rule that crosses a `@devdigest/*` alias silently pass.

## Reading list (the practices this skill distills)

### Onion / Clean architecture (canon)

- Jeffrey Palermo — The Onion Architecture: part 1 — https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Jeffrey Palermo — part 2 — https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/
- Jeffrey Palermo — onion-architecture tag (the whole series) — https://jeffreypalermo.com/tag/onion-architecture/
- Robert C. Martin — The Clean Architecture — https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Alistair Cockburn — Hexagonal Architecture (ports & adapters, 2005) — https://alistair.cockburn.us/hexagonal-architecture
- Herberto Graça — Onion Architecture (The Software Architecture Chronicles) — https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85
- Herberto Graça — DDD, Hexagonal, Onion, Clean, CQRS: how I put it all together — https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/
- Khalil Stemmler — The Dependency Rule — https://khalilstemmler.com/wiki/dependency-rule/
- Clean vs Onion vs Hexagonal, side by side — https://ccd-akademie.de/en/clean-architecture-vs-onion-architecture-vs-hexagonal-architecture/
- Original Palermo example (repo) — https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture

### Ports & adapters in Node.js / TypeScript

- Domain-Driven Hexagon (Sairyss) — https://dev.to/sairyss/domain-driven-hexagon-18g5
- Khalil Stemmler — Clean Node.js Architecture — https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/
- Khalil Stemmler — Better Software Design with Application Layer Use Cases — https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/
- Khalil Stemmler — DTOs, Mappers & the Repository Pattern — https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/
- Dyarlen Iber — Hexagonal Architecture and Clean Architecture with examples — https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi
- Saad Hasan — Adapter/Port architecture in two real codebases — https://saadh393.github.io/blog/adapter-port-architecture-two-cases
- Alex Rusin — Future-Proof Your Code: a guide to Ports & Adapters — https://blog.alexrusin.com/future-proof-your-code-a-guide-to-ports-adapters-hexagonal-architecture/
- TSH — Hexagonal architecture: is it for me? A no-nonsense overview — https://tsh.io/blog/hexagonal-architecture

### dependency-cruiser (forcing the boundaries)

- dependency-cruiser — rules reference (`forbidden`, `from`/`to`, `pathNot`, `scope`, `$1` groups, `dependencyTypes`) — https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- dependency-cruiser — npm — https://www.npmjs.com/package/dependency-cruiser
- Atomic Object — Dependency Cruiser: restrict imports in JavaScript — https://spin.atomicobject.com/dependency-cruiser-imports/
- Xebia — Taking frontend architecture serious with dependency-cruiser — https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/
- Avoid cross-module dependencies with dependency-cruiser — https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b
- A worked config with "domain must not depend on the framework" — https://docs.synapsestudios.com/implementation/frameworks/nest/dependency-cruiser-config
- cubic — How to maintain clean architecture with dependency rules — https://www.cubic.dev/blog/how-to-maintain-clean-architecture-with-dependency-rules-in-your-codebase

### Fastify (layering, encapsulation, DI)

- Fastify — The hitchhiker's guide to plugins — https://fastify.dev/docs/latest/Guides/Plugins-Guide/
- Fastify — Encapsulation reference — https://fastify.dev/docs/latest/Reference/Encapsulation/
- Fastify — TypeScript reference (`FastifyPluginAsync`, `getDecorator<T>`) — https://fastify.dev/docs/latest/Reference/TypeScript/
- fastify/help #284 — what is best practice for dependency injection? — https://github.com/fastify/help/issues/284
- fastify/fastify #2735 — plugin encapsulation — https://github.com/fastify/fastify/discussions/2735
- Snyk — Fastify plugins as building blocks for a backend Node.js API — https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/
- node-fastify-architecture — a modular Fastify layout — https://github.com/sujeet-agrahari/node-fastify-architecture

### Drizzle ORM / repository pattern / transactions

- Drizzle — Transactions (`db.transaction`, `tx` mirrors `db`, savepoints, `tx.rollback()`) — https://orm.drizzle.team/docs/transactions
- Sentry — Atomic repositories in clean architecture and TypeScript (Drizzle-based, transactions passed into repositories) — https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/
- Repository pattern with Drizzle ORM — https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae
- Drizzle ORM best practices: repository granularity, unit of work — https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/
- Clean architecture + unit of work in Node.js — https://dev.to/schead/using-clean-architecture-and-the-unit-of-work-pattern-on-a-nodejs-application-3pc9
- Microsoft Learn — infrastructure persistence layer design — https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design

### Zod (parsing at the boundary)

- Zod — https://github.com/colinhacks/zod
- Stop trusting your API: the DTO as an anti-corruption layer — https://joshkaramuth.com/blog/tanstack-zod-dto/
- Parsing and mapping API responses with Zod — https://angular.love/parsing-and-mapping-api-response-using-zod-js

### Against over-layering (why the skill has a "when NOT to" section)

- Milan Jovanović — Where vertical slices fit inside the modular monolith — https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture
- Mehmet Ozkaya — The problem with Clean Architecture: vertical slices — https://medium.com/design-microservices-architecture-with-patterns/the-problem-with-clean-architecture-vertical-slices-111537c0ffcb
- Clean Architecture + modular monolith + vertical slice, combined — https://medium.com/@eda.belge/clean-architecture-with-modular-monolith-and-vertical-slice-896b7ee22e3e
- Anemic domain model — https://en.wikipedia.org/wiki/Anemic_domain_model
- Design your repository like a senior, and avoid common anti-patterns — https://medium.com/clean-code-playbook/design-your-repository-like-a-senior-and-avoid-common-anti-patterns-9aacc2df3554

## Files

- `SKILL.md` — the one rule, the ring diagram, the layer table, the decision framework, the
  "add a dependency" recipe.
- `layer-map.md` — every ring mapped to real files, the tool→port→adapter table, and a
  "where does it go?" cheatsheet.
- `enforcement.md` — the `dependency-cruiser` config explained, the npm script, the severity
  ratchet, the exception ledger, and the burn-down list.
- `README.md` — this file.

The gate itself lives outside the skill, in the package it guards:
`server/.dependency-cruiser.cjs`.
