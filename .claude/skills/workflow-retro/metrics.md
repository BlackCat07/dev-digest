# The metrics, their traps, and this repo's baseline

Read this before interpreting `collect.py`'s output. Every column below has a way
of being read wrong, and most of the wrong readings are flattering.

## The ledger

| Column | Is | Trap |
|---|---|---|
| `uncached` | `input + cache_creation + output` — the tokens paid for in full | This is the headline. Nothing else is. |
| `output` | Tokens the model generated, thinking included | Small next to the input columns and still the best proxy for how much *work* a participant did |
| `thinking` | The reasoning share of `output` | Content is not recorded. A high share is not a problem; a high share with a thin report is |
| `cache create` | First write of a prompt prefix into cache | Grows with how much material a dispatch carries. A 17 000-character dispatch is visible here |
| `cache read` | Prefix served from cache | **Never a headline.** It runs an order of magnitude above every other column and reads as a catastrophe when it is the opposite — a big number here means the cache was working |
| `turns` | Assistant messages, i.e. model calls | A long agent with few turns did fewer, larger steps. Neither is better by itself |
| `wall` | Last minus first timestamp for that participant | For the main loop this includes the time a human spent reading and typing, so it is **not** compute time |

**Why `uncached` and not a sum.** In the run that produced this file, one subagent
read 17.5M tokens from cache against 1.2M of cache creation. Adding the columns
gives ~19M and suggests a runaway; the number that reflects the work is 1.33M. Any
report that leads with the sum is wrong in the direction of alarm, and a retro that
cries wolf gets ignored.

## Dispatch order

`prompt chars` against the resulting `output` is the dispatch-efficiency signal.
A 17 000-character brief that produces a 700-line spec is leverage. The same brief
producing a two-paragraph answer is a sign the work was smaller than the framing.

`Concurrent pairs` reports overlap that actually happened, measured from
timestamps — not the parallelism the code intended. A fan-out that shows no
concurrent pair ran sequentially whatever the call site looked like.

## Duplicated reading

A path counts when **two or more participants opened it** and the reader did not
also write it (re-reading your own draft is authoring, not duplication).

Paths are keyed by their resolved repo-relative form, so `server/INSIGHTS.md`,
`./server/INSIGHTS.md` and an absolute spelling collapse to one row. The
consequence to know: **a token that does not resolve to an existing file is
dropped**, so a file deleted since the run, and a path assembled from a shell
variable, are both invisible here. The table under-reports; it never over-reports.

## Friction

`is_error` tool results, plus Bash calls whose stdout came back empty. An empty
result is a weaker signal than an error and belongs to the same family: the
participant asked the tree a question that had no answer, i.e. it was working from
a wrong guess about the codebase. Three or four are normal exploration. A dozen in
one participant means its dispatch failed to say where things are.

Tool-availability errors are a separate class and always structural — see the
`AskUserQuestion` example in `SKILL.md`.

## Rework

A file written by one participant and edited afterwards by another. Nonzero means
a dispatch's output needed correcting rather than accepting, which is a fact about
the brief, not the writer. Zero does not mean the output was good — it can also
mean nobody checked.

## Baseline — 2026-08-18, `project-context` spec run

The first measured run, for comparison. One `spec-creator` on opus, which
dispatched two `researcher`s on sonnet concurrently; the deliverable was a
742-line spec plus one index row.

| | main loop | spec-creator | researcher ×2 (each) |
|---|---|---|---|
| model | opus-5 | opus-5 | sonnet-5 |
| turns | 96 | 116 | 56 / 65 |
| uncached | 1.01M | 1.33M | ~0.36M |
| output | 149k | 100k | ~16k |
| tools | 40 | 68 | 39 / 43 |
| wall | 130m (human-paced) | 30m | 3m |

Shape worth remembering: **the two sonnet researchers cost about a quarter of the
opus author each and returned in a tenth of the time**, and one of them returned
the finding the whole spec turned on. Cheap parallel research under an expensive
author is a good trade at this size.

Duplication in that run: `server/INSIGHTS.md` opened by 3 participants, and four
schema files by 3 each — the journal alone is ~49 KB, and every reader paid for all
of it to use two entries.
