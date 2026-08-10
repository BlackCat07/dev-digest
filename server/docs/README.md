# server docs

Curated deep-dives for `@devdigest/api` — topics too long for `CLAUDE.md` and too specific
for `README.md`.

## What's here

| Document | Read it when |
|---|---|
| [`scores-and-costs.md`](scores-and-costs.md) | Touching any PR-level aggregate — score, cost, findings counts. Explains why a "latest row" is never the answer on this schema. `src/modules/pulls/routes.ts` cites this file by name. |
| [`conventions-quality.md`](conventions-quality.md) | Changing anything in the conventions extractor, or asking why its candidates are worth trusting. The four filters between a model's answer and a stored candidate, what each catches, what is deliberately not built, and two approaches that were measured and abandoned. |

## What is NOT here

Each of these owns its ground. A doc in this folder must link them, not restate them.

| Looking for | Read |
|---|---|
| Route map, request/DI flow, the error envelope, env vars | [`../README.md`](../README.md) |
| The rules themselves — adapters, Zod route schemas, do-not-touch | [`../CLAUDE.md`](../CLAUDE.md) |
| Dated one-off findings with evidence paths | [`../INSIGHTS.md`](../INSIGHTS.md) |
| What a feature is supposed to do | [`../specs/`](../specs/README.md) |
| Test philosophy, the hermetic/`.it.test.ts` split, the CI matrix | [`../../TESTING.md`](../../TESTING.md) |
| The `repo-intel` indexing pipeline | [`../src/modules/repo-intel/README.md`](../src/modules/repo-intel/README.md) |

## Adding a document

One topic per file, kebab-case. Check the six files above first — if the answer already
lives in one, link it. A doc that repeats `CLAUDE.md` will drift from it, and then two
files disagree with no way to tell which is current.
