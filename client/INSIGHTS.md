# client — engineering insights

Append-only journal for `@devdigest/web`. Seven fixed sections; newest entry at the
bottom of its section.

**Relationship to `CLAUDE.md`:** this file is the inbox — one-off, file-grounded
observations. `CLAUDE.md` holds what has stabilised into a rule. When the same insight
costs a second mistake, promote a one-line version into `CLAUDE.md` (Conventions or
Gotchas) and leave the entry here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real
state — report `0 entries` rather than treating it as a failed load.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every
  prior entry. Append with an anchored `Edit` on the target section's
  `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or
  already stated in `CLAUDE.md` / `README.md` / `../TESTING.md`.
- **Substantial.** Record what cost real time or would mislead the next reader. Not:
  code structure that is plain from reading it, style nits, linter-catchable issues,
  or facts true only inside one session.
- Nothing substantial this session → write nothing. That is a valid outcome.

## Entry format

One bullet per insight, appended under the one section it belongs to:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `src/path/file.tsx` (`ComponentName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

Replacing a section's `_No entries yet._` placeholder on first append is expected — it is
not an entry.

The skill that maintains this file: `.claude/skills/engineering-insights/`.

---

## What Works

Approaches and solutions that worked and should be reused.

<!-- append below -->

_No entries yet._

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

_No entries yet._

## Codebase Patterns

Conventions and architectural decisions, each with the reason behind it.

<!-- append below -->

- **2026-08-02** — The PR-list table has a **three-way hand-synced invariant**: the track
  count in `GRID` ↔ `COLUMN_KEYS.length` ↔ the number of top-level `<div>`s `PRRow` returns.
  Nothing in the type system ties them, and a mismatch doesn't error — it silently shifts
  every column after the offending one. Adding a column means exactly those three plus the
  `list.columns.<key>` message; `pulls/styles.ts` and `page.tsx` need no edit because
  `s.row`/`s.headRow` read `GRID` and the (inline) header maps `COLUMN_KEYS`. Note
  `s.headCell(alignRight)` models only "is the last column", so right-aligning a middle
  column needs a signature change. Evidence:
  `src/app/repos/[repoId]/pulls/constants.ts` (`GRID`, `COLUMN_KEYS`),
  `_components/PRRow/PRRow.tsx`.
- **2026-08-02** — A feature unit shared by the PR **list** and PR **detail** must live in
  `pulls/_components/`, not `pulls/[number]/_components/` — the latter sits below the list
  route and can only be reached from it by an upward cross-route import. Such a unit also
  needs its own `styles.ts` rather than borrowing the page-level `pulls/styles.ts` its
  siblings (`PRRow`, `FilterBar`) use, since it belongs to no single page. Correspondingly,
  formatters more than one route subtree needs go in `src/lib/` (see `src/lib/format.ts`), not
  a unit's `helpers.ts` — that file is unit-private under the barrel convention. Evidence:
  `src/app/repos/[repoId]/pulls/_components/RunCostBadge/`.

## Tool & Library Notes

Dependency and tooling quirks.

<!-- append below -->

_No entries yet._

## Recurring Errors & Fixes

An error string, its real cause, and the fix.

<!-- append below -->

_No entries yet._

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
