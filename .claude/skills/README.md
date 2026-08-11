# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

Subagents are the neighbouring concept and live in [`../agents/`](../agents/README.md) — different frontmatter (`tools:`, not `allowed-tools:`), their own context, their own model.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [engineering-insights](engineering-insights/SKILL.md) | Meta | Reads a package's `INSIGHTS.md` before the work, appends what was learned after it |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow | Reviews the open local diff before a PR is opened, routes each file to the skills that own it, blocks the merge on a CRITICAL |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring a server file belongs to and which way its dependencies may point |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where files go, when to split a component, which layer owns logic and state |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |

`engineering-insights`, `frontend-ui-architecture`, `onion-architecture` and
`pr-self-review` are authored in
this repo. Every other
skill is vendored from GitHub and pinned by hash in `../../skills-lock.json` —
locally-authored skills have no upstream and do not belong in that lockfile.

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
