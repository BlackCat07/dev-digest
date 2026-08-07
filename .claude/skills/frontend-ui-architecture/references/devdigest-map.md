# How these rules land in DevDigest

The generic rules in this skill are already realised in `client`. This file maps them, names
the two places where this repo deliberately differs from the mainstream advice, and lists what
is not yet decided.

**The canonical statements live in the repo, not here.** `client/CLAUDE.md` and
`client/docs/feature-unit.md` are authoritative; if they disagree with this skill, they win and
this file is stale. Read them before restructuring anything in `client`.

## Contents

- The mapping
- Two deliberate deviations
- Not yet decided
- Traps recorded in the journal

## The mapping

| Rule in this skill | How `client` realises it |
|---|---|
| Unit folder with a private surface | `<Name>/{<Name>.tsx, index.ts, styles.ts, constants.ts, helpers.ts, <Name>.test.tsx}`; imports go through `index.ts` only |
| Promote on the second consumer, to the nearest common ancestor | Rule 1 in `client/docs/feature-unit.md`: a unit rendered by two pages sits in the higher `_components/` |
| Second route subtree → shared library | `src/lib/` — e.g. `src/lib/format.ts`, `src/lib/severity.ts`; a unit's `helpers.ts` cannot be shared, by construction |
| Route files are thin | `page.tsx` renders one view from `_components/`, no logic |
| One place calls the network | `src/lib/api.ts` (`apiFetch` + `ApiError`); components never call `fetch` |
| Data lives in hooks | `src/lib/hooks/*` — one module per resource area |
| Styles live with the unit | each unit's `styles.ts`; a shared unit carries its own rather than reading a screen's |
| Cross-screen primitives are extended, not restyled | `src/vendor/ui/` — add a file, never restyle a primitive for one caller |
| Contract shared with the backend lives in one module | `src/vendor/shared/` mirrors the server's contracts; coordination only, both copies change together |
| Strings are not in components | `messages/en/<namespace>.json`, read via next-intl |
| Constants that encode an invariant sit next to what must satisfy them | `pulls/constants.ts` — `GRID` and `COLUMN_KEYS` must agree with the cells `PRRow` returns; nothing type-checks it |
| Unit tests colocated, e2e outside the tree | `<Name>.test.tsx` in the unit; the `e2e` package at the repo root |
| Private folders opted out of routing | `_components/` under each route segment |
| Structure shape | **Shape A** from `nextjs-structure.md`: colocated in the route segment. There is no `src/features/` and should not be one without a decision to switch shapes wholesale |

## Two deliberate deviations

**1. The client boundary sits at the view, not at the leaves.** `client/CLAUDE.md`: data hooks
are `"use client"`, so most feature views are client components while the route entry stays a
server component — "keep the boundary at the view, not deeper".

This is row 2 of the table in `nextjs-rsc-and-data.md` and it is the correct choice here: an
external Fastify API owns the data, TanStack Query is the data layer, and splitting a view into
server and client fragments would mean two mechanisms for the same data. Do not "optimise" a
view by pushing the directive downward — it breaks the hooks.

**2. Data access is approach 1 (external HTTP API).** Everything goes through `apiFetch` to the
API on port 3001. Therefore the framework's data-layer machinery — a server-only data module
reading secrets, server functions for mutations, server-side cache invalidation, tainting — is
**not applicable**, and introducing any of it is an architecture decision to raise explicitly,
not a local convenience. What still applies: validating route params, provider depth in
`src/lib/providers.tsx`, narrow props across the boundary, and environment markers.

## Not yet decided

Open, and worth a decision before the codebase forces one:

- **No lint-enforced import zones.** The direction rule in `boundaries.md` is convention only.
  Adding `import/no-restricted-paths` is cheap now and expensive later.
- **No route groups.** Introduce one only for a real second shell or a scoped boundary.
- **Flat `src/lib/hooks/`.** Fine at the current size. The criterion for splitting it is the
  same as everywhere else: it stops being a set of named resource modules and starts being
  miscellaneous.
- **Query keys** are declared per hook. If a server prefetch is ever added, the key factory has
  to move to one shared place first — nothing warns on a mismatch.

## Traps recorded in the journal

`client/INSIGHTS.md` holds the file-grounded versions of these. Two are structural and worth
knowing before moving files:

- **Type-only imports of the shared contract.** A runtime import from `@devdigest/shared` fails
  only under `next build` / `next dev`, as a 500 on every route that transitively imports it,
  while `tsc --noEmit` and `vitest` stay green. Runtime constants belong in `src/lib/`
  (`src/lib/severity.ts` exists for this reason). This is the concrete case the environment
  markers in `nextjs-rsc-and-data.md` are for.
- **Path aliases are declared twice.** A new alias needs `tsconfig.json` *and*
  `vitest.config.ts`, or it type-checks and fails at test runtime.

Read `client/INSIGHTS.md` in full before answering about `client` — that is the session
protocol in the root `CLAUDE.md`, and this skill does not replace it.
