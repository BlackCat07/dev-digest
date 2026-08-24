# workflow-retro

Post-mortem for a multi-agent run: what it cost, what the agents struggled with,
which context was paid for twice, and what to change before the next one.

| File | Holds |
|---|---|
| `SKILL.md` | The procedure — collect, judge in six sections, write the report, propose the edits |
| `metrics.md` | What each measured column means, its trap, and this repo's baseline run |
| `scripts/collect.py` | Deterministic collector over the session and subagent transcripts. Stdlib only, reads transcripts, writes nothing |

## Output

1. **The chat answer** — the deliverable, given in full to whoever asked.
2. **[`docs/retro/ledger.md`](../../../docs/retro/ledger.md)** — always: one
   append-only row per run, plus the findings that outlive their run, grouped under
   the module they are about.
3. **`docs/retro/<YYYY-MM-DD>-<slug>.md`** — for a run big enough to need its
   evidence written out. Its routing table lives in
   [`docs/retro/README.md`](../../../docs/retro/README.md).

## Two data sources

**In context** (default) — the agent reports, task-notification `usage` blocks, and
corrections the orchestrator already holds. Cheap, and enough for most runs.
**Deep** (on request) — `collect.py` over the session and subagent transcripts, for
the per-participant ledger, the duplicated-reading table, the tool histogram and
achieved concurrency. Anything the chosen mode cannot see is written
`not measured — run deep`, never estimated.

## Run by hand, always

Nothing triggers this skill automatically: no hook, no chained skill, and a
finished run is not a trigger. `.claude/settings.json` carries exactly one hook and
it belongs to `pr-self-review`. Retro cadence is a human decision — a retro on
every `Stop` would fire on one-line turns and train everyone to scroll past it.

Its output is a proposal. Edits to an agent definition or a skill body change every
future run, so a human accepts them.
