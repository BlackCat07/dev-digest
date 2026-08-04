# server specs

What each `@devdigest/api` feature must do, from the API's side: endpoints, payload shapes,
and which rows a figure is computed from.

Format, naming and required sections: [`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## Specs

| Spec | Covers |
|---|---|
| [`findings-severity.md`](findings-severity.md) | Per-severity finding counts on the PR list payload, and the reviews endpoint the hover panel reads. |

## Scope of a server spec

The contract and where its numbers come from. Two things stay out:

- **Why the aggregation works the way it does** — that is [`../docs/`](../docs/README.md),
  specifically [`scores-and-costs.md`](../docs/scores-and-costs.md).
- **What the screen looks like** — that is `../../client/specs/`.

A spec that changes a Zod contract in `src/vendor/shared/` must say so explicitly: that
path is do-not-touch (see [`../CLAUDE.md`](../CLAUDE.md)), so the spec is where the agreed
change is on the record.
