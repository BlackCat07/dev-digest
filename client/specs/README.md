# client specs

What each `@devdigest/web` feature must do, from the user's side: screens, states, and the
data each one reads.

Format, naming and required sections: [`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## Specs

| Spec | Covers |
|---|---|
| [`findings-severity.md`](findings-severity.md) | Severity counters in the PR list, the findings hover panel, and the per-severity filter on the PR detail page. |

## Scope of a client spec

Observable behaviour only — what renders, when, and what it reads. The endpoint's shape is
the server's spec (`../../server/specs/`); the rules for *how* to build it are
[`../CLAUDE.md`](../CLAUDE.md) and [`../docs/`](../docs/README.md).
