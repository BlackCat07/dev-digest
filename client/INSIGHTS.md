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

- **2026-08-03** — A hover panel anchored to a PR-list row has to be `position: fixed` off
  `getBoundingClientRect()`, **not** the `absolute`-inside-a-`relative`-wrapper shape
  `vendor/ui/kit/Dropdown.tsx` uses: the list's `s.tableCard` sets `overflow: hidden`, which
  clips any absolutely-positioned descendant. Three things follow. The app scrolls an inner
  `<main>` (`AppFrame`), so closing on scroll needs a **capture-phase** listener — `scroll`
  doesn't bubble to `window`. When flipping above the trigger, anchor the panel's `bottom` to
  the trigger's top instead of computing a `top` offset, or it clamps over the app header on a
  short viewport. And keep the panel's data fetch in a child mounted only while open, because
  `PRRow.test.tsx` renders with `NextIntlClientProvider` **only** — any `useQuery` in `PRRow`'s
  always-rendered subtree throws "No QueryClient set" in all of its existing cases. Evidence:
  `src/app/repos/[repoId]/pulls/styles.ts` (`tableCard`),
  `_components/FindingsHoverCard/` (`FindingsHoverTrigger`), `_components/PrFindingsCell/`.

## What Doesn't Work

Dead ends and antipatterns, and why they fail. The most-skipped section and the most
valuable one — the code does not record what was tried and abandoned.

<!-- append below -->

- **2026-08-03** — Don't infer UI placement from the design **screenshots** alone, and don't
  conclude "absent from the mock ⇒ never designed". `DevDigest Design (standalone).html` is a
  self-extracting bundle — plain `grep` finds nothing, because the payload is base64+gzip
  inside `<script type="__bundler/manifest">` (a JSON map of uuid → `{mime, compressed,
  data}`; decode with `gzip.decompress(base64.b64decode(...))`, asset name = the leading
  `/* … */` comment). Decoding it showed the severity filter WAS designed — three `Chip`s
  with icon + label + count in `findings.jsx` `FindingsPanel` — but that component is
  **orphaned**: defined and exported, mounted by no screen, while the screens render
  `ReviewRunCard` with `const shown = run.findings;` and no filter. A severity chip row was
  therefore built above the TIMELINE, where the mock has literally nothing between the tab bar
  and the section label, and it had to be moved into the per-run panel afterwards. Decode the
  bundle before deciding where something goes. Evidence:
  `_components/FindingsPanel/FindingsPanel.tsx`, `_components/SeverityFilter/`,
  `../../../../../DevDigest Design (standalone).html`.
- **2026-08-03** — Running `next build`, **or the hermetic e2e stack**, while a `next dev`
  server is up corrupts that dev server: all three write the same `client/.next`, and
  `NEXT_PUBLIC_API_BASE` is inlined at compile time, so the dev server on `:3000` starts
  serving chunks with the hermetic API's `:3101` baked in ("Cannot reach the DevDigest engine
  at http://localhost:3101") — or dies outright with a 500 on every route after a `next build`,
  which no amount of reloading fixes. `touch src/lib/api.ts` forces the recompile that repairs
  the env inlining; a `next build` collision needs a full dev-server restart. Evidence:
  `next.config.mjs` (`env`), `../scripts/e2e.sh` (web 3100 / API 3101, same client dir).

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

- **2026-08-03** — `Module not found: Can't resolve './contracts/findings.js'` pointing at
  `src/vendor/shared/index.ts` during a Next compile means something imported a **runtime
  value** — not just a type — from `@devdigest/shared`. That vendored barrel re-exports with
  ESM `.js` extensions webpack won't map back to `.ts`, and every other client import from
  the package is `import type`, so the extensions had never been exercised. The trap is the
  feedback loop: `tsc --noEmit` **and** `vitest` both pass (each resolves the alias its own
  way) and the failure surfaces only under `next build` / `next dev`, as a **500 on every
  route that transitively imports it** — here it broke 6 of 7 e2e flows while both unit
  suites stayed green. Keep client imports of `@devdigest/shared` type-only and put any
  runtime constant in `src/lib/` (this is why `SEVERITY_LEVELS` in `src/lib/severity.ts`
  exists instead of validating against the Zod enum's `Severity.options`). Evidence:
  `src/vendor/shared/index.ts`, `src/app/repos/[repoId]/pulls/[number]/page.tsx`,
  `src/lib/severity.ts`.
- **2026-08-03** — Addendum to the entry above: the `?sev` param it cites was later removed
  (the severity filter became local per-run state), so `page.tsx` no longer validates anything
  against `SEVERITY_LEVELS`. The **rule is unchanged and still load-bearing** — client imports
  of `@devdigest/shared` must stay `import type`, and `src/lib/severity.ts` remains the home
  for the runtime constants. Only the example is historical.

## Session Notes

Dated summaries, for when the shape of a session is itself the lesson.

<!-- append below -->

_No entries yet._

## Open Questions

Left unresolved, stated precisely enough for the next session to pick up.

<!-- append below -->

_No entries yet._
