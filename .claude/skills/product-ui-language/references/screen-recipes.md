# Screen recipes

Five shapes cover most of what this product has built so far. Each recipe is the layout, the
numbers, and the part that was got wrong the first time.

These are descriptions of existing screens, not a template you owe anything to. A screen the
recipes do not fit is a normal thing to build — the useful part of the file then is the traps,
which are about the framework rather than about the layout.

Numbers are transcribed from shipped screens, not invented. Where two products differ the range
is given, and the range is the tolerance.

---

## 1. List screen (the workhorse)

```
┌─ page ────────────────────────────────────────────────────────┐
│  Title 24/700                            [ actions, right ]   │  padding 24px 32px 10px
│  subtitle 14 secondary                                        │
│                                                               │
│  ┌─ table card ──────────────────────────────────────────┐    │  margin 14px 32px 44px
│  │ [chip][chip][chip]        [search 240]  [select] [btn] │    │  filterBar 16px 20px
│  ├───────────────────────────────────────────────────────┤    │
│  │ COLUMN  COLUMN  COLUMN                        COLUMN  │    │  headRow 10px 20px, bg-surface
│  ├───────────────────────────────────────────────────────┤    │
│  │ row                                                   │    │  row 12px 20px
│  │ row                                                   │    │
│  └───────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

```ts
pageHeader:  { padding: "24px 32px 10px", display: "flex", alignItems: "flex-end", gap: 16 }
pageTitle:   { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }
pageSubtitle:{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }
headerActions:{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }

tableCard:   { margin: "14px 32px 44px", border: "1px solid var(--border)",
               borderRadius: 10, overflow: "hidden", background: "var(--bg-elevated)" }
filterBar:   { display: "flex", alignItems: "center", gap: 12,
               padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }
headRow:     { display: "grid", gridTemplateColumns: GRID, gap: 14, padding: "10px 20px",
               background: "var(--bg-surface)", borderBottom: "1px solid var(--border)",
               fontSize: 12, fontWeight: 700, letterSpacing: "0.06em",
               textTransform: "uppercase", color: "var(--text-muted)" }
row: (hover) => ({ display: "grid", gridTemplateColumns: GRID, gap: 14, alignItems: "center",
               padding: "12px 20px", borderBottom: "1px solid var(--border)", cursor: "pointer",
               background: hover ? "var(--bg-surface)" : "transparent", transition: "background .1s" })
```

Decisions worth keeping:

- **The toolbar lives inside the card, above the column headings.** Filters floating above a
  separate table read as two objects; inside, it reads as one block that happens to be
  filterable.
- **One grid template, two consumers.** `GRID` is declared once in `constants.ts` and read by
  both `headRow` and `row`, so they cannot drift. Track counts are hand-synced with the cells
  the row component emits — see the trap below.
- **Filter, search and sort client-side over the whole list** when the list fits in one
  response. Then the counts in the page header stay counts of *everything*, and pressing a
  chip is instant.
- **Row title goes `--accent-text` on hover**, the row background goes `--bg-surface`. Two
  signals, one hover.
- `overflow: "hidden"` on the table card is what clips the rows to its radius — and it also
  clips any absolutely-positioned popover a row tries to open. A hover card or menu anchored
  to a row must be `position: fixed` off `getBoundingClientRect()`.

### The column-count trap

Three declarations must agree and nothing enforces it: the track list in `GRID`, the column
key/label array, and the number of top-level cells the row component returns. A mismatch does
not error — every column after the offending one shifts, which looks like a CSS bug and is
not. Adding a column is that triple plus the column's label string.

### The control-height trap

A row of kit controls sits at three different natural heights (a chip ~28px, a small button
~27px, a text input ~42px), so the toolbar visibly steps. The primitives take no `style` or
`className`, and restyling them would reach every other screen. So the height is imposed from
**outside**, by a wrapper:

```ts
export const CONTROL_HEIGHT = 40;   // ≈ the tallest control, not the shortest
control:       { display: "grid", gridTemplateRows: `${CONTROL_HEIGHT}px` }
searchControl: { display: "grid", gridTemplateRows: `${CONTROL_HEIGHT}px`, width: 240 }
```

Both details are load-bearing:

- `display: grid`, **not** flex — a lone grid item stretches on *both* axes, so the control
  fills the wrapper's width too. A flex wrapper stretches it vertically and leaves it at
  content width, which silently collapses a 240px search box to the width of its placeholder.
- `gridTemplateRows`, **not** `height` — a track is what the child's border and padding are
  absorbed into (`box-sizing: border-box` is global). `height` sizes the wrapper and lets a
  taller child overflow it.

Search box widths in use: 200–240. Pick one per screen and keep it.

---

## 2. Detail screen (sticky header + tabs)

```
┌─ sticky header ───────────────────────────────────────────────┐  sticky top 0, z 5
│  Title 22/700   #id 18 muted             [ actions ]          │  padding 18px 32px 0
│  author · branch · meta 13 secondary                          │
│  [ Tab ][ Tab ][ Tab ]                                        │  Tabs pad "0 28px"
├───────────────────────────────────────────────────────────────┤
│         ┌─ tab column, maxWidth 1080, centred ─┐              │  padding 24px 32px 44px
│         │  SECTION LABEL                       │              │  gap 24
│         │  ┌ card ┐  ┌ card ┐                  │              │
└───────────────────────────────────────────────────────────────┘
```

```ts
root:      { position: "sticky", top: 0, zIndex: 5, background: "var(--bg-primary)",
             borderBottom: "1px solid var(--border)", padding: "18px 32px 0" }
h1:        { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
             display: "flex", alignItems: "center", gap: 12 }
idBeside:  { fontSize: 18, color: "var(--text-muted)", fontWeight: 500 }
meta:      { display: "flex", alignItems: "center", gap: 14, marginTop: 10, marginBottom: 14,
             fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap" }
tabColumn: { padding: "24px 32px 44px", display: "flex", flexDirection: "column",
             gap: 24, maxWidth: 1080, margin: "0 auto" }
loading:   { padding: "28px 32px", display: "flex", flexDirection: "column",
             gap: 16, maxWidth: 1080, margin: "0 auto" }
```

- **The header and the tab strip run the full page width; only the tab *content* is a capped
  centred column.** A wide window widens the margins, never the cards.
- **Facts, not a form.** The header carries an uppercase 10px label over a 14px value, laid
  out with `flexWrap` and `gap: 26`. Mono for the values that are identifiers.
- **A banner belongs under the meta line**, inside the sticky header, at 12.5px `--text-muted`
  — so "this is stale / closed / read-only" travels with the title while scrolling.

### The sticky-offset trap

If anything on the screen scrolls a row into view (`scrollIntoView`, `scrollMarginTop`), a
constant offset is not fixable by choosing a bigger number: the sticky header's height changes
with its own content (a banner adds ~28px, the meta line wraps at narrow widths), and the
scroll container is an inner `<main>`, not the window. Measure it — a `ResizeObserver` on a
`[data-sticky-header]` attribute writing the height into a CSS custom property, with a literal
fallback for SSR, first paint and jsdom:

```ts
scrollMarginTop: "var(--sticky-h, 148px)"
```

Two follow-ons: closing a popover on scroll needs a **capture-phase** listener, because
`scroll` on an inner element does not bubble to `window`; and a popover that flips above its
trigger should anchor its `bottom` to the trigger's top rather than computing a `top`, or it
lands over the app header on a short viewport.

---

## 3. Card grid (entities you browse, not compare)

```ts
page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" }   // 1100–1140
grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }
card: { padding: 14, borderRadius: 8, border: "1px solid var(--border)",
        background: "var(--bg-elevated)", cursor: "pointer" }
cardActive: { borderColor: "var(--border-strong)", background: "var(--bg-hover)" }
cardOff:    { opacity: 0.55 }                       // disabled, dimmed — not hidden
iconBox: { width: 26, height: 26, borderRadius: 7, background: "var(--accent-bg)",
           color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }
```

`minmax` 280–320 depending on how much each card says. Table when rows are compared on shared
columns; grid when each entity is read on its own.

- **The whole card is the link**, and the one or two controls that do not need the detail page
  (a toggle, a delete) sit on the card and `stopPropagation()`.
- **Dim a disabled entity rather than hiding it** — "we turned that one off" is something a
  list should be able to say.
- **The accent-tinted icon box is the product's signature** for "this is a thing of type X":
  26×26, radius 6–7, `--accent-bg` behind an `--accent` glyph at 15px.
- Metric pairs on a card read value-over-label: value 15–17 (mono when it is a count), label 10
  uppercase muted at `letterSpacing: 0.5`.

---

## 4. Modal, drawer, wizard

The kit already carries the chrome; the recipe is which one to reach for.

| Shape | Reach for it when | Numbers it already has |
|---|---|---|
| `Modal` | one decision, taken and dismissed | width 720, radius 14, `--border-strong`, `--shadow-modal`, header `18px 24px`, footer `16px 24px` on `--bg-surface`, `maxHeight: 92%`, `ddpop .18s` |
| `Drawer` | inspecting a thing without leaving the list | width 720 / `maxWidth: 94%`, `--bg-surface`, left hairline, body padding 24, footer on `--bg-primary`, `ddslidein .2s` |
| Full page | multi-step work with its own URL | page inset, no overlay |

- **A wizard is steps in a modal only while it is short.** Once a step needs a table or a
  diff, it is a page — an overlay you cannot deep-link to is a dead end.
- Overlay scrim is `rgba(0,0,0,.5)` for a modal, `.45` for a drawer, with `ddfadein .15s`.
- Form rows inside come from `FormField`: `marginBottom: 20`, label 13/600 `--text-secondary`,
  hint 12 `--text-muted` at `marginTop: 8`. Required marks with a `--crit` asterisk.
- The footer holds the actions, primary on the right, and the primary button carries the
  `loading` state — never a spinner replacing the whole footer.

---

## 5. Settings / editor screens

- **The page is wide, the form column is not.** A settings page sits in the usual page inset,
  but each group of fields is capped at ~640 (`wrap: { maxWidth: 640 }`) — a text input
  stretched to 1200px is unusable. The 1280 column belongs to screens whose content is *code or
  evidence blocks*, where the cap exists to bound line length, and those pages widen their
  inset with it (`padding: "28px clamp(32px, 6vw, 112px)"`).
- Group with `SectionLabel` (uppercase 12/700, `0.07em`, `marginBottom: 14`) rather than boxes
  inside boxes: one card per group, labels between cards.
- A row of "label — control — hint" is `FormField`; a row of "label — value — toggle" is a flex
  row with `marginLeft: "auto"` on the control. Both, not one made to do the other's job.
- **Immediate-write controls (a toggle) and deferred-write controls (a text field with Save) in
  one group need something that says which is which** — the toggle has already saved and the
  field has not, and nothing on screen distinguishes them by default.
- Code and JSON go in a `<pre>` on `--bg-primary` (the recess below the card's
  `--bg-elevated`), 11–12px mono, `maxHeight` ~360 with `overflow: auto`,
  `whiteSpace: "pre-wrap"`, `overflowWrap: "anywhere"`.

---

## Things easy to forget

Not a gate — a list of what tends to be missed on a first pass, roughly in the order it usually
gets noticed by someone else:

- The page supplies its own inset; the shell's `<main>` has none, so a screen with no padding
  sits flush against the sidebar.
- All three data states, with skeletons shaped like the real content.
- Status carrying an icon or dot **as well as** its colour.
- `tnum` on numbers that sit in a column, `mono` on identifiers.
- Colours as token roles rather than hexes, so the other theme keeps working.
- Toolbar controls at one height.
- A hover state on anything clickable, and `:focus-visible` left alone.
- Grid tracks, column labels and emitted cells agreeing.
- A comment where a number departs from the default — the number itself is fine; the silence is
  what costs the next person time.
