# Decomposition — when to split a component, and when not to

## Contents

- The rule
- The seven symptoms that justify a split
- Reasons that do not justify a split
- On the numeric limits in `react-best-practices`
- How to split: three moves
- Do not stop halfway

## The rule

**Split on a named symptom.** Before extracting anything, name the problem in one sentence.
If the sentence is "it is long", there is no problem yet.

The cost of a wrong split is higher than the cost of a long file: a premature abstraction has
to be understood, maintained, and eventually unpicked by someone who cannot tell which of
its parameters exist for a real reason. Duplication is cheaper than the wrong abstraction.

## The seven symptoms that justify a split

1. **Reuse.** A second place genuinely needs the same rendering. (A second place needing
   something *similar* is not this symptom.)
2. **Re-render cost.** State in the parent re-renders a subtree that does not depend on it,
   and it is measurable.
3. **State confusion.** The file owns several unrelated pieces of state and it is no longer
   obvious which handler touches which.
4. **Testing.** The behaviour can only be reached through unrelated UI; a smaller unit could
   be tested directly.
5. **Merge friction.** Several people repeatedly edit the same file for unrelated reasons.
6. **A boundary is required.** Something must sit at a specific place in the tree: an error
   boundary, a Suspense boundary, a provider for one subtree, a client/server boundary, a
   third-party wrapper.
7. **It cannot be named.** The component cannot be described in one short sentence without
   the word "and".

Symptom 7 is the one to check first — it is usually a rename or a split of *responsibility*,
not just of markup.

## Reasons that do not justify a split

- The file crossed a line count.
- The JSX requires scrolling.
- "One component per file" as a rule applied to private children.
- A component "might" be reused later.
- Symmetry with a sibling folder that happens to have more files.
- A wrapper that only forwards props, or that only calls a hook and returns `null` — call
  the hook where it is needed instead.

## On the numeric limits in `react-best-practices`

That skill lists roughly 200 lines and 5–7 props as limits. Treat both as **smells that
prompt a look, not triggers that mandate a split.** A component over the line with one
responsibility, stable props and a name that fits in a sentence is fine. A component under
the line with three unrelated states is not.

The prop count is the more useful of the two: many props usually indicates symptom 3 or 7,
and the fix is a different decomposition, not fewer arguments to the same one.

## How to split: three moves

Pick the move that matches the symptom. Do not reach for the next one until the previous
one is insufficient.

**1. Extract a child unit** (symptoms 1, 4, 7). A named component in its own folder, with
its own props. Pushes any state it alone uses down with it.

**2. Compose instead of configure** (symptoms 2, 3, 6). Pass rendered content in as
`children` rather than passing data down for the parent to render. This is also the move
that keeps a subtree out of a re-render, and — in a server-rendering framework — the move
that keeps a subtree on the server while its wrapper is interactive.

```tsx
// configure: parent owns everything, every state change re-renders the content
<Panel items={items} title={title} footer={footer} />

// compose: content is created by the caller, unaffected by Panel's own state
<Panel title={title}>
  <ItemList items={items} />
</Panel>
```

**3. Extract logic, not markup** (symptoms 3, 4). If the problem is behaviour rather than
rendering, the split is a hook or a plain module function — see
[logic-layers.md](logic-layers.md). Splitting markup does not fix a logic problem; it
distributes it.

## Do not stop halfway

A component should either **implement** things or **compose** them, not both. Extracting one
child from a list of five inline blocks makes the file harder to read than leaving all five
inline: the reader now has to hold two levels of abstraction at once. Extract all of the
peers, or none of them.

The same applies upward: if a parent becomes a pure composition, move any remaining stray
markup into one of the children so the parent reads as a list of parts.
