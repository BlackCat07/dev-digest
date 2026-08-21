# reviewer-core specs

What each behaviour of the review engine must do: what goes into a prompt, what survives
grounding, how a score is derived.

Format, naming, `Spec ID`, the `Status` lifecycle and the required sections:
[`../../docs/specs-convention.md`](../../docs/specs-convention.md).

**Only features that live entirely inside this package belong here.** A feature spanning
more than one package gets a single spec in [`../../specs/`](../../specs/README.md)
instead, with a per-package section.

## Specs

| Spec | Covers |
|---|---|
| [`skills-in-prompt.md`](skills-in-prompt.md) | The `## Skills / rules` slot: where it renders, how bodies are ordered and joined, and why the engine wraps nothing. |
| [`intent-in-prompt.md`](intent-in-prompt.md) | The `## Stated intent and scope` slot, the labelling-only system rule, and `applyScopeGuard`'s deterministic floor — labels only, nothing ever dropped. |

The rest of the engine's behaviour is documented as mechanism in
[`../docs/grounding.md`](../docs/grounding.md); a spec lands here when a lesson changes what
the engine must **do**, rather than how it does it.

## Two kinds of spec, and this package sees both

1. **Specs about this package** — the normal kind, as everywhere else in the repo.
2. **Specs as engine input.** `assemblePrompt` has an optional `specs` slot: a later lesson
   feeds project spec text into the review prompt, so the model can judge a diff against
   what the feature was supposed to do. That path treats spec text as **untrusted,
   delimiter-wrapped data**.

Consequence for every spec in this repo, not just this folder: never write instructions to
the reviewer into a spec ("ignore this", "don't flag that"). `INJECTION_GUARD` is built to
disregard exactly that phrasing, in any language — see
[`../docs/grounding.md`](../docs/grounding.md).
