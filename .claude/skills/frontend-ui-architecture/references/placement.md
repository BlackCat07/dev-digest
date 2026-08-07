# Placement — where each kind of file goes

## Contents

- The unit folder
- Promotion: the rule of the second consumer
- The four shared homes: helpers, lib, services, config
- Constants
- Types
- Styles
- Tests
- Strings
- Naming

## The unit folder

A non-trivial component is a folder, not a lone file. One shape, used everywhere:

```
FindingsPanel/
  FindingsPanel.tsx     the view
  index.ts              the public API — the only path other code imports
  styles.ts             or FindingsPanel.module.css, whichever the project uses
  helpers.ts            pure functions, private to this unit
  constants.ts          values private to this unit
  FindingsPanel.test.tsx
```

Two properties make this worth the extra folder:

1. **`helpers.ts` and `constants.ts` are private by construction.** The barrel exports the
   component only, so nothing outside can reach them without a deep import that the
   convention forbids. Privacy is enforced by the shape, not by a comment.
2. **Deleting the feature is deleting one folder.** Nothing is left behind in a shared
   folder for the next person to wonder about.

Nest a child unit inside the parent's folder when only the parent renders it. A unit with
no children needs no subfolder.

## Promotion: the rule of the second consumer

Code starts private. It moves when a **second** consumer appears, and it moves to the
**nearest common ancestor** of the consumers — not to the top of the tree.

```
one caller            → private file inside the unit
two units, same route → shared folder of that route subtree
two route subtrees    → the shallowest folder both can reach (the shared library)
two packages/apps     → a shared package
```

Two corollaries that are easy to get wrong:

- **A unit shared by two routes cannot borrow a route's styles or constants.** Those belong
  to that route. A shared unit carries its own.
- **Placing a shared unit deeper than one of its consumers** forces an upward import across
  a route boundary. That single import is what makes a route subtree stop being
  self-contained, and it is invisible in review. Place at the shallowest consumer.

Promotion is not automatic on the second *similar* need — only on the second *identical*
need. Two components that merely resemble each other stay separate.

## The four shared homes: helpers, lib, services, config

The industry uses `helpers`, `utils` and `lib` interchangeably. This skill fixes the
following definitions. They are arbitrary; consistency is the point.

| Name | Contents | Visibility |
|---|---|---|
| `helpers.ts` | pure functions about **this unit's** data, no imports from siblings | private to the unit |
| `lib/<subject>.ts` | shared, named modules: formatting, parsing, domain vocabulary, configured third-party clients | shared, imported by many |
| `services/` or `api/` | transport and I/O — the one place that talks to the network or storage | shared, imported by hooks |
| `config/` | environment, feature flags, app-wide constants; the only reader of `process.env` | shared, imported anywhere |

Rules attached to those definitions:

- **No `utils` folder.** A shared module is named for its subject: `format.ts`,
  `severity.ts`, `diff.ts`. "Utils" describes where code *isn't*, so it accumulates
  everything that has no home — and then nothing can be deleted, because nobody knows what
  still uses it.
- **`lib/` is not a dumping ground with a nicer name.** Each file needs a subject a
  sentence can name. If a new file would be called `misc.ts`, the function belongs next to
  its only caller instead.
- **One place calls the network.** Every read and write goes through the transport module;
  components and helpers never call `fetch` directly. This is what makes error handling,
  auth headers and cancellation a single decision.

## Constants

- Values used by one unit: that unit's `constants.ts`.
- Values shared by one screen's units: the screen's `constants.ts`.
- App-wide values: `config/`.
- **Constants that encode an invariant live next to the code that must satisfy it.** A grid
  track list, a column-key array and the cells a row renders must agree; keep them in one
  place, and if nothing in the type system ties them, say so in a comment at the
  declaration. A global constants file guarantees they drift.
- Do not create a constants file for a single value used once. Inline it.
- No user-visible string is a constant — strings go to the translation catalogue.

## Types

- **Props types live in the component file.** Jumping to another file to learn what a
  component accepts is pure cost.
- Domain types used across a feature: that feature's `types.ts`.
- **Contracts shared with a backend live in exactly one module.** A second hand-made copy
  drifts, and the drift surfaces as a type error in an unrelated place. If a copy is
  unavoidable (separate packages, no build step), treat both copies as one file that must
  change together, and never edit one alone.
- No global `types/` bucket for everything. It becomes the same problem as `utils`.
- Runtime values (enum arrays, label maps) are **not** types. They belong in a named
  module, even when a schema in the shared contract could technically produce them —
  importing a value from a type-only module is how a build breaks in one environment and
  passes in another.

## Styles

Whatever the mechanism (CSS modules, utility classes, style objects, CSS-in-JS), the
placement rule is the same: **styles live with the unit that uses them.** A unit shared by
several screens owns its styles; it never reads a screen's stylesheet. Do not convert one
unit to a different styling mechanism than its neighbours — mixed mechanisms in one
codebase cost more than either choice.

## Tests

- Unit and component tests sit next to the unit, in the unit's folder.
- Integration tests may live in a folder of the modules they span.
- End-to-end tests live outside the source tree entirely — they describe the product, not a
  module, and must not break when a file moves.

## Strings

User-visible text goes in the translation catalogue under a namespace per screen or
feature, never inline in the component. A catalogue namespace with no screen behind it yet
is not dead code — check before deleting.

## Naming

- **Component folders and component files: PascalCase**, matching the exported component
  (`PRRow/PRRow.tsx`).
- **Everything else: lowercase kebab-case** (`format.ts`, `use-click-outside.ts`,
  `repo-context.tsx`).
- **Hooks are `use` + a capital letter, and only if they call other hooks.** A function
  that calls no hook is a plain function named for what it returns (`getSorted`, not
  `useSorted`) — and it can then be called conditionally.
- Folder names are singular (`feature`, not `features`, when it names one thing).
- One exported component per file. Small private components used only by that file are
  fine in it.
