# server specs

What each `@devdigest/api` feature must do, from the API's side: endpoints, payload shapes,
and which rows a figure is computed from.

Format, naming and required sections: [`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## Specs

| Spec | Covers |
|---|---|
| [`findings-severity.md`](findings-severity.md) | Per-severity finding counts on the PR list payload, and the reviews endpoint the hover panel reads. |
| [`skills.md`](skills.md) | Skills CRUD, versioning and import; per-run skill attribution and the usage figures derived from it. |
| [`conventions-extractor.md`](conventions-extractor.md) | Scanning a cloned repo for house rules, the evidence gate and adherence count that filter them, and composing the accepted ones into a skill. |
| [`intent-layer.md`](intent-layer.md) | Deriving a PR's intent and scope: the endpoints, the `pr_intent` shape, the three derivation triggers, the source policy, confidence derivation, and the two-LLM-call trace. |
| [`smart-diff.md`](smart-diff.md) | Grouping a PR's changed files by role from their paths alone, overlaying the latest review's findings, the split suggestion, and why the route can make no model call. |
| [`blast-radius.md`](blast-radius.md) | The PR impact map: changed symbols, their resolved callers ranked and capped per symbol, the two-hop reverse import walk to endpoints and crons, and the ok/partial/degraded contract. |
| [`prior-prs.md`](prior-prs.md) | Earlier pull requests that changed the same files: the overlap query, recency ordering, the caps, and the coverage figures that say whether an empty answer is a finding or a gap. |

## Scope of a server spec

The contract and where its numbers come from. Two things stay out:

- **Why the aggregation works the way it does** — that is [`../docs/`](../docs/README.md),
  specifically [`scores-and-costs.md`](../docs/scores-and-costs.md).
- **What the screen looks like** — that is `../../client/specs/`.

A spec that changes a Zod contract in `src/vendor/shared/` must say so explicitly: that
path is do-not-touch (see [`../CLAUDE.md`](../CLAUDE.md)), so the spec is where the agreed
change is on the record.
