# Primitives — the non-obvious half

The barrel and the `/showcase` route already tell you *what exists*: read them for the full
list of components and props. This file covers what neither of those shows — the shapes that
carry the look, the limits that read like bugs, and the cheapest ways to add something.

## What the kit already decides for you

Reach for these rather than rebuilding them, because their proportions are part of the look:

- **`Button`** — five kinds: `primary` (accent), `secondary` (elevated + strong border, the
  default), `tertiary` (transparent, for toolbars), `ghost`, `danger` (crit text, tint on
  hover). Sizes sm/md/lg = `5px 9px` / `7px 13px` / `10px 18px` at 12.5 / 13 / 14px, radius 6.
  `loading` swaps the icon for a spinner and disables.
- **`IconBtn`** — 30px box, glyph at 52%. Its `label` becomes both `title` and `aria-label`.
- **`Chip`** — `5px 12px`, radius 6; active = accent border + `--accent-bg` + `--accent-text`.
  The filter-row primitive.
- **`Badge`** — `2px 10px`, radius 5, 12/600. `dot` for lifecycle, `mono` for identifiers.
  Pass `color` + `bg` as a token pair (`var(--warn)` / `var(--warn-bg)`).
- **`SeverityBadge`** — icon + label + optional count, uppercase `0.04em`. `compact` drops the
  label, so use it only where a legend sits next to it.
- **`SectionLabel`** — the uppercase 12/700 `0.07em` group heading, `marginBottom: 14`, with an
  optional `right` slot. Grouping with labels between cards beats boxes inside boxes.
- **`Card`** — `--bg-elevated`, `--border`, radius 8, `var(--card-pad)`; `pad={false}` when the
  card holds its own rows.
- **`EmptyState` / `ErrorState` / `Skeleton`** — the three data states. `ErrorState` takes
  `fullScreen` (60vh) and `onRetry`, and already carries `role="alert"`.
- **`Tabs`** — 2px accent underline sitting on the divider via `marginBottom: -1`.
- **`Modal` (720, radius 14) / `Drawer` (720, slides in)** — the only two things with shadows.
- **`FormField`** — label 13/600 secondary over the control, hint 12 muted below,
  `marginBottom: 20`, crit asterisk when `required`.
- Numbers with an opinion: **`CircularScore`** (44px ring, colour steps at 75 and 50),
  **`ConfidenceNum`** (steps at 85 / 65), **`PercentProgress`** (a number beats a spinner
  whenever the work is measurable), **`ProgressBar`** (height 6).
- Small change: **`MonoLink`** (`href` gives a real anchor, so middle-click works), **`Kbd`**,
  **`Avatar`** (deterministic hue from the name), **`Toggle`** (`role="switch"` already set),
  **`CategoryTag`**.
- Charts: `Sparkline`, `LineChart`, `Donut`, `BarRow`, `MetricCard`. They need
  `ResizeObserver`, which jsdom lacks — a chart that fails only in tests wants the shim in the
  test setup, not a mock.

## Limits that look like bugs

- **`Markdown` is inline-only.** It maps `p`, `strong`, `code`, `a` and nothing else. A
  document-shaped body still emits real `<h2>`/`<ul>`/`<li>`, but unstyled they collapse into
  one block under the global reset — a four-section rubric renders as a wall of text. Teaching
  the primitive headings is the tempting fix and the wrong one: every existing caller is a
  one-paragraph rationale that would suddenly grow headings. Either the feature ships its own
  renderer, or a stylesheet scoped to the document container styles only the **block** elements
  (`h1`–`h4`, `ul`, `ol`, `li`, `table`, `blockquote`, `hr`, `pre`) — leave the four inline ones
  alone there, since an inline style beats a selector and the rule would do nothing. Such a
  stylesheet is worth a test that every block element the renderer can emit is mentioned in it;
  an unstyled `<table>` is a valid `<table>`, so nothing else catches it.
- **`Skeleton` has no role and no aria** — a bare `div.skeleton`, so a test can only assert a
  loading state through the class name. The cost of the shimmer being pure CSS.
- **`Dropdown` is `absolute` inside a `relative` wrapper**, so any ancestor with
  `overflow: hidden` clips it — which includes every table card. Inside a table, anchor with
  `position: fixed` off `getBoundingClientRect()`.
- **Most primitives take no `style` or `className`.** `TextInput` spreads `...rest` onto the
  inner `<input>`, not onto its box. Size and align them from a wrapper — see the
  control-height note in `screen-recipes.md`.
- **`Button`'s hover lives in component state**, not CSS, so a parent's `:hover` rule cannot
  reach it.

## Adding something the kit lacks

Cheapest first — each step costs more than the one above it:

1. **Compose** existing primitives inside a feature component.
2. **Impose from outside** — a wrapper that sizes, aligns or clips.
3. **A wrapper component in the feature layer** that owns the difference, named for what it is
   for rather than for what it wraps.
4. **A new file in the design system**, exported from the barrel and added to the showcase.
   Extend by new file rather than reshaping an existing symbol.

The one shape worth avoiding: a local copy of a kit component with a tweak. It works today,
and from then on there are two of them and only one gets fixed. Editing the shared primitive in
place has the same problem pointed the other way — the tweak reaches every screen that uses it,
including the ones nobody re-checked.

Borrowing a component from outside the kit (a headless library, a chart, a date picker) is a
normal thing to do. It stops looking foreign as soon as it takes its colours from the token
roles, its radius from the 4–10 range and its control height from the row it sits in — those
three, and not much else, are what make it read as part of the set.
