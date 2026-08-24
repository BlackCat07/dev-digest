# Retrospectives

What a multi-agent run cost, where the agents struggled, and what changed because
of it. Written by the [`workflow-retro`](../../.claude/skills/workflow-retro/SKILL.md)
skill, which is **run by hand** — nothing here is produced automatically.

| File | Holds |
|---|---|
| [`ledger.md`](./ledger.md) | One row per run, append-only, plus the insights that outlived their run — grouped by the module they are about |
| `YYYY-MM-DD-<slug>.md` | The full report for one run: cost, friction, duplication, what was missed, proposed changes, and the measured facts verbatim |

## Which file a finding goes in

| The finding is about | Where it goes |
|---|---|
| This run only — what it cost, what broke, what it missed | that run's report |
| A module, and it survives this run — a journal that is too big to re-read, a package whose grounding every dispatch needs | `ledger.md`, under that module's heading |
| The product's **code** — a gotcha, an antipattern, a schema trap | **not here** — that package's `INSIGHTS.md`, via `/engineering-insights` |
| A change to how an agent or skill behaves | the run report's *Proposed changes*, then the artifact itself once a human accepts it |

The third row is the boundary that matters. A package `INSIGHTS.md` is about the
product and is append-only; "the researcher re-read this journal three times" is a
fact about our tooling and belongs here instead. One finding, one home.

## Reading a ledger row

`uncached` is `input + cache_creation + output` — the tokens paid for in full. It is
the only headline figure. Cache reads run an order of magnitude higher and are
excluded on purpose; see
[`metrics.md`](../../.claude/skills/workflow-retro/metrics.md) for every column and
its trap.
