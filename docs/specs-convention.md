# Feature specs — the shared convention

Every package keeps its feature specs in its own `specs/` directory. This file defines the
format once so the per-package `specs/README.md` files don't each carry their own copy of it.

## Where specs live

| Package | Specs directory |
|---|---|
| `client` | `client/specs/` |
| `server` | `server/specs/` |
| `reviewer-core` | `reviewer-core/specs/` |
| `mcp-server` | `mcp-server/specs/` |
| `e2e` | **none** — `e2e/specs/` is already taken by browser flows (`NN-name.flow.json`), which `e2e/run.ts` loads. e2e documentation lives in `e2e/docs/`. |

A feature that spans packages gets **one spec per package**, each describing that
package's half — the client spec covers what the user sees, the server spec covers the
payload it needs. They cross-link; neither is the "main" one.

## One file per feature

`specs/<feature-name>.md`, kebab-case, named after the feature rather than the lesson or
the branch (`findings-severity.md`, not `l02.md`). A spec is **append-and-amend**: when a
later change alters the behaviour, edit the spec so it keeps describing the current system,
and note what changed under *History*. It is not a changelog — git is the changelog.

## Required sections

```markdown
# <Feature name>

One sentence: what a user can do that they couldn't before.

## Behaviour
What it must do, observably. Numbered, testable statements — not implementation.

## Data
Where the numbers come from: endpoint, contract type, which rows.

## States
Empty, zero, loading, error, partial. The cases that get skipped and then ship broken.

## Non-goals
What this deliberately does NOT do, so a future reader doesn't "fix" it.

## Implementation
The files that carry it, one line each. Pointers, not a description of the code.

## History
`YYYY-MM-DD` — what changed and why.
```

Drop a section only when it is genuinely empty, and say so (`## Non-goals — none`) rather
than silently omitting it.

## What a spec is not

- **Not a design doc.** Trade-offs, rejected approaches and gotchas belong in the
  package's `docs/` or, if they were discovered the hard way, `INSIGHTS.md`.
- **Not a rule.** "Never call `fetch` in a component" is a convention → `CLAUDE.md`.
- **Not a test plan.** Behaviour statements should be testable, but the suites and the CI
  matrix are `TESTING.md`'s.

## Why the format matters beyond humans

The `specs` prompt slot in `reviewer-core` (`assemblePrompt`, `src/prompt.ts`) is fed by a
later lesson and passes spec text to the reviewing model as **untrusted, delimiter-wrapped
data** — so a spec is a future review input, not just documentation. Two consequences:

- Write behaviour as checkable statements; that is what a model can review a diff against.
- Never put instructions to the reviewer in a spec ("ignore X", "don't flag Y"). The
  injection guard is built to disregard exactly that, and it will.
