# State layers — which layer owns a value

## Contents

- Four layers
- The decision list
- URL state
- Server state
- Global client state
- Local state
- Antipatterns

## Four layers

| Layer | Owns | Mechanism |
|---|---|---|
| **URL** | anything a user should be able to link, reload or share | search params, route params |
| **Server cache** | data the server owns and other clients can change | a query library's cache |
| **Global client state** | UI facts several screens must agree on | one store, sliced per domain |
| **Local state** | UI facts one subtree cares about | state in that subtree |

They are not interchangeable, and a value has exactly one owner. Most state bugs are a value
owned by two layers.

## The decision list

Ask in order; stop at the first yes.

1. **Should a reload or a shared link preserve it?** → URL.
2. **Does the server own it — can another client change it?** → server cache. Never copied
   into a store.
3. **Do unrelated screens need to agree on it?** → global client state.
4. **Otherwise** → local state, in the component that actually uses it. Push it down as far
   as it goes.

And before any of them: **can it be derived from something that already exists?** Then it is
not state at all — compute it during render.

## URL state

Belongs in the URL: filters, sort, pagination, search query, selected tab when it is
addressable, open detail panel when it is addressable.

Rules:

- The URL is the source of truth; components read it rather than mirroring it into state.
- **Validate params on read.** A route or search param is user input.
- Derive the parse/serialise logic **in one shared place** when a key is built from dynamic
  values, so two readers cannot drift.
- A transient UI detail (hover, focus, an unsubmitted draft) does not go in the URL.

## Server state

Belongs to the query cache, keyed by a stable key. The cache — not a store, not component
state — is where loading, error, staleness, retries and invalidation live.

Rules:

- **Never mirror a server response into a store.** Two copies with different staleness is
  the single most expensive state bug in a frontend codebase.
- One place declares each query: a hook per resource, named for the resource.
- **Query keys are a contract.** Put the key factory next to the hooks that use it. When a
  server prefetch and a client read must match, nothing warns on a mismatch — a mismatch
  silently double-fetches.
- Mutations invalidate keys; they do not hand-patch unrelated caches.

## Global client state

Belongs here: theme, session/viewer identity, a cross-screen panel or modal registry, a
multi-step flow shared by several screens, feature toggles evaluated at runtime.

Rules:

- One slice per domain, named for the domain. A single object holding everything makes every
  consumer re-render.
- A store is not a cache. If it needs invalidation or staleness, it was server state.
- A **provider is dependency injection**, not global state. Put it on the shallowest subtree
  that consumes it, not at the root by default: a provider at the root re-renders every
  consumer and blocks framework optimisations for everything below it.
- Split providers by concern so an unrelated change does not re-render every consumer.

## Local state

The default. Correct until one of the layers above claims the value.

Rules:

- Colocate: state lives in the component that uses it, not in the nearest ancestor that
  happened to be convenient.
- Related values that always change together belong in one reducer, not five setters.
- Lifting state is a last resort; composition (`children`) often removes the need.

## Antipatterns

- A store slice that shadows a query result.
- A filter kept in component state while the same screen also reads it from the URL.
- Global state introduced so that two siblings can talk — lift to their parent or compose.
- A context holding a value that could be computed locally by each consumer.
- Deriving a value into state with an effect instead of computing it during render (see
  `react-best-practices`).
