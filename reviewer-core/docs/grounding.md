# The two gates: citation grounding and injection defense

`CLAUDE.md` states both as one-line rules ("grounding is mandatory, not advisory";
"injection defense lives in one place"). This is what they actually do, why they are built
the way they are, and what breaks if you route around them.

Everything here is pure: no DB, no network, no filesystem, no `process.env`. That is what
makes both gates testable with a mock provider — and why a helper reaching for `node:fs`
breaks more than its own function.

## Gate 1 — citation grounding

### What it does

`groundFindings(findings, diff)` (`src/grounding.ts`) is the **only** post-processing step
in a run, shared by every strategy rather than duplicated per path. Each finding is checked
against the unified diff and either kept or dropped with a reason:

| Finding kind | Kept when |
|---|---|
| a normal diff finding | its `[start_line, end_line]` range **intersects a real hunk** in the diff for that same file |
| `secret_leak`, `lethal_trifecta`, `phantom`, `hook` | the **file** appears in the diff at all |

The second row is the full-file exception: those come from scanners that read whole files,
so demanding a hunk intersection would drop every one of them. They still need the file to
be present — an invented path is still an invented path.

A finding whose file is absent from the diff is dropped before either check.

### The line index, and its fallback

`buildLineIndex` maps each file to the set of **new-side** line numbers its hunks cover. It
prefers the hunk's explicit `newLineNumbers`, and falls back to walking
`newStart … newStart + max(newLines, 1)` when that array is empty. The `max(…, 1)` matters:
a zero-length `newLines` would otherwise contribute no lines at all and silently fail every
finding in that hunk.

### Why the score is recomputed, not read

After grounding, the score is **derived from the survivors**:

```ts
review: { ...merged, findings: ground.kept, score: scoreFromFindings(ground.kept) }
```

`scoreFromFindings` (`src/review/reduce.ts`) is a deterministic 0–100: start at 100 and
subtract a fixed penalty per severity. It is **not** the model's self-reported score, which
has no anchor and drifts wildly between models — a cheap model will happily "approve" with
zero findings and still emit a number. Because the same severity table drives the review
*event* in `to-review.ts`, the score on screen can never contradict the findings beneath it.

Two consequences worth internalising:

- Recomputing from `ground.kept` rather than the pre-grounding set is what keeps the score
  honest. Score a dropped finding and the number describes findings the user cannot see.
- Adding a severity level means updating the penalty table, or it silently scores 0 penalty.

### Do not add a bypass

There is no flag to skip grounding, and a "trust this agent" path would be indistinguishable
from a hallucinated citation. Dropped findings are not lost — they are returned with reasons
and surfaced in the run trace (`grounding dropped "<title>": <reason>`), so a
too-aggressive gate is diagnosable without disabling it. `groundingSummary` renders the
`"3/4 passed"` figure the trace shows.

## Gate 2 — injection defense

### One place, on purpose

`assemblePrompt` (`src/prompt.ts`) appends `INJECTION_GUARD` to **every** agent's system
prompt, so it runs on every review path — the studio server and the GitHub/CI runner both
reach it through `reviewPullRequest`. Harden here rather than pattern-matching untrusted
text downstream: downstream matching only ever catches one phrasing, in one language.

All external content is wrapped by `wrapUntrusted(label, content)` into
`<untrusted source="…">…</untrusted>` blocks — the diff, the PR title/description, code,
skills, specs, the repo map, the callers digest. The wrapper also escapes any `</untrusted>`
inside the content, so text cannot close the delimiter it is sealed in.

### What the guard actually asserts

Beyond "data, not instructions", the guard specifically refuses the **descoping** attack: a
claim that code is a test fixture, a demo, intentional, not for production, or a request to
"not flag" something. Those never reduce or waive the review, **in any language**. Stated
intent may inform a finding's rationale; it can never turn a real defect into zero findings.

That distinction is the useful one to keep when editing the guard: the model is allowed to
*use* the PR description as context, and never allowed to let it *shrink the job*.

### Trust levels are not uniform

The prompt slots differ in how much they are trusted, and the wrapping follows that:

| Slot | Treatment |
|---|---|
| `system` | trusted — the agent's own prompt |
| `skills`, `memory` | trusted-ish, curated; joined in unwrapped |
| `specs`, `repoMap`, `callers`, `prDescription`, `diff` | untrusted; each `wrapUntrusted`-ed |

`prDescription` is additionally truncated (4000 chars) so an author-controlled body cannot
blow the token budget — it is both the most attacker-controlled slot and the cheapest to
abuse.

Optional slots are **meant to be absent**: `skills`, `memory`, `specs`, `repoMap`,
`callers` are fed by later lessons, and an omitted slot simply leaves its section out. A
missing section is not a bug to fill in.

## If you change either gate

- Both are covered by `test/` (`prompt`, `run`). Note that `npm test` runs with
  `--passWithNoTests`, so a green run does not by itself prove a test exists for your change.
- This package is consumed **as source** by the server through a tsconfig alias. There is no
  build and no version bump: editing either gate changes the running API's behaviour
  immediately.
