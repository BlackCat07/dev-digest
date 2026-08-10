# Importable skills

Skill bodies that are **not** seeded, kept here as `.md` files to be brought into a
workspace through **Skills Lab → Import** (`POST /skills/import`).

## Why a file instead of a seed row

Everything in `server/src/db/seed-skills.ts` appears in a fresh workspace automatically.
That is right for the built-ins, and wrong for demonstrating what import actually does —
an imported body takes a different path through the system and it is worth seeing:

| | seeded / hand-written | imported from a file |
|---|---|---|
| `skills.source` | `manual` | `imported_url` |
| Starts | enabled | **disabled**, pending vetting |
| In an agent's prompt | trusted instruction text | **delimiter-wrapped as untrusted data** |

That last row is the one that matters. `SkillsService.resolveBodiesForAgent` wraps any
body whose source is not `manual`, so an imported skill reaches the reviewing model
inside `<untrusted>…</untrusted>` — visible in the run trace, and the reason an imported
file cannot address the model directly.

## How to import one

1. **Skills Lab → Import**, pick the `.md` file.
2. The skill lands **disabled**. Read it, then enable it.
3. Attach it to an agent in the agent editor's **Skills** tab; order matters.

## What is here

| File | What it does |
|---|---|
| [`api-semver-discipline.md`](./api-semver-discipline.md) | Flags a breaking contract change that ships without the version bump it demands. One of L02's four API-contract skills; the other three are seeded. |
| [`breaking-change.md`](./breaking-change.md) | Flags a change an existing caller cannot survive, with a good/bad example. Homework variant of `api-contract-guard`, authored rather than seeded. |
| [`response-schema.md`](./response-schema.md) | Flags a reshaped response — envelope, field types, optionality — with a good/bad example. Homework variant of `api-response-schema`. |
| [`deprecation-policy.md`](./deprecation-policy.md) | Flags one-step removal of public surface; shows the forwarding-wrapper pattern. Homework variant of `api-deprecation-policy`. |

## Writing one

The conventions are the same as for any skill body — see `docs/agent-prompts/README.md`
for what a reviewer prompt may and may not contain. In short: checkable statements, the
`CRITICAL / WARNING / SUGGESTION` vocabulary if severity is mentioned at all, no JSON
shape, and no "return at most N findings" quota.
