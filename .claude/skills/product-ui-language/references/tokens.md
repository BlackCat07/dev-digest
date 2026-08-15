# Tokens — roles, mechanics, traps

Tokens are CSS custom properties on `:root`, swapped by a `data-theme` attribute on `<html>`.
Features name a role; nothing in a feature names a colour. The values live in one stylesheet
(`references/project-map.md` names it for this project). Copies of this skill aimed at a product
that has no design system yet also ship that layer as `assets/tokens.css`.

## Surfaces

| Token | Is | Use for | Reads wrong as |
|---|---|---|---|
| `--bg-primary` | the app floor | page background, sticky header background, the recess under a card (`<pre>`, code blocks), drawer footer | a card — one painted on the floor stops looking raised |
| `--bg-surface` | recessed panel | sidebar, table head row, modal footer, `Kbd`, the topbar's search box, **row hover** | a card body; a modal body |
| `--bg-elevated` | raised panel | cards, table cards, inputs, modal body, dropdown panels | the page; a hover state |
| `--bg-hover` | interaction | card hover, progress track, inline `code` background, active icon button | a resting surface — a card that starts here has nowhere to hover to |

There is no fifth step and no shadow-based elevation in the system today. A thing that has to
sit above a card takes `--border-strong` and one of the two shadow tokens — at which point it is
a modal or a drawer.

## Hairlines

| Token | Use for |
|---|---|
| `--border` | every divider and every card edge: row separators, section rules, card and table-card borders |
| `--border-strong` | edges of things you type into or that float: inputs, secondary buttons, modal and drawer edges, `Kbd`, scrollbar thumb |

A border is this product's only depth cue, so `border: "1px solid var(--border)"` appears more
often than any other declaration. That is correct, not repetition to factor out.

## Text

| Token | Use for |
|---|---|
| `--text-primary` | content: titles, values, row titles, the answer |
| `--text-secondary` | supporting prose: subtitles, meta lines, descriptions, form labels |
| `--text-muted` | labels and chrome: column headings, section labels, timestamps, counts, placeholder, disabled |

Three levels cover it. When something wants to recede further than muted, what it usually wants
is less prominence — smaller, or moved — rather than another grey.

## Brand

| Token | Use for |
|---|---|
| `--accent` | primary button background, active tab underline, focus ring, icon inside a tinted box, selected chip border |
| `--accent-hover` | the primary button's hover only |
| `--accent-bg` | 12%-alpha tint behind an icon box, an active chip, `::selection` |
| `--accent-text` | text and links on a dark surface — the lighter tint that stays legible where `--accent` would not |

`--accent` on text at 13px over `--bg-elevated` is the most common contrast failure in this
palette. That is what `--accent-text` exists for.

## Domain semantics — the four slots you rename

Shipped as `--crit` / `--warn` / `--sugg` / `--info`, each with a 12%-alpha `-bg` companion.
Read them as four roles:

| Slot | Role | Typical colour family |
|---|---|---|
| `--crit` | act now, blocking | red |
| `--warn` | look soon, degraded | amber |
| `--sugg` | optional, informational-positive | blue |
| `--info` | neutral context | grey |

A second product maps its own vocabulary onto the same four and keeps the count at four —
five semantic colours stop reading as a scale, and a reader cannot rank them. In one product
these carry review-finding severities; in another the same four carry case statuses
(`needs_review` → warn, `running` → accent, `stale` → sugg, `ready` → ok). Note that mapping
reaches for `--accent` and `--ok` too: **lifecycle and severity are different axes**, and it
is fine for a status set to draw from both.

## Lifecycle

`--ok`, `--pending`, `--failed`, `--stale` — the state of a job or a run, not the severity of
its findings. Also `--code-add` / `--code-del` and their `-text` variants for diffs, and
`--code-bg` for a code recess.

## Mechanics

- **Theming.** `:root` holds dark (it is also the `[data-theme="dark"]` block);
  `[data-theme="light"]` redefines the same names. A theme switch is one attribute on `<html>`
  and no React re-render. Both blocks must define **every** token — a token defined in only
  one theme silently vanishes in the other (see the trap below).
- **Density.** `[data-density="compact|regular|comfy"]` sets `--row-pad`, `--card-pad`, `--gap`
  (6/12/8, 9/16/12, 13/22/16). `:root` also sets `--card-pad: 16` so a page with no density
  attribute still works. Read `var(--card-pad)` in card padding rather than a literal 16.
- **Type.** Body is 15/1.5 with `letterSpacing: -0.006em`; `.mono` switches to the mono family
  with `font-feature-settings: "calt" 1, "zero" 1` (slashed zero — it matters in hashes);
  `.tnum` is `font-variant-numeric: tabular-nums`.
- **Focus.** `:focus-visible` gets a 2px `--accent` outline at 1px offset. Never remove it,
  never replace it with a background change only.
- **Loading shimmer.** `.skeleton` is a gradient across `--bg-elevated` → `--bg-hover` on a
  1.4s `ddshimmer` loop, radius 4. The `Skeleton` primitive is just a `div` with that class.
- **Motion.** Keyframes ship for spin, pulse, fade-in, pop, slide-in, shimmer, and
  `@media (prefers-reduced-motion: reduce)` already flattens every animation and transition to
  0.01ms. A new animation inherits that for free; a JS-driven one does not — check the media
  query yourself if you animate in JS.

## Traps

- **An invented token name fails silently.** `var(--bg)` does not exist; an unknown custom
  property is not a CSS error, so the declaration simply drops and the element stays
  transparent — rendering content on whatever surface is behind it. Nothing fails: typecheck,
  lint and tests are all green and the only symptom is "it doesn't look like the design". Name
  the real token (`--bg-primary`), never a shorter alias you assume exists. Sibling case that
  cost more: `var(--text-tertiary)` instead of `--text-muted` across nine reviewed and shipped
  files — `color` fell back to inherited, so every date and hint rendered at *full* contrast
  instead of dimmed.

  **This is the one styling mistake that is mechanically detectable, so check it mechanically.**
  A ~40-line test that collects every `--token:` declared in the stylesheet and every
  `var(--token)` written in the project's own source, then asserts the second set is a subset of
  the first, catches the whole class. Keep its scope to your own code — a vendored kit is not
  yours to correct. One product has this as `src/test/tokens.test.ts`; it found a real bug the
  moment it was written. Worth adding on day one of a new product.
- **A hex in a feature file.** Even a correct-looking one breaks the other theme, because it
  cannot switch. The two exemptions are a root error boundary that replaces the layout (and so
  has no stylesheet) and the avatar hue palette, which is deliberately theme-independent.
- **Colour as the only carrier.** The one recommendation in this skill worth treating as firm —
  see `SKILL.md`.
- **Editing the design system to suit one screen.** A primitive is shared by every screen and a
  token by every primitive, so the change lands on screens nobody re-checked. Imposing what you
  need from outside (a wrapper, a `styles.ts`) or adding a new file beside the primitive costs
  about the same and stays local.
- **A token defined in only one theme.** Both `:root` and `[data-theme="light"]` list the same
  names. Adding a token to one and not the other gives you a screen that looks right until
  someone toggles the theme.
