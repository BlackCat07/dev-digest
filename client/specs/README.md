# client specs

What each `@devdigest/web` feature must do, from the user's side: screens, states, and the
data each one reads.

Format, naming and required sections: [`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## Specs

| Spec | Covers |
|---|---|
| [`findings-severity.md`](findings-severity.md) | Severity counters in the PR list, the findings hover panel, and the per-severity filter on the PR detail page. |
| [`skills.md`](skills.md) | The Skills Lab screen, the skill editor's four tabs, file import, and the agent editor's Skills tab. |
| [`conventions-extractor.md`](conventions-extractor.md) | The Conventions screen: triaging extracted candidates, their GitHub-linked evidence, and the create-skill modal. |
| [`intent-layer.md`](intent-layer.md) | The INTENT card on the PR Overview tab, its states, the out-of-scope badge, and the scope filter that defaults to showing everything. |
| [`smart-diff.md`](smart-diff.md) | The Files changed tab: files grouped by role with boilerplate collapsed, the clickable findings badge that scrolls to a line, the order toggle, and the degradation ladder. |

## Scope of a client spec

Observable behaviour only — what renders, when, and what it reads. The endpoint's shape is
the server's spec (`../../server/specs/`); the rules for *how* to build it are
[`../CLAUDE.md`](../CLAUDE.md) and [`../docs/`](../docs/README.md).
