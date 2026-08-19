---
name: workflow-retro
description: "Reviews a multi-agent run after it finishes and turns it into concrete, evidenced improvements. Runs ONLY when a human invokes it — /workflow-retro, or the phrases \"retro\", \"how did that run go\", \"analyse the run\", \"what did the agents struggle with\"; it is never triggered by a hook, never chained onto the end of another skill, and never started because a run merely finished. Two data sources: by default what the orchestrator witnessed in context, and on \"deep\" the measured transcripts. Measures what the run actually cost and did — uncached vs cached tokens per participant, dispatch order and achieved concurrency, tool histogram, failed calls, repeated commands, and the paths two agents each read in full — then judges what was hard, what worked, which context was paid for twice, and what the run missed. Ends in named edits to the durable artifacts that shape the next run: an agent definition, a skill body, a dispatch template. Proposes them with exact wording and applies none without a go-ahead. NOT for reviewing the code a run produced (that is /pr-self-review and /code-review), NOT for recording a fact about the product's code (that is /engineering-insights and the package INSIGHTS.md), NOT for verifying a plan's requirements were met (plan-verifier)."
version: "1.0.0"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, AskUserQuestion
---

# Workflow Retro

A multi-agent run leaves two records. One is the work — a spec, a diff, a verdict —
and every other skill here reviews that. The other is **how the run itself went**,
and it is thrown away by default: the transcripts survive on disk, nobody reads
them, and the next run repeats the same three mistakes.

This skill reads that second record and converts it into edits to the artifacts
that decide the next run's behaviour.

```
   a human asks for it                 /workflow-retro
┌───────────────────────┐   ┌────────────────────────────────────────────┐
│ in context (default)  │   │ 1 pick the source: in-context, or deep     │
│  agent reports, task  │──►│ 2 read what each agent said about itself   │
│  notifications, your  │   │ 3 judge: hard · easy · duplicated · missed  │
│  own corrections      │   │ 4 answer in chat, in full                  │
├───────────────────────┤   │ 5 append one row to docs/retro/ledger.md   │
│ deep (on request)     │   │ 6 propose edits to agents / skills / prompts│
│  session + subagent   │   │ 7 route codebase facts to the journals     │
│  transcripts, measured│   └────────────────────────────────────────────┘
└───────────────────────┘         the human accepts the edits
```

## Two rules

**1. Run only when asked.** A human invokes this skill. It is not wired to a hook,
it is not the last step of another skill, and "a run just finished" is not a
trigger — see *Never automatic* below. Retro cadence is a human decision because
the skill costs a real dispatch and its output is only worth reading when somebody
is going to act on it.

**2. Measurement and judgement never swap places.** A figure is reported only when
it was *received* — printed by `scripts/collect.py`, or handed over verbatim in a
task notification. Never estimate a token count, a duration or a call count from
memory or from a transcript skimmed by eye: the numbers are large, the cache
columns are counter-intuitive, and a figure the model produced is a figure that
drifts. A figure that was not received is written `not measured — run deep`, which
is a real answer. Conversely, no measurement judges itself: "24 minutes" and
"three failed calls" are facts, and only the retro decides whether they were the
cost of the work or the cost of a bad dispatch.

## Step 1 — pick the data source

**Default: in context.** Retro the run you just orchestrated, from what you already
hold — each agent's final report, the `usage` block of each task notification
(`subagent_tokens`, `tool_uses`, `duration_ms`), the dispatch order you chose, and
the corrections you made to an agent's claims. This costs no file reads and is the
right mode for most runs.

What in-context mode **cannot** produce, and must therefore label
`not measured — run deep` rather than guess:

- the per-participant ledger (uncached vs cache-read, turns, thinking tokens),
- the duplicated-reading table — which paths two agents each opened,
- the per-participant tool histogram, failed-call list and empty-result count,
- achieved concurrency measured from timestamps.

`subagent_tokens` from a notification is also **inclusive of that agent's own
children**, so it is not additive across a nested run. Say so when you quote it.

**On request: deep.** When the user asks for a deep retro — or when a finding turns
on one of the figures above — measure the transcripts:

```sh
python3 .claude/skills/workflow-retro/scripts/collect.py            # newest session
python3 .claude/skills/workflow-retro/scripts/collect.py --top 15   # longer tables
python3 .claude/skills/workflow-retro/scripts/collect.py --json     # for a diff
```

Stdlib only, reads transcripts, writes nothing. It finds the session by slugifying
the cwd (`~/.claude/projects/<slug>/`) and picks the newest `*.jsonl`; pass
`--session <id>` or `--transcript <path>` for an older one. Subagent transcripts
are read from `<session>/subagents/agent-*.jsonl`, so a nested dispatch — an agent
that dispatched its own agents — appears as a `↳` row rather than vanishing into
its parent's total.

Read `metrics.md` before interpreting any column. It carries the definition and
the trap for each one, and this repo's measured baseline to compare against.

Record which mode ran, in the chat answer and in the ledger's `deep` column. A
retro whose mode is unstated cannot be compared with the next one.

## Step 2 — read what each agent said about itself

The facts say what an agent *did*. Its final report says what it *believed*, and
the gap between the two is where the useful findings are. For each dispatch:

- its own report (in your context if you dispatched it, or the last assistant
  message of `subagents/agent-<id>.jsonl`),
- what it said it could not do, could not find, or deviated on,
- what it claimed that you later had to correct.

That last one cannot be measured and must not be skipped: it is the only source
for *what the run missed*, and the parent is the only witness.

## Step 3 — judge, in six sections

Each finding carries **evidence** — a row of the facts block, a path, a quoted
error, or a named claim that turned out wrong. A finding with no evidence is an
opinion and does not go in the report.

| Section | Answers | Evidence it must cite |
|---|---|---|
| **Where the cost went** | Which participant spent what, and whether it bought anything | the ledger; uncached tokens, never the cache-read column as a headline |
| **What was hard** | Where an agent circled, retried, or hit a wall it could not pass | failed calls, repeated commands, empty results, its own "blocked"/"could not" lines |
| **What worked** | What to keep doing — a dispatch shape, a tool order, a model choice | the tool histogram, wall-clock, the agent's own report |
| **Duplicated context** | Which bytes were paid for two or three times, and who should have been handed a summary instead | the duplicated-reading table |
| **What was missed** | Claims that were wrong, gaps found later, work the dispatch never asked for | your own corrections, and the artifact that exposed the gap |
| **What the dispatch got wrong** | Prompt size, model tier, wrong agent for the job, a decision the agent had no channel to make | prompt chars vs output, the resolved model, tool-not-available errors |

Two of these are load-bearing and habitually skipped:

- **Duplicated context is the cheapest win in a fan-out.** Three agents each
  reading the same 49 KB journal is not a rounding error — it is three full-price
  reads of bytes the first one had already summarised. The fix is almost never
  "tell them not to read it"; it is to put the *conclusion* in the dispatch.
- **A tool an agent could not call is a design fact, not a hiccup.** When a
  subagent fails on `AskUserQuestion` because subagents cannot ask, every question
  it had was silently converted into a default. That belongs in the parent's
  procedure — hold the questions at the level that can ask them.

## Step 4 — answer in chat, then write the ledger

Two outputs, and the order matters. **The chat answer is the deliverable** — the
person who asked is reading now, and a retro that only lands in a file is a retro
nobody acts on. Give the six sections in the reply, findings first, evidence
attached, no preamble.

Then persist, in `docs/retro/`:

1. **`docs/retro/ledger.md` — always.** Append **one row** to `## Runs`, newest at
   the bottom. Append-only: never rewrite a row, and supersede one with a new line
   that says what it replaces.

   | Date | Run | Participants | Uncached | Wall | deep | Outcome | Report |

   Then, under `## Insights by module`, append any finding that **outlives this
   run** beneath the heading of the module it is about — a package name (`server`,
   `client`, …) or `Agents & dispatch`. One dated bullet, the shape the package
   journals use: what happens, what to do instead, and an `Evidence:` line pointing
   at the run report. A finding that is only true of this run does not go here.

2. **`docs/retro/<YYYY-MM-DD>-<slug>.md` — when the run was big enough to have a
   report of its own**, i.e. it dispatched more than one agent, or it produced a
   finding that needs its evidence written out. `<slug>` names the work, not the
   lesson (`project-context-spec`). For a small run, the ledger row plus the chat
   answer is the whole retro; say that rather than manufacturing a file.

```markdown
# Retro: <what the run was trying to do> — YYYY-MM-DD

| | |
|---|---|
| Session | `<id>` |
| Source | in context ‖ deep (transcripts measured) |
| Participants | N (main + N-1 subagents, M nested) |
| Uncached tokens | <n>, or `not measured — in-context retro` |
| Wall-clock | <n>m, of which <n>m in subagents |
| Outcome | <what exists now that did not before> |

## Where the cost went
## What was hard
## What worked
## Duplicated context
## What was missed
## What the dispatch got wrong
## Proposed changes        # the only section anyone acts on
## Facts                   # deep runs only: collect.py's output verbatim, unedited
```

On a deep run the `Facts` block is pasted **unedited**, at the bottom. It is what
makes the report auditable and what lets the next retro compare like with like — a
rewritten table is a table that can no longer be trusted or diffed. On an
in-context run the section says so, and names what would have been measured.

`docs/retro/README.md` carries the routing table for which file a finding belongs
in; keep it true if you add a destination.

## Step 5 — propose changes, apply none

Every improvement names **one durable artifact** and the **exact wording** to add
or replace. A recommendation that names no file changes nothing.

| Finding is about | The change lands in |
|---|---|
| An agent's remit, tools, or stopping rule | `.claude/agents/<name>.md` |
| A procedure every run of a skill follows | that skill's `SKILL.md` |
| What a dispatch must always be told | `docs/agent-prompts/<role>.md`, or the dispatching skill |
| Which model a step should use | `docs/agent-prompts/choosing-a-model.md` |
| A fact about the product's code | **not here** — `/engineering-insights`, per package |

That last row is a boundary, not a formality. A package `INSIGHTS.md` is about the
product's code and is append-only; "the researcher agent re-read a journal three
times" is a fact about our tooling and does not belong in it. Route each finding
to exactly one home and say which.

**Applying an edit to an agent definition or a skill changes every future run.**
Propose the wording, show the diff, and wait for a go-ahead. Never edit a
`SKILL.md` that has an entry in `skills-lock.json` — that lockfile pins vendored
skills by hash over the file, and it is never hand-edited (root `CLAUDE.md`).

## Never automatic

This skill is invoked by a human and by nothing else. Concretely, and to be kept
true:

- **No hook may call it.** `.claude/settings.json` holds exactly one hook — the
  `PreToolUse` merge gate for `pr-self-review` — and nothing on `Stop`,
  `SessionEnd` or `SubagentStop`. A retro on every stop would fire on one-line
  turns and train everyone to scroll past it.
- **No skill may chain into it.** `run-plan` ends at a verdict and does not call
  this; if a retro is wanted after a plan run, the human asks for one.
- **Finishing a run is not a trigger.** Do not offer to retro unprompted, and do
  not start one because a task notification arrived. Mentioning that a run looks
  worth a retro is fine; running it is not.

If a future change does wire it into automation, that is a deliberate decision and
belongs in `settings.json` with a line here saying why — not an accident.

## What this skill cannot know

State these in the report rather than writing around them:

- **Why an agent did something.** The transcript holds actions, not reasons.
  Thinking tokens are counted; their content is not in the record.
- **Whether the work is correct.** That is `/pr-self-review`, `/code-review` and
  `plan-verifier`. A run can be cheap, fast, friction-free and wrong.
- **Cost in money.** The ledger is tokens. No price is assumed, because prices
  differ per model and change.
- **A run whose transcripts are gone**, in deep mode. Subagent transcripts live
  under the session directory; a wiped scratchpad or a pruned project directory
  takes them with it. Retro a run while it is fresh — or accept the in-context
  answer, which survives only as long as the context does.
- **A run somebody else orchestrated**, in in-context mode. You did not witness it;
  deep mode is the only honest source for it.

## Anti-patterns

- **A score.** "This run: 7/10" is unusable — nobody can act on a number that
  compresses six independent dimensions. Findings, or nothing.
- **Vanity metrics.** Total tokens including cache reads, "agents launched",
  "tools called" — big numbers that no decision depends on. Report a figure only
  when a different value would have changed a choice.
- **A retro that changes nothing.** If every finding is "went well", either the
  run was trivial or the retro was. Say which.
- **Blaming the agent for the dispatch.** An agent that guessed a threshold it
  was never given, or defaulted a question it could not ask, is reporting a defect
  in its instructions. Fix the instructions.
