---
name: product-ui-language
description: "Reference for the visual language of a dark, function-first, data-dense product UI — which token carries which role, the spacing and type rhythm, and how the existing list / detail / grid / modal screens are put together. Use when adding or reviewing a screen, panel, table, card, filter bar, badge or empty/loading/error state, when a new screen should feel like it belongs beside the existing ones, or when carrying this look into a second product. A helper, not a gate: it offers the defaults with the reason behind each number, and a different choice is a normal outcome. Does not cover React correctness (react-best-practices), Next.js rules (next-best-practices) or where a file goes (frontend-ui-architecture)."
version: 1.1.0
---

# Product UI language

What makes a new screen feel like it belongs beside the existing ones: the roles the tokens
carry, the spacing rhythm, and how the screens already built are put together.

## How to use this

- **This is a reference, not a review gate.** It reports what the existing screens do and why.
  Nothing here has to be obeyed, and a screen that departs from it is not broken.
- **Trying a different component or layout? Take the small part.** The token roles and the
  spacing rhythm are what actually carry the family resemblance — a new interaction pattern,
  a new card shape or a borrowed component can sit comfortably on top of those two things.
  Skip the recipes; they are for the shapes that already exist.
- **Every number comes with its reason**, so you can move it deliberately. When you do, a line
  in a comment where the number lives is enough — that is how the next screen knows it was a
  choice.
- Two things are worth not breaking *silently*, because the cost lands somewhere else:
  restyling the shared design system (it reaches every other screen), and letting colour alone
  carry a status (it disappears for a good share of readers). Both are still your call — just
  not by accident.
- `references/project-map.md` names this project's alias, folder layout and checks. Read it
  when the answer depends on the project rather than on the look.

## The look, in five lines

1. **Four flat surface steps, no elevation:** `--bg-primary` (app) → `--bg-surface` (sidebar,
   table head) → `--bg-elevated` (cards, inputs) → `--bg-hover`. Depth is a 1px `--border`.
   Shadows belong to modals and drawers only.
2. **Hard, small radii:** 4–7 for controls and badges, 8–10 for cards, 14 for a modal, `99px`
   for pills and dots.
3. **Uppercase micro-caps label; they never speak.** Column headings, section labels, fact
   labels: 10–12px, weight 700, `letterSpacing: 0.06–0.07em`, `--text-muted`. Content is never
   uppercase.
4. **Mono for identifiers and compared numbers** — ids, branches, paths, versions, costs.
   `className="mono"` for the family, `className="tnum"` so digit columns line up.
5. **Three text levels:** `--text-primary` content, `--text-secondary` supporting prose,
   `--text-muted` labels and meta. A fourth grey usually means the thing wants to be smaller or
   moved rather than dimmer.

## Tokens: name a role, never a value

Values live in one stylesheet; a feature names a role. Four surface steps, two hairlines
(`--border`, `--border-strong`), three text levels, four accent tokens (`--accent`,
`-hover`, `-bg`, `-text` — the last one for accent *text*, which is where contrast usually
fails), four domain-semantic slots, and a lifecycle set (`--ok`, `--pending`, `--failed`,
`--stale`).

**The four semantic slots are the ones a second product renames.** They ship as
`--crit` / `--warn` / `--sugg` / `--info` (each with a 12%-alpha `-bg`), but they are four
*roles*: act now, look soon, optional, neutral context. Map your own vocabulary onto them and
four is a good number to stop at — five stop reading as a scale.

Full table, theme and density mechanics, and the traps: `references/tokens.md`.

## Spacing rhythm

| Thing | Value |
|---|---|
| Page inset | `24px 32px` top/sides, `44px` bottom — the shell's `<main>` has no padding, so each page supplies its own |
| Centred column | 1080 detail · 1100–1140 card grids · 1280 code/evidence · ~640 a form column |
| Card padding | `var(--card-pad)` (16 at regular density) rather than a literal |
| Row-shaped things | `12px 20px` rows, `10px 20px` head — the 20 is the shared horizontal rhythm |
| Gaps | 8 inside a control · 10–12 between controls · 14 grids and row cells · 20–24 between sections |
| Titles | page 24/700/`-0.02em` · detail 22 with its id 18 muted beside it · subtitle 14 secondary |
| Transitions | `.1s` row hover · `.12s` controls · `.15s` overlays · `.4–.6s` progress |

Motion presets already exist (`ddspin`, `ddpulse`, `ddfadein`, `ddpop`, `ddslidein`,
`ddshimmer`) and `prefers-reduced-motion` is already handled for CSS animations.

## The three data states

A fetching screen has three outcomes, and shipping one of them is the usual reason a screen
feels unfinished:

- **Loading** — skeletons shaped like what is coming (rows in a table, cards in a grid), so
  nothing jumps when data lands.
- **Empty** — one sentence saying why it is empty, plus a CTA only if there is a real action.
- **Error** — full-screen when the API is unreachable and nothing on the page can be trusted;
  inline, next to the thing that failed, for a single failed request. Branch on the error code,
  not the message.

## Status carries a word

Icon **plus** word, or dot **plus** word. A bare coloured pill is invisible to a good share of
readers and to every screen reader; `SeverityBadge` is built as icon + label for that reason.
Likewise `:focus-visible` already gets a 2px `--accent` ring — a control that swallows it is a
control the keyboard cannot reach.

## Where to look next

| File | For |
|---|---|
| `references/screen-recipes.md` | how the list / detail / card-grid / modal screens are built, with their numbers and the two traps that cost real time |
| `references/tokens.md` | every token's role, theme + density mechanics, and the silent-failure traps |
| `references/primitives-map.md` | what the kit deliberately does not do, and the cheapest ways to extend it |
| `references/wireframe.md` | sketching a screen in ASCII before building it |
| `references/project-map.md` | this project's alias, layout, checks, precedence |
| `assets/tokens.css` | the token layer to start a *new* product from — shipped only in copies of this skill that need it, so a project with the design system already in place will not have it |
