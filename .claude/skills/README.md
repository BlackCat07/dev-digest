# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

Subagents are the neighbouring concept and live in [`../agents/`](../agents/README.md) — different frontmatter (`tools:`, not `allowed-tools:`), their own context, their own model.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [engineering-insights](engineering-insights/SKILL.md) | Meta | Reads a package's `INSIGHTS.md` before the work, appends what was learned after it |
| [run-plan](run-plan/SKILL.md) | Workflow | Executes an existing Implementation Plan — implementer waves → Done-conditions → verify ‖ boundaries → bounded fix loop → docs → verdict. Starts at the plan; `spec-creator` and `implementation-planner` are run by hand |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow | Reviews the open local diff before a PR is opened, routes each file to the skills that own it, blocks the merge on a CRITICAL |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring a server file belongs to and which way its dependencies may point |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where files go, when to split a component, which layer owns logic and state |
| [product-ui-language](product-ui-language/SKILL.md) | Frontend | Token roles, spacing and type scale, and the recipes for a list / detail / grid / modal screen — portable to a second product |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |

`engineering-insights`, `run-plan`, `frontend-ui-architecture`,
`onion-architecture`, `product-ui-language` and `pr-self-review` are authored in
this repo. Vendored
skills are pulled from GitHub and pinned by hash in `../../skills-lock.json`;
locally-authored ones have no upstream and do not belong in that lockfile.

**Three skills sit in neither group, and the difference decides whether their
`SKILL.md` may be reshaped.** `react-testing-library`, `react-best-practices` and
`security` carry **no entry in `skills-lock.json`** — `react-testing-library` was
rewritten here against a source list recorded in its own `README.md`, so it is
effectively authored in this repo and free to restructure. Everything that *does*
have a lock entry (`postgresql-table-design`, `zod`, `typescript-expert`,
`fastify-best-practices`, `next-best-practices`, `drizzle-orm-patterns`, …) is
pinned by `computedHash` over its `SKILL.md`: reshaping one drifts that hash, and
the root `CLAUDE.md` lists the lockfile as never-hand-edit. Check the lockfile
before editing a `SKILL.md`, not after.

`pr-self-review` is the only skill that ships executables and the only one wired
into the harness: `pr-self-review/scripts/` holds the tree fingerprint and the
merge gate, and the `PreToolUse` entry in `../settings.json` calls the latter to
block `gh pr create` / `gh pr merge` until that skill has recorded a fresh,
non-blocking verdict.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **[Agents](../agents/README.md)** (`.md`) | Workflows | Dispatched as a subagent | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
