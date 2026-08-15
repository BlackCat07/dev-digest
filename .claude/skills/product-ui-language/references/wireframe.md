# Sketch the screen before writing it

For anything larger than one card, draw it first. A sketch costs a minute, is reviewable by a
human who does not read `styles.ts`, and settles the arguments (what is the default state? where
does the count live? what happens with no data?) before they are encoded in JSX.

**Plain ASCII in a fenced block, not a diagram library.** It renders in every terminal, diff
and review tool, edits in place, and never becomes a build step. Do not reach for Mermaid here
— a screen layout is a box drawing, not a graph, and Mermaid draws it badly.

## The format

One box per region, sized roughly to its real proportion. Annotate the right margin with the
numbers that matter (padding, widths, token). Zone names in `[brackets]`, real copy in plain
text, repeats as `…`.

```
┌─ /batches ─────────────────────────────────────── AppShell ─┐
│ Batches                              [+ New run]   24/32/10 │
│ 10 folders · 214 alerts · 3 stale                           │
│ ┌───────────────────────────────────────────────────────┐   │ card 14/32/44
│ │ [all][training][holdout]      [search 240] [sort ▾]   │   │ toolbar 16/20
│ ├───────────────────────────────────────────────────────┤   │
│ │ BATCH        ALERTS  RUNS  ROLE      COST    UPDATED  │   │ head 10/20, bg-surface
│ ├───────────────────────────────────────────────────────┤   │
│ │ 2026-07-01     22     2   [training] $1.84   2d ago   │   │ row 12/20
│ │ …                                                     │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

empty   → EmptyState "No batches imported yet." + [Import]
loading → 5 row skeletons inside the card, toolbar live
error   → API unreachable = full screen; one failed folder = inline on its row
```

Three sketches usually suffice: the list, the detail, and whatever is new about this feature.
Tabs get one sketch per tab only if the tabs differ structurally. A sketch is a thinking tool —
if drawing it is slower than trying the thing in code, skip it and sketch afterwards.

## Worth having on the sketch

- [ ] **Title and the line under it** — the subtitle is a line of counts, and the counts are
      decided here (of everything, or of the filter?).
- [ ] **Where the toolbar sits**, and every control in it, in order.
- [ ] **What is inside the card** versus loose on the page.
- [ ] **Column names, in display order** — this is the list that must match the grid tracks.
- [ ] **Which control is right-aligned** (`marginLeft: "auto"` territory).
- [ ] **The default state** — which tab, which filter, which sort, on first load.
- [ ] **All three data states**, as the three lines under the box.
- [ ] **What is read-only.** If a screen deliberately cannot act, say so on the sketch — an
      absent button is invisible in a review, a noted one is a decision.
- [ ] **Where navigation goes** — what a row click opens, and what the breadcrumb becomes.

## What does not belong on it

Colours, fonts, exact pixel values inside the boxes, and hover states. Those come from the
token roles and the recipes; putting them on a sketch invites re-deciding what is already
decided.

## Reviewing a sketch

Three questions, in order:

1. **Does the screen answer one question?** A screen that answers two wants to be two screens
   or two tabs. Name the question out loud — if the name needs an "and", split it.
2. **Where does each number come from?** Most will match an existing screen. One that does not
   is fine — it just wants a sentence saying what it is doing differently.
3. **What is the empty case?** A brand-new screen ships empty for every reader on day one, so
   the empty state is the *first* impression, not an edge case.
