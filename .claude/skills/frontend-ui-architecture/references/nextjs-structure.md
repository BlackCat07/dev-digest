# Next.js structure — routing folder vs product structure

## Contents

- The one decision that matters
- Thin route entries
- Private folders
- Route groups
- Two shapes, and how to choose
- Where non-route code goes
- Naming collisions to expect

## The one decision that matters

The framework is unopinionated about structure, and its `app/` folder is a **routing
description**, not an architecture. Everything under it maps to URLs; nothing about it tells
you where a feature lives.

So decide once, per project: **is a screen's code colocated inside its route segment, or does
`app/` stay a thin routing shell over a separate product tree?** Both work. Mixing them does
not — half the features end up in each and every new file becomes a debate.

## Thin route entries

Whichever shape is chosen, a route file wires and returns:

```tsx
// app/repos/[repoId]/pulls/page.tsx
import { PullsView } from './_components/PullsView'

export default async function Page({ params }: PageProps<'/repos/[repoId]/pulls'>) {
  const { repoId } = await params
  return <PullsView repoId={repoId} />
}
```

- No data access, no layout decisions, no branching on state in the route file.
- Route params are user input: validate before use.
- Special files (`layout`, `loading`, `error`, `not-found`, `route`) are **placement
  decisions** — they exist to put a boundary at a specific point in the tree. Choosing the
  segment to put them in is the architectural act; their APIs belong to
  `next-best-practices`.

## Private folders

A folder whose name starts with `_` is opted out of routing entirely. Colocation is safe
without it, but use it anyway, consistently:

- it separates UI from routing at a glance;
- it groups a segment's internals in the editor;
- it cannot collide with a future framework file convention.

`_components/` for units, `_lib/` for segment-private modules. A segment's private folder is
reachable from that segment and its descendants; that is what makes the promotion rule
(nearest common ancestor) map onto route depth:

```
pulls/_components/            reachable from the list AND the detail page
pulls/[number]/_components/   reachable only from the detail page
```

A unit rendered by both pages goes in the **higher** one. Placing it lower forces an upward
import across a route boundary, and the route subtree stops being self-contained.

## Route groups

A folder in parentheses organises routes without appearing in the URL. Introduce one only for
a concrete reason:

- a different root layout or shell for a section (marketing vs app vs admin);
- a layout or a `loading` boundary that must apply to a subset of sibling routes;
- a section owned by a different team.

Do not add route groups decoratively. An empty parenthesis level is one more folder to
traverse for no boundary gained.

## Two shapes, and how to choose

**Shape A — colocated in the route segment.** The screen's units live in that segment's
`_components/`; shared UI, hooks and library modules sit at the top level. Choose this when
screens correspond to features, which is the common case for product UIs.

```
src/app/repos/[repoId]/pulls/
  page.tsx                  wires
  layout.tsx
  constants.ts              screen-level
  styles.ts                 screen-level
  _components/PRRow/…       units
  [number]/page.tsx
  [number]/_components/…
src/components/  src/hooks/  src/lib/  src/config/
```

**Shape B — routing shell over a product tree.** `app/` holds only routing files, each
importing a screen component from a product tree (`src/features/…`, or a layered structure
with an explicit page layer). Choose this when features do not map one-to-one onto routes —
one feature reachable from several URLs, or several features composed on one URL — or when a
named layered methodology is being adopted.

In Shape B the framework's `app/` and a layer also called `app` are different things: keep
routing in the framework folder and put the composition root (providers, global setup) in the
product tree.

Start with Shape A. Move to Shape B when the mapping breaks, and move all of it.

## Where non-route code goes

Unchanged from [placement.md](placement.md), with one addition: server-side data access and
mutation handlers are **colocated with the feature that owns them**, never gathered into a
route-handler folder because they happen to run on the server. Route handlers exist for HTTP
endpoints, not as a home for server code.

## Naming collisions to expect

- `app/` (framework routing) vs `app` as an architectural layer name — pick one meaning per
  project and never use the word for the other.
- A `components/` folder at the top level vs `_components/` inside a segment: top level means
  cross-screen, segment means screen-private. Never move a file between them without checking
  who imports it.
- Dynamic segment folders (`[id]`) look like ordinary folders in an editor tree but are
  routing syntax; nothing non-route should be named with brackets.
