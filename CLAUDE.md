# DevDigest — agent guide

Local-first AI PR reviewer. Course starter: Part-0 works end to end; each lesson
adds one feature.

## Before answering

Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` **that
exist** for what the user asks about FIRST — these are curated and may already answer
it — then read code. Not every package has a `docs/` or `specs/`; an absent one is the
normal state, not a failed lookup. `INSIGHTS.md` is always present.

## Session protocol (engineering-insights loop)

The `engineering-insights` skill carries the full procedure for both halves of this loop.

- **Before answering** — not merely before editing — read the relevant package's
  `INSIGHTS.md` **in full** and emit a one-line receipt per file, e.g.
  `INSIGHTS server: 4 entries, 1 relevant (2026-08-02 — migrations never run on boot)` or
  `INSIGHTS client: 0 entries`. No answer about a package's code ships before its receipt.
  Treat the entries as high-confidence guidance unless told otherwise, and raise a
  conflicting entry *before* starting the work, not after.
- **`0 entries` is a real answer.** If every section reads "no entries yet", say so — do
  not re-read and do not go looking for another file.
- **Before recording an insight:** re-read that package's `INSIGHTS.md` and do not
  duplicate what's already there, or what `CLAUDE.md` / `README.md` / `TESTING.md`
  already say.
- **End of session:** run `/engineering-insights`. Record mid-session too, the moment
  something non-obvious is confirmed. Record only substantial, file-grounded,
  non-duplicate findings; if nothing substantial came up, write nothing — but don't skip
  the check. Entries go under one of seven fixed sections, and writes are strictly
  **append-only** (never edit, delete, or reorder an existing entry; never overwrite an
  `INSIGHTS.md`).

## Conventions (not obvious from code)

- **NOT a monorepo workspace** — each package has its own `package.json`/lockfile;
  cross-package code is shared through tsconfig path aliases.
- Modules are registered **statically** in `server/src/modules/index.ts` (no filesystem
  autoload).
- **ESM:** relative imports carry the `.js` extension.

## Do-not-touch

`server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit without
coordination.

## Use when

- Stack, commands, architecture, how to run → read `README.md`
- Working inside a package → read that package's CLAUDE.md: `server/CLAUDE.md`,
  `client/CLAUDE.md`, `reviewer-core/CLAUDE.md`, `e2e/CLAUDE.md`
- Agent prompt templates → read `docs/agent-prompts/`
