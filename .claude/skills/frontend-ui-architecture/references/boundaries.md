# Boundaries — imports, public APIs, barrels, enforcement

## Contents

- The direction rule
- Public API of a unit
- Barrels: the one that helps and the one that hurts
- Enforcing the direction with lint
- Cross-package boundaries
- Environment boundaries

## The direction rule

Dependencies point one way:

```
shared  →  feature  →  route / app
```

- **Shared code never imports a feature.** A design-system component that reaches into a
  feature has stopped being shared.
- **Sibling features never import each other.** If two features need the same thing, push it
  down to shared; if they need each other's behaviour, they are one feature. Compose them at
  the route or app level, which is allowed to know about both.
- **A route may import from features and shared; nothing imports a route.** Route files are
  leaves of the dependency graph, even though they are entry points of the runtime graph.

In a layered methodology the same rule reads: a layer imports only from layers strictly
below it, and a slice never imports a sibling slice of the same layer.

A cycle between modules is always a placement bug, never a reason to add a re-export.

## Public API of a unit

Each unit exposes one entry point. Everything else in the folder is private.

- Import through the entry point, never a deep path into another unit's internals.
- A deep import is the signal that something needs promoting (see
  [placement.md](placement.md)) — not that the convention is inconvenient.
- The entry point exports the component and its props type. It does not export helpers,
  constants or internal child components.

## Barrels: the one that helps and the one that hurts

The disagreement about `index.ts` files is a disagreement about **cardinality**, not about
the pattern.

**Keep** — a barrel that is one unit's public API:

```ts
// FindingsPanel/index.ts
export { FindingsPanel } from './FindingsPanel'
export type { FindingsPanelProps } from './FindingsPanel'
```

One module, a handful of named exports, no side effects. This is the privacy mechanism the
whole structure depends on. Its bundling cost is noise.

**Avoid** — a barrel that is a hub over many unrelated modules:

```ts
// components/index.ts  ← don't
export * from './Button'
export * from './Card'
// …forty more
```

Why it hurts: importing one symbol pulls the whole module graph into the bundler's view, so
tree-shaking degrades and build times grow; every consumer of any component becomes a
consumer of all of them, which hides real coupling; and `export *` makes the origin of a
symbol unfindable by reading.

Rules:

- One unit → one barrel. Allowed, expected.
- Many modules → no barrel. Import the modules directly.
- Never `export *`. Name every export.
- Never re-export a barrel from another barrel.
- Icon and asset collections are the worst case — always import directly.

## Enforcing the direction with lint

Conventions that are not machine-checked decay at the first deadline. Encode the direction
rule as import zones, with the linter already present in the project:

```js
// eslint.config.js — restrict what may import what
'import/no-restricted-paths': ['error', {
  zones: [
    // features must not import from the app/route layer
    { target: './src/features', from: './src/app' },
    // shared code must not import from features or app
    {
      target: ['./src/components', './src/hooks', './src/lib', './src/config'],
      from: ['./src/features', './src/app'],
    },
    // one feature must not import another
    { target: './src/features/billing', from: './src/features', except: ['./billing'] },
  ],
}]
```

Additions worth making when the graph gets larger:

- A dependency-graph checker in CI for rules a per-file linter cannot see (cycles,
  orphans, a visual graph to review).
- A structure linter if the project adopts a named methodology, so naming and slice rules
  are checked too.

Add the rule **at the same time** as the structure it protects. Retrofitting it onto a
codebase that already violates it produces a hundred errors and gets disabled.

## Cross-package boundaries

- Code needed by two deployables goes in a shared package. Code needed by one stays local.
- A shared package has one entry point and no dependency on either consumer.
- **Never keep two hand-made copies of the same contract.** If the toolchain forces a copy,
  treat both files as one: they change together, in one commit, and neither is edited alone.
- A copy that is behind the original is not a small problem — it presents as a type error
  somewhere unrelated. Surface the drift; do not paper over it locally.

## Environment boundaries

In any codebase where some modules must not reach the client:

- Mark server-only modules so importing them from client code fails **at build time**, not
  at runtime.
- Keep secrets readable by one module only.
- A module imported by both environments must be free of environment-specific imports —
  including type-only imports that happen to pull a runtime file along with them. A build
  that passes type-checking and tests can still fail at bundle time; the environment marker
  is what turns that into an immediate, obvious error.
