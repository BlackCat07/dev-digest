# Cross-module specs

**Only specs for features that touch more than one package belong here.**

A feature living entirely inside one package gets its spec in that package's own
`specs/` directory instead:
[`client/specs/`](../client/specs/README.md) ·
[`server/specs/`](../server/specs/README.md) ·
[`reviewer-core/specs/`](../reviewer-core/specs/README.md) ·
[`mcp-server/specs/`](../mcp-server/specs/README.md).

Format, naming, `Spec ID`, the `Status` lifecycle and the required sections:
[`../docs/specs-convention.md`](../docs/specs-convention.md).

## Specs

| Spec ID | Spec | Packages | Status | Covers |
|---|---|---|---|---|
| SPEC-01 | [`project-context.md`](project-context.md) | server, client, reviewer-core | implemented | Attaching a repository's markdown documents to agents and skills by hand, the token cost of each, the `## Project context` prompt slot they fill at run time, and what the run trace shows about them. |
| SPEC-02 | [`onboarding-generator.md`](onboarding-generator.md) | server, client | draft | A five-part guided tour of an unfamiliar repository — architecture, critical paths, how to run locally, a rank-ordered reading path and first tasks — built from the repository index with one structured model call, and degrading to a deterministic skeleton with a named reason. |

## Why one file instead of one per package

A cross-module feature has **one** problem statement, **one** set of goals and **one** set
of acceptance criteria. Splitting them across two files means writing the shared half
twice, and two copies of a requirement drift — at which point neither file can be trusted
as the requirement.

What *is* per-package — the endpoint shape, the screen, the contract type — goes in a
per-package section inside this one file:

```markdown
## Acceptance criteria (EARS)

### AC-1 … AC-6 — server
### AC-7 … AC-11 — client
```

Each criterion still belongs to exactly one package, so a plan can still hand a task to
one implementer. What is shared stays written once.

## What is NOT here

- **A feature inside a single package** — that package's `specs/`.
- **Why a mechanism works this way**, trade-offs, abandoned approaches — the package's
  `docs/`, or `INSIGHTS.md` if it was learned the hard way.
- **Browser flows.** `e2e/specs/*.flow.json` is not a specs directory; it is the flow
  fixtures `e2e/run.ts` loads. e2e documentation lives in `e2e/docs/`.
- **A rule or convention** — a `CLAUDE.md`.

## Adding one

`spec-creator` writes these files; see
[`../.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md). Whichever writes
it, a new spec owes a row in the table above — a spec with no row is invisible.
