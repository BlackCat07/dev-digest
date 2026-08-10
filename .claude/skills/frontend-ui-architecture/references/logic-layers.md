# Logic layers — which home owns a piece of behaviour

## Contents

- Four homes
- The decision list
- What belongs in a hook, and what only looks like it does
- When a use-case layer earns its keep
- Dependency injection without a framework
- The container/presentational question

## Four homes

| Home | Owns |
|---|---|
| **Event handler** | what happens in response to *this* interaction |
| **Custom hook** | stateful logic, and synchronisation with anything outside React |
| **Plain module function** | rules and transformations that need no React |
| **Server** | authorisation, persistence, anything that must not be trusted to a client |

Everything else is a variation on these four. A component body is not a home: it renders.

## The decision list

Ask in this order and stop at the first yes.

1. **Does it need to run only when the user does something?** → event handler. Not an effect.
2. **Is it derivable from props or state?** → compute it during render. Not state, not a
   hook, not an effect.
3. **Does it hold state over time, or talk to something outside React (network, storage,
   subscription, timer, browser API)?** → custom hook.
4. **Is it a rule or a transformation over plain data?** → plain function in a module. Pure,
   testable without rendering, callable conditionally.
5. **Must it be trusted?** → server. A client-side check is a UX affordance, never an
   authorisation.

The most common misplacement is a rule written inside a component or a hook when it needed
neither: it becomes untestable without rendering, and it cannot be reused by the next
caller.

## What belongs in a hook, and what only looks like it does

A hook is the right home when it wraps **a concrete use case**: `useProjectQuery`,
`useOnlineStatus`, `useMediaQuery`, `useKeyboardShortcut`. Name it for what it does for the
caller.

Not hooks:

- **A function that calls no hook.** Name it for its result (`getSorted`), keep it in a
  module. It can then be called conditionally, which a hook cannot.
- **Lifecycle wrappers** (`useMount`, `useUpdateEffect`, `useEffectOnce`). They hide the
  dependency list from the linter and turn a reactive model into an imperative one.
- **A hook with hardcoded field names** presented as reusable. Either parameterise it or
  admit it is specific and move it next to its one caller.

Two properties worth keeping in mind when placing logic in hooks:

- A hook shares **stateful logic, not state.** Two components calling the same hook get two
  independent copies. Shared *state* needs lifting or a store — see
  [state-layers.md](state-layers.md).
- Hook bodies must be pure, like component bodies. Anything else belongs behind the hook, in
  a module or on the server.

## When a use-case layer earns its keep

A separate application layer — plain functions expressing operations (`submitReview`,
`recalculateBudget`) that know nothing about React — is worth introducing when **at least
two** of these hold:

- the rules are non-trivial and change for business reasons, not UI reasons;
- more than one entry point invokes them (a screen and a background action, two screens, a
  CLI);
- they must be unit-tested without rendering anything;
- the same rules must survive a UI framework change.

If none hold, the layer is over-engineering: a hook calling the transport module directly is
the correct amount of structure for "load this and show it". Most product screens never need
more.

Where it goes, if introduced: a named module per operation, in the feature that owns the
operation — not a global `services/` folder, which turns into the same bucket as `utils`.

## Dependency injection without a framework

When a use-case function needs I/O, pass the dependency as an argument rather than importing
the transport module inside it. The hook that calls it supplies the real implementation; a
test supplies a fake. No container, no framework.

```ts
// use case: no imports from transport, no React
export async function publishReview(
  input: ReviewInput,
  deps: { save: (r: ReviewInput) => Promise<Review> }
): Promise<Result<Review>> { /* rules here */ }

// hook: the only place that knows the real implementation
export function usePublishReview() {
  return (input: ReviewInput) => publishReview(input, { save: api.saveReview })
}
```

Stop at one argument object. Injecting every collaborator turns a small app into a wiring
exercise.

## The container/presentational question

Splitting components into "containers that fetch" and "presentational components that
render" is no longer the default; hooks removed the need for a component whose only job is
to hold state. The underlying separation still matters, but the boundary moved:

**The boundary is the hook, not a wrapper component.** A component may call a data hook and
render — that is not a violation. What is a violation is a component that calls the network
itself, or one that mixes domain rules into its markup.

Keep a wrapper only when it exists for a reason from
[decomposition.md](decomposition.md) — a boundary, a provider for one subtree, a reuse point
— not to satisfy a naming pattern.
