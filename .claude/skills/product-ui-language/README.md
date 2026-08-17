# product-ui-language — rationale

## Why this skill exists

A vendored design system carries the *parts*: `Card`, `Button`, `SeverityBadge`, a stylesheet
of tokens. It does not carry the *composition* — that a list screen is a page header inset
24/32 above one bordered card holding its own toolbar, that the toolbar imposes a single
40px control height from outside because the primitives take no `style`, that the filter bar
belongs inside the card rather than floating above it. Copy the system into a second product
and you get components that match and screens that do not.

Before this skill, those numbers existed in exactly two places: the shipped `styles.ts` files,
and prose comments inside them. A comment in `pulls/styles.ts` is found by whoever is already
editing that file — never by an agent building a brand-new screen in another folder, or another
repository. This skill is that knowledge lifted out and made portable.

It is deliberately **soft**. Each number is given with the reason it is that number, so a
screen with a genuine need can change it and say why. The one hard line is that status is never
carried by colour alone, because that is an accessibility floor rather than a house style.

## Where the content came from

Nothing here is invented; every number was transcribed from a shipped screen and cross-checked
against a second implementation of the same look. Paths below are the **reference project's**
(`dev-digest/client/`); a copy of this skill in another repo will not have them — see
`references/project-map.md` for that repo's equivalents.

| Section | Read from |
|---|---|
| Token roles, theming, density, motion | `client/src/vendor/ui/styles.css` |
| List screen, the column-count and control-height traps | `client/src/app/repos/[repoId]/pulls/{styles.ts,constants.ts}` and the same screen re-built in a second product |
| Detail screen, sticky offset | `.../pulls/[number]/_components/{PrDetailHeader,PrDetailView}/styles.ts` |
| Card grid | `client/src/app/agents/_components/{AgentsListView,AgentCard}/` |
| Primitive shapes and limits | `client/src/vendor/ui/{primitives,kit,charts}/` |
| The traps that cost real time | `client/INSIGHTS.md` (entries dated 2026-08-03 … 2026-08-12) |

The `styles.css` in both products is byte-identical, which is what made a "same look, different
domain" skill worth writing rather than a full design-system port.

## Companion skills — and precedence

This skill owns tokens, spacing, layout and composition. It does not own React correctness,
Next.js rules, file placement, or accessibility auditing. Worth having alongside:

**None of this installs itself.** A skill's frontmatter has no dependency field, and a skill body
is text — it cannot install anything. The commands below are for a human to run once per machine
or per repo. Two consequences worth knowing:

- A skill that is **not** installed in the project cannot be invoked, so a reference to it here or
  in `project-map.md` is inert — and worse, an agent may *say* it consulted one it never had.
  Treat the precedence list in `project-map.md` as conditional on the skill actually being there.
- What *can* be automatic: an installed skill is reachable via the `Skill` tool (a skill that
  routes to others declares `allowed-tools: … Skill`, as `pr-self-review` does), and a **subagent**
  definition can pull skill bodies in with a `skills:` frontmatter list — `agents/implementer.md`
  loads eleven that way. Adding this skill to the UI-touching agents' lists is the one change that
  makes it load without anybody asking; it costs those agents ~1.6k tokens each, and needs a full
  CLI restart to take effect.

| Skill | Install (manual, once) | Role here |
|---|---|---|
| `frontend-ui-architecture` | copy the folder from whichever repo authors it | where a file goes, when a component splits. **Not portable as-is** — its references describe one specific folder layout. Rewrite them for the target repo (see `references/project-map.md`) or it teaches the wrong layout |
| `react-best-practices`, `next-best-practices` | already vendored in both repos | hooks, RSC boundaries, memoisation |
| `react-testing-library` | already vendored | component tests for the screens this skill produces |
| Vercel **web-design-guidelines** | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code` | audits UI code for keyboard support, form behaviour, animation and accessibility. The closest fit to a desktop web app of the ones surveyed |
| **AccessLint** | `claude plugin marketplace add accesslint/skills` | only if accessibility becomes a hard requirement — four a11y skills plus a contrast-analysis MCP server |
| **ui-ux-pro-max** | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` | reviewer only — see the caveats below |

### On `ui-ux-pro-max`

Popular (116k★), MIT, actively maintained, and genuinely substantial: its own `pro-rules.md`
is concrete and testable (hit areas ≥44pt/48dp, pressed feedback in 80–150ms, ≥4.5:1 body
contrast, light/dark parity, reduced-motion, screen-reader focus order matching visual order).

Two reasons it must not drive UI work in a product that already has a look:

1. **Its core is a generator.** It picks a style from 79, a palette from 192 and a font pairing
   from 74, then persists `design-system/<slug>/MASTER.md` as the source of truth. That is
   exactly the decision already made and vendored here — and its catalogue leans
   glassmorphism / neumorphism / claymorphism / bento, the opposite of this product's flat,
   hard-edged, function-first language. Never run it with `--persist`; never let a `MASTER.md`
   into a repo that has a `vendor/ui`.
2. **Its trigger is broad** — "designing, building, reviewing, or fixing interfaces" — so it
   activates on nearly every UI task and can out-talk the project skill. The precedence list in
   `references/project-map.md` exists for that.

Also note its rules are largely **mobile-first** (pt/dp, React Native, Expo), so for a dark,
desktop, data-dense web app roughly half applies. Consult it for accessibility, interaction
timing and chart questions; ignore its visual direction entirely.

## Maintaining this skill

- Numbers are facts about the code. If a screen changes an inset, change it here in the same
  commit or delete the row — a stale number is worse than a missing one.
- New content belongs in a `references/` file; `SKILL.md` stays short enough to be read every
  time it loads.
- `references/project-map.md` is the only file that differs between copies of this skill, so an
  improvement anywhere else travels by copying one file.
