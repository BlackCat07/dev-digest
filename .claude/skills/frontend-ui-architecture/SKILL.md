---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React and Next.js — where a file goes, when to split a component, and where logic, state, constants and types belong. Use when adding a component, hook, route or feature; when deciding where something lives or whether to promote it to shared; when a component, hook, folder or constants file has outgrown its place; when reviewing or refactoring structure, import boundaries, barrels or layering. Does not cover in-component React rules (see react-best-practices) or Next.js API-level rules (see next-best-practices)."
version: 1.0.0
---

# Frontend UI Architecture

Answers one question: **where does this code go, and when does it move?**

This skill decides. Where the industry disagrees, it picks one rule and says so — a project
needs one answer, not a survey. Rationale and sources: [README.md](README.md).

## Scope boundary — read this first

| Question | Skill |
|---|---|
| Where does this file go? When do I split it? Which layer owns this logic? | **this one** |
| Is this component pure? Is this `useEffect` misused? Should this be memoized? | `react-best-practices` |
| Which Next.js special file is this? Is this RSC pattern valid? Async `params`? | `next-best-practices` |

Do not restate rules from the other two. Link to them.

## The six laws

1. **Colocate by default.** A non-trivial component is a folder holding its own view,
   styles, private helpers, private constants and test. Files that change together live
   together.
2. **Promote on the second consumer, never in anticipation.** One caller means it stays
   private. A second caller moves it to the **nearest common ancestor** of the callers —
   never to the top just because the top is shared.
3. **Route files are thin.** A route entry wires: it picks a view, passes params, and
   returns. Domain logic, data access and layout decisions live in the units it composes.
4. **Dependencies point one way:** shared → feature → route/app. Sibling features never
   import each other; compose them one level up.
5. **A module is named for what it is.** `format.ts`, `severity.ts`, `pr-status.ts`. There
   is no `utils` bucket — a name that says "miscellaneous" guarantees the folder becomes
   miscellaneous.
6. **Split on a named symptom, never on a line count.** No file is split because it is
   long; it is split because something concrete hurts. The symptoms are enumerated in
   [references/decomposition.md](references/decomposition.md).

## Where does it go?

| Thing | Home |
|---|---|
| Component used by one view | private child of that view's folder |
| Component used by two views in one route subtree | the subtree's shared components folder |
| Component used by two route subtrees | the **shallowest** shared folder both can reach |
| Cross-screen primitive (button, card, chip) | the design-system module — extend with a new file, never restyle a primitive for one caller |
| Pure function used by one unit | that unit's private helpers file |
| Pure function used by two units | a **named** module in the shared library folder |
| Constant used by one unit | that unit's private constants file |
| Constant that encodes an invariant (grid tracks, column keys, enum order) | next to the code that must agree with it, never in a global constants file |
| App-wide config, env, feature flags | one config module; only it reads `process.env` |
| Component props type | the component file |
| Domain type used across one feature | that feature's types module |
| Contract shared with the backend | the single shared-contract module — no second copy |
| Data read/write | a hook or server function, never a component body |
| Business rule that needs no React | a plain module function |
| Server data | the query cache. Never mirrored into a store |
| UI state used by one subtree | local state in that subtree |
| UI state shared across screens | one global store slice per domain |
| State that belongs in a link | URL search params |
| Unit test | next to the unit |
| Integration/e2e test | outside the source tree |
| User-visible string | the translation catalogue, not the component |

Full reasoning, including the naming rules and the `lib` / `services` / `helpers`
distinction: [references/placement.md](references/placement.md).

## Symptom → move

Use this in review. Each row is a defect with one correct fix.

| Symptom | Move |
|---|---|
| A private helper is imported from another folder | promote it to a named shared module (law 2) |
| A constants file holds values for unrelated screens | split it by owner |
| The same prop is threaded through three levels | pass `children`, or put a provider on that subtree only |
| Two sibling features import each other | extract the shared part down, or merge them — they are one feature |
| A barrel re-exports many unrelated modules | import the modules directly; a barrel is one unit's public API, not a hub |
| A hook takes five booleans | split it per use case |
| A store slice holds a copy of a server response | delete it; read the query cache |
| A component owns state unrelated to what it renders | move that state into the child that uses it |
| A route file contains fetching, layout and branching | move the view into a unit; the route wires only |
| `utils.ts` has grown past a handful of unrelated functions | rename into named modules by subject |
| A shared component imports from a feature | invert it: pass what it needs as props |

## References

Read the one that matches the decision at hand.

- [references/placement.md](references/placement.md) — where each kind of file goes, naming,
  and the `helpers` / `lib` / `services` / `config` definitions this skill fixes.
- [references/decomposition.md](references/decomposition.md) — the named symptoms that
  justify splitting a component, and the ones that do not.
- [references/logic-layers.md](references/logic-layers.md) — handler vs hook vs plain module
  vs server; when a use-case layer earns its keep and when it is over-engineering.
- [references/state-layers.md](references/state-layers.md) — URL, server cache, global
  client store, local state: which one owns a given value.
- [references/boundaries.md](references/boundaries.md) — unidirectional imports, public
  APIs, barrels, and how to enforce all of it with lint rather than goodwill.
- [references/nextjs-structure.md](references/nextjs-structure.md) — routing folder vs
  product structure, private folders, route groups, thin route entries.
- [references/nextjs-rsc-and-data.md](references/nextjs-rsc-and-data.md) — how deep to put
  the client boundary, provider depth, and the three data-access approaches (pick one).
- [references/devdigest-map.md](references/devdigest-map.md) — how these rules are already
  realised in this repository, and where this repo deliberately differs.

## Choosing a structure for a new project

One ladder, four rungs. Climb only when the current rung hurts.

1. **Flat.** `components/`, `hooks/`, one named module per shared subject. Correct until
   roughly ten files with distinct concerns.
2. **Route- or feature-colocated.** Each screen owns a folder; shared UI stays flat. This is
   the default for product work and where most codebases should stop.
3. **Feature modules with public APIs.** `features/<name>/` each exposing one entry point,
   plus lint-enforced import zones. Adopt when several people ship in parallel and
   accidental coupling has already happened at least once.
4. **Layered methodology** (FSD-style layers, or a monorepo of packages). Adopt when there
   are more than a handful of features with real domain boundaries, or a second deployable
   consumes the same code.

Skipping rungs is the common failure: a three-screen app with seven layers pays the
classification cost of a large one and gets none of the isolation.

## When not to restructure

- A folder that is merely unfamiliar is not a defect. Restructure when a symptom above is
  present, not to match a preferred shape.
- Do not introduce a new top-level folder for one file.
- Do not rename or move files as a side effect of a feature change — the diff stops being
  reviewable. Move first, or after, in its own change.
- Duplication is cheaper than the wrong abstraction. Two similar components that evolve
  apart were correctly left duplicated.
