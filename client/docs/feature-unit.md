# The colocated feature unit — where a component goes

`CLAUDE.md` states the convention in three lines. This is the part you need when the
component you are adding is not a leaf: **which directory it belongs in, and which
invariants nothing will catch for you.**

## The shape

Every non-trivial component is a folder, not a lone `.tsx`:

```
<Name>/
  <Name>.tsx        the component
  index.ts          the barrel — the ONLY import path other code may use
  styles.ts         `export const s` of CSSProperties objects
  helpers.ts        pure functions, private to this unit
  constants.ts      values private to this unit
  <Name>.test.tsx   colocated test
```

`helpers.ts` and `constants.ts` are **unit-private by construction**: the barrel exports
the component, so nothing outside the folder can reach them without a deep import that
the convention forbids. That property is what decides the next question.

## Rule 1 — the folder's depth is decided by who renders it

Routes nest, so `_components/` nests with them. There are two levels under the PR area:

```
pulls/_components/            reachable from the list AND from the detail page
pulls/[number]/_components/   reachable ONLY from the detail page
```

A unit used by both pages must sit in the **higher** one. Put it in
`pulls/[number]/_components/` and the list can only reach it by importing *upward across a
route boundary* — which works, and is exactly the import that makes a route subtree stop
being self-contained.

Worked example, both from the severity feature:

| Unit | Rendered by | Lives in |
|---|---|---|
| `SeverityCounters/` | the list's FINDINGS column, a detail-page timeline row, a run-accordion header | `pulls/_components/` |
| `SeverityFilter/` | the Agent-runs tab only | `pulls/[number]/_components/` |

A unit that belongs to no single page also needs **its own `styles.ts`** rather than
borrowing the page-level `pulls/styles.ts` that its siblings (`PRRow`, `FilterBar`) use —
that file is the list page's, and a shared unit reading from it inherits a page it does
not belong to. `SeverityCounters/styles.ts` and `RunCostBadge/styles.ts` are both this
case.

The same rule one level up, for code rather than components: a formatter that **more than
one route subtree** needs goes in `src/lib/`, not in a unit's `helpers.ts` — the private
file cannot be shared. `src/lib/severity.ts` exists for exactly that reason (the list
column and the detail page's filter both need it), alongside `src/lib/format.ts`.

Recorded as it was found in [`../INSIGHTS.md`](../INSIGHTS.md), **2026-08-02** (Codebase
Patterns) — two entries, one for the placement rule and one for `src/lib/`.

## Rule 2 — adding a list column is a three-place edit, and nothing checks it

The PR-list table is a CSS grid, and three separate declarations have to agree on the
column count:

| Declaration | File | Today |
|---|---|---|
| `GRID` track list | `src/app/repos/[repoId]/pulls/constants.ts` | 8 tracks |
| `COLUMN_KEYS` | same file | 8 keys |
| top-level cells `PRRow` returns | `_components/PRRow/PRRow.tsx` | 8 `<div>`s |

Nothing in the type system ties them together and a mismatch **does not error** — it
silently shifts every column after the offending one, which reads as a CSS bug and is not
one.

So a new column means exactly four edits:

1. a track in `GRID`,
2. a key in `COLUMN_KEYS`,
3. a cell in `PRRow`,
4. the `list.columns.<key>` string in `messages/en/prReview.json`.

`pulls/styles.ts` and `page.tsx` need **no** edit: `s.row` / `s.headRow` read `GRID`, and
the header maps `COLUMN_KEYS`.

One sharp edge: `s.headCell(alignRight)` models only *"is this the last column"*. Right-
aligning a **middle** column needs a signature change, not a new argument value.

Recorded in [`../INSIGHTS.md`](../INSIGHTS.md), **2026-08-02** (Codebase Patterns).

## Checklist for a new unit

- [ ] Folder, not a lone `.tsx`; imported through `index.ts` everywhere.
- [ ] Placed at the shallowest route level that can reach it (Rule 1).
- [ ] Its own `styles.ts` if it is shared across pages.
- [ ] Anything a second route subtree needs is in `src/lib/`, not `helpers.ts`.
- [ ] No `fetch` in the component — a hook in `src/lib/hooks/*` (see `CLAUDE.md`).
- [ ] Strings in `messages/en/<namespace>.json`, not inline.
- [ ] If it adds a list column: all four places from Rule 2.
- [ ] A `vitest.config.ts` alias too, if you added a tsconfig path alias (see `CLAUDE.md`).
