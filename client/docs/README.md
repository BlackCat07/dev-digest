# client docs

Curated deep-dives for `@devdigest/web` — topics too long for `CLAUDE.md` and too
specific for `README.md`.

## What's here

| Document | Read it when |
|---|---|
| [`feature-unit.md`](feature-unit.md) | Adding or moving a component — where the folder goes, and the two invariants that break silently. |

## What is NOT here

Each of these owns its ground. A doc in this folder must link them, not restate them.

| Looking for | Read |
|---|---|
| Route map, which API each route leans on, error-UX taxonomy | [`../README.md`](../README.md) |
| The rules themselves — styling, i18n, the fetch boundary, do-not-touch | [`../CLAUDE.md`](../CLAUDE.md) |
| Dated one-off findings with evidence paths | [`../INSIGHTS.md`](../INSIGHTS.md) |
| What a feature is supposed to do | [`../specs/`](../specs/README.md) |
| Test philosophy and the CI matrix | [`../../TESTING.md`](../../TESTING.md) |

## Adding a document

One topic per file, kebab-case. Check the five files above first — if the answer already
lives in one, link it. A doc that repeats `CLAUDE.md` will drift from it, and then two
files disagree with no way to tell which is current.
