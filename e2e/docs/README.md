# e2e docs

Curated deep-dives for `@devdigest/e2e` — topics too long for `CLAUDE.md` and too specific
for `README.md`.

## ⚠️ Naming: this package has no feature specs

Every other package keeps feature specs in `<package>/specs/`. Here **`specs/` is already
taken**: it holds the browser flows (`NN-name.flow.json`) that `run.ts` loads, and it is not
a specifications directory. e2e documentation lives in this folder instead.

The repo-wide convention, and this exception, are stated in the root `CLAUDE.md` and in
[`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## What's here

| Document | Read it when |
|---|---|
| [`adding-a-flow.md`](adding-a-flow.md) | Writing a new flow — the authoring checklist, and the assertions this harness cannot express. |

## What is NOT here

| Looking for | Read |
|---|---|
| Flow anatomy, the locator reference, seeded-data preconditions | [`../README.md`](../README.md) |
| The rules themselves — deterministic locators, no `chat`, read-only data | [`../CLAUDE.md`](../CLAUDE.md) |
| Dated one-off findings with evidence paths | [`../INSIGHTS.md`](../INSIGHTS.md) |
| Where this suite sits in the CI matrix | [`../../TESTING.md`](../../TESTING.md) |
| The flows themselves | [`../specs/`](../specs/) |
