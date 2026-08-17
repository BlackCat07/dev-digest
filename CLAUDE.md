# DevDigest — agent guide

Local-first AI PR reviewer. Course starter: Part-0 works end to end; each lesson
adds one feature.

## Before answering

Search the curated docs FIRST — they may already answer it — then read code. In each
package (`client`, `server`, `reviewer-core`, `e2e`, `mcp-server`):

- `INSIGHTS.md` — dated, file-grounded findings; always present
- `docs/` — curated deep-dives; start at `docs/README.md`
- `specs/` — one file per feature, what it must do (`specs/README.md`); every package but
  `e2e` — see the exception below
- `CLAUDE.md` + `README.md` — the rules and the tour

Root: `README.md` · `TESTING.md` · `docs/agent-prompts/` · `docs/skills/` ·
`docs/specs-convention.md`.
One nested doc: `server/src/modules/repo-intel/README.md`.

**One exception:** `e2e/specs/` holds **browser flows** (`NN-name.flow.json`), which
`e2e/run.ts` loads — not feature specs. That package documents itself in `e2e/docs/`
and has no specs directory.

**And one gap:** `mcp-server/` has `INSIGHTS.md`, `specs/` and `CLAUDE.md` like the rest,
but **no `docs/`** — read `mcp-server/README.md` instead.

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
- **`mcp-server/` is an HTTP client of the API, not a server module** — it talks to
  `http://localhost:3001` over HTTP, never imports `platform/container.ts` and never
  touches Postgres, so it is deliberately **absent** from `server/src/modules/index.ts`.
  Its absence there is by design, not a missed registration.
- **ESM:** relative imports carry the `.js` extension.

## Do-not-touch

Never hand-edit:

- `server/src/vendor/shared/` and `client/src/vendor/shared/` — the cross-package contract
  and its hand-made copy. Coordination only, and both change together or the types drift.
  When a change is agreed, extend with a new file rather than reshaping an existing symbol.
- `client/src/vendor/ui/` — vendored design system shared across every screen. Extend via a
  new file; don't restyle a primitive to suit one feature.
- `server/src/db/migrations/` — generated. Edit `src/db/schema/`, then `pnpm db:generate`.
- **Lockfiles** — `server/pnpm-lock.yaml` and `client/pnpm-lock.yaml` (pnpm),
  `reviewer-core/package-lock.json` and `e2e/package-lock.json` (npm), plus root
  `skills-lock.json`. Change a dependency in that package's `package.json` and let that
  package's own package manager regenerate the file. Never patch a lockfile by hand, and
  never commit one an unrelated install churned.

## Use when

- Stack, commands, architecture, how to run → read `README.md`
- Working inside a package → read that package's CLAUDE.md: `server/CLAUDE.md`,
  `client/CLAUDE.md`, `reviewer-core/CLAUDE.md`, `e2e/CLAUDE.md`, `mcp-server/CLAUDE.md`
- Agent prompt templates → read `docs/agent-prompts/`
- Skill bodies meant to be **imported** rather than seeded → read `docs/skills/`
- Writing a feature spec → read `docs/specs-convention.md`
- **About to open a PR** → run `/pr-self-review`. It reviews the open local diff
  (committed **and** uncommitted), routes each changed file to the skills that own it, and
  records a verdict. A `PreToolUse` hook denies `gh pr create` / `gh pr merge` until that
  verdict is fresh and free of CRITICAL findings — see `.claude/skills/pr-self-review/`.
