# reviewer-core docs

Curated deep-dives for `@devdigest/reviewer-core` — topics too long for `CLAUDE.md` and too
specific for `README.md`.

## What's here

| Document | Read it when |
|---|---|
| [`grounding.md`](grounding.md) | Touching findings, the score, or the prompt. The two gates this package exists for — citation grounding and injection defense — and what breaks when you route around them. |

## What is NOT here

Each of these owns its ground. A doc in this folder must link them, not restate them.

| Looking for | Read |
|---|---|
| Pipeline diagram, the full public API list, what each lesson adds | [`../README.md`](../README.md) |
| The rules themselves — purity, the barrel, npm-not-pnpm | [`../CLAUDE.md`](../CLAUDE.md) |
| Dated one-off findings with evidence paths | [`../INSIGHTS.md`](../INSIGHTS.md) |
| What a feature is supposed to do | [`../specs/`](../specs/README.md) |
| How the server injects the provider | `../../server/src/platform/container.ts` |

## Adding a document

One topic per file, kebab-case. Check the five files above first — if the answer already
lives in one, link it. A doc that repeats `CLAUDE.md` will drift from it, and then two
files disagree with no way to tell which is current.
