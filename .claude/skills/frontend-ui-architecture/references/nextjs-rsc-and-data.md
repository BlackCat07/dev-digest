# Next.js — the client boundary and where data access lives

## Contents

- Why the boundary is an architecture decision
- How deep to put the boundary
- Composition across the boundary
- Provider depth
- The three data-access approaches — pick one
- Where mutations live
- Environment markers

## Why the boundary is an architecture decision

`'use client'` marks a boundary between **module graphs**, not a per-component setting.
Everything a client module imports, and every component it renders directly, joins the client
bundle. One directive on a wrapper can pull a whole subtree across.

The consequence for structure: **the file you put the directive in determines what the client
bundle contains.** That makes it the same class of decision as choosing which folder a file
lives in — which is why it belongs in this skill, while what is legal to write on either side
belongs to `next-best-practices`.

## How deep to put the boundary

Two valid positions. Choose by **who owns the data**, and apply the same choice across the
codebase.

| Data ownership | Boundary | Consequence |
|---|---|---|
| The server reads data directly (database, internal service) | **at the leaves** — only interactive pieces are client modules | least client JavaScript; data fetched close to the source |
| An external API owns the data and a client query library reads it | **at the view** — the route entry stays a server component, the screen view is a client module | one data mechanism, one error path; a larger client bundle, accepted deliberately |

The second row is a deliberate deviation from the usual "push the directive to the leaves"
advice. It is correct when the query library, its cache and its hooks are the app's data
layer: splitting the view into server and client fragments would mean two mechanisms for the
same data, and interleaved fragments cannot use the hooks.

What is never correct: choosing per component, ad hoc. Write the chosen position down in the
project's conventions and keep the route entry a server component either way.

## Composition across the boundary

A server component **passed as `children` or a prop** to a client component is not part of the
client module graph — it renders on the server and its output is handed over. This is the tool
for keeping the boundary high without dragging a subtree across:

```tsx
// server component
<InteractiveShell>   {/* client module: state, handlers */}
  <ServerRenderedContent />   {/* stays on the server */}
</InteractiveShell>
```

Rules:

- Props crossing the boundary must be serialisable, and should be **narrow**: pass the three
  fields the component renders, not the whole record. A broad prop type invites passing
  everything, and everything passed reaches the client.
- Wrap a third-party client-only component once, in your own client module, instead of marking
  its consumers as client modules.
- Rendering something only in the browser is a boundary decision too: load it dynamically with
  server rendering disabled rather than making its parent a client module.

## Provider depth

Providers are dependency injection (see [state-layers.md](state-layers.md)), and in this
framework their depth also has a rendering cost: a provider at the root layout makes
everything below it a client subtree and blocks static optimisation of server-rendered parts.

- Put each provider on the **shallowest segment that consumes it**, not in the root layout by
  default.
- A provider that only wraps `{children}` inside a server layout keeps the layout itself on
  the server.
- Data seeded for a query library follows the same rule: seed it in the segment that owns the
  data, so unrelated keys stay out of a global config and each segment can start its own
  requests.

## The three data-access approaches — pick one

The framework documents three, and explicitly recommends not mixing them:

1. **External HTTP API.** Every read and write goes through one transport module to a service
   that owns the data and enforces authorisation. Correct when a separate backend exists.
2. **Data access layer.** A server-only internal module: it authorises, queries, and returns
   minimal objects shaped for the UI. Only it reads secrets. Correct when this application
   owns the data.
3. **Component-level access.** Queries inline in server components. Prototypes only — it is
   how full records leak to the client.

Structural rules that follow:

- **One approach per codebase.** Adopting a second one is an architecture decision to make
  explicitly, not a local convenience — a reader can no longer tell where authorisation
  happens.
- With approach 1, the framework's data-layer machinery (server-side data modules, secrets,
  server-side cache invalidation, tainting) is **not applicable**; do not introduce it
  piecemeal. What still applies: validating route and search params, provider depth, narrow
  props, and environment markers.
- With approach 2, nothing outside the data layer imports the database client or reads
  secrets, and it returns UI-shaped objects rather than raw records.

## Where mutations live

- A server mutation handler is **colocated with the feature that owns it** — not in a
  route-handler folder, and not in a global actions file.
- Every server-side mutation handler re-checks authentication **and** ownership of the
  specific resource. A check on the page that renders the form does not extend to the handler:
  it is a separate entry point.
- Keep handlers thin: validate input, delegate to the module that owns the rule, return only
  what the UI needs.
- With approach 1 above, mutations are transport calls plus cache invalidation on the client;
  there is no server handler to place.
- Never mutate during render.

## Environment markers

Mark server-only modules so an accidental client import fails at build time, and client-only
modules likewise. This matters structurally because the same file can be reachable from both
graphs, and the failure mode is asymmetric: type-checking and unit tests can both pass while
the bundle breaks at runtime on every route that transitively imports the module. The marker
converts that into an immediate build error at the offending import.
