# Evals — engineering-insights

Five scenarios that check what the skill **does**, not what its files say. The mechanical
checks (frontmatter limits, section count, format consistency) are `grep`-able and already
pass; nothing here repeats them.

## Contents

- How to run
- Baseline mode (run without the skill first)
- Scoring
- The five scenarios
- Two warnings

## How to run

There is **no runner**. Anthropic's own guidance says so outright: *"There is not currently
a built-in way to run these evaluations. Users can create their own evaluation system."*
These are rubrics you score by hand, or hand to a second agent as judge.

For each `NN-*.json`:

1. Start a **fresh session** — one that has not seen this skill, these files, or this
   conversation. A session that already knows the answers proves nothing.
2. Perform the `setup` step if the file has one.
3. Paste `query` verbatim. Say nothing else.
4. Score each line of `expected_behavior` independently.
5. Repeat **3×**. The system under test is a language model; a single pass is an anecdote.
   Record the model and the date with the result.

## Baseline mode

Before scoring the skill, run the same `query` in a session **without** the skill loaded
and record what happens. This is the step most people skip, and it is the only one that
answers the real question: *does the skill change behaviour?*

If baseline and skill runs score the same, the skill is not earning its tokens — roughly
730 lines of scaffolding across `SKILL.md`, `references/examples.md`, and four journals.
That is a result worth knowing.

## Scoring

Per `expected_behavior` line: **pass** / **partial** / **fail**. A scenario passes only if
every line passes — these are conjunctions, not a score out of five.

Weight the failures unequally:

| Scenario | If it fails |
|---|---|
| `02` negative | **Most serious.** The skill pollutes journals with filler. A model that always writes something turns the journal into noise, which is the documented way these files stop being read. |
| `03` dedup | **Serious.** Journals fill with what `CLAUDE.md` already says. Currently the journals are empty while `server/CLAUDE.md` and `client/CLAUDE.md` hold six gotchas each, so this is live, not theoretical. |
| `01` write path | Recoverable — a badly formatted entry can be fixed by hand. |
| `04` receipt | Expected to be flaky. A skill fires when the model judges it relevant, so the pre-read cannot be *guaranteed* without a hook. Score it to measure how often, not to prove it always happens. |
| `05` routing | Recoverable, but a wrong route means the next session in that module never sees the entry. |

## The five scenarios

| File | Tests |
|---|---|
| `01-write-path.json` | A genuinely new finding is routed, sectioned, formatted, and appended |
| `02-negative-nothing-to-write.json` | A trivial session produces **no** entry |
| `03-dedup-already-documented.json` | A finding already in `CLAUDE.md` is dropped, with the reason |
| `04-recall-receipt.json` | The journal is read and a receipt emitted **before** the answer |
| `05-routing-cross-package.json` | One cause spanning two modules yields **one** entry, in the owner |

## Two warnings

**These queries are fixtures, not facts.** The findings described in `query` fields are
plausible session experiences invented to exercise the machinery. Do not treat them as
claims about how this repo currently behaves, and do not copy them into a journal.

**Never reference this directory from `SKILL.md`.** The agent under test would read its own
answer key. Evals are for the human running them; the skill must not know they exist.
