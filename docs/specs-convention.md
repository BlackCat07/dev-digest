# Feature specs — the shared convention

A spec says what a feature must do, precisely enough that an agent can build it and a
reviewer can check the diff against it. This file defines the format once so the
per-package `specs/README.md` files don't each carry their own copy of it.

A spec is written **before** the code and amended **after** it. `Status` says which half
of that life it is in, and `Status` is also what decides who may edit it — see
*Ownership* below.

## Where a spec lives

| The feature touches | Its spec |
|---|---|
| **one** package | `<pkg>/specs/<feature>.md` |
| **more than one** package | root [`specs/<feature>.md`](../specs/README.md) — **one file**, with a per-package section |

Packages with a specs directory: `client`, `server`, `reviewer-core`, `mcp-server`.

**`e2e` has none.** `e2e/specs/` is already taken by browser flows (`NN-name.flow.json`),
which `e2e/run.ts` loads. e2e documentation lives in `e2e/docs/`.

> **This replaces the earlier "one spec per package, cross-linked" rule.** Seven features
> already have a `client/` + `server/` pair written under that rule — `smart-diff`,
> `blast-radius`, `intent-layer`, `findings-severity`, `conventions-extractor`,
> `prior-prs`, `skills`. They stay where they are; merging them into root `specs/` is
> deliberately deferred, because a merge is fourteen files of churn for no behaviour
> change. The new rule governs new specs.

## One file per feature

`<feature-name>.md`, kebab-case, named after the feature rather than the lesson or the
branch (`findings-severity.md`, not `l02.md`).

A spec is **append-and-amend**: when a later change alters the behaviour, edit the spec so
it keeps describing the current system, and note what changed under *History*. It is not a
changelog — git is the changelog.

## Spec ID

`SPEC-NN`, **sequential across the whole repository**, zero-padded to two digits. A
cross-package feature has one file and therefore one ID; that ID is how an acceptance
criterion gets a global address (`SPEC-07/AC-3`) in a plan, a task or a review finding.

The next free ID:

```sh
rg -o 'SPEC-[0-9]+' --no-filename specs/ */specs/ | sort -u | tail -1
```

Specs written before IDs existed carry none. They are **not** backfilled — an ID assigned
retroactively would collide with the numbers already quoted in nothing, which is to say it
would buy nothing. Numbering starts at `SPEC-01` for the first spec that has one.

## Status, and who owns the file

| `Status` | Means | May edit it |
|---|---|---|
| `draft` | Written, has open questions, not agreed | `spec-creator` |
| `approved` | Agreed by a human, ready to plan and build | `spec-creator` |
| `implemented` | The code exists and the spec describes it | `doc-writer` |
| `superseded` | A later spec replaced this decision | nobody — it is a record |

**A human moves `draft → approved`.** No agent may promote its own spec: `approved` means
a person agreed to the acceptance criteria, and an agent that can grant that has made the
review a formality.

`implemented` is set by `doc-writer`, which documents the landed code. **No other
agent edits a spec.** `implementation-planner` reads one and cites its `AC-n` as a
requirement's source; `implementer` reads one and reports a contradiction rather
than editing it. `superseded` is set when a new
spec names this one in its `Supersedes:` line; the superseded file also gains a
`Superseded by:` line and a `## History` entry, and is otherwise left alone.

## The skeleton

Everything above the divider is written **before** the code. Everything below it is filled
in when `Status` becomes `implemented`. The divider comment is not part of the file — it
marks the split in this template only.

```markdown
# Spec: <feature> | Spec ID: SPEC-NN | Status: draft|approved|implemented|superseded
Supersedes: <link to the spec this replaces, or —>

One sentence: what a user can do that they couldn't before.

## Problem & why
## Goals / Non-goals          # explicit boundaries — what we are NOT doing
## User stories               # each with an ID: US-1, US-2…
## Acceptance criteria (EARS) # each with an ID and a `Verify:` hint — AC-1, AC-2…
## Edge cases                 # each with an ID: EC-1, EC-2…
## Cross-module interactions  # who calls whom, in which direction — or "none, single package"
## Contracts                  # shared types that must change, and what they must then carry
## Non-functional             # perf / security / a11y — as numbers, never adjectives
## Inputs (provenance)        # where each input comes from, and who owns it
## Untrusted inputs           # reads foreign text? → handled as data, never as commands
## Traceability               # US/EC → AC → Verify; nothing agreed goes unaccounted
## Open questions             # [NEEDS CLARIFICATION: …] — must be empty to reach `approved`

<!-- ── below: filled when Status becomes `implemented` ── -->

## Data                       # endpoint, contract type, which rows
## States                     # what the user observes in each case
## Implementation             # the files that carry it, one line each
## History                    # YYYY-MM-DD — what changed and why
```

Drop a section only when it is genuinely empty, and **say so**
(`## Non-goals — none`) rather than silently omitting it.

### `Acceptance criteria` replaced `Behaviour`

They were always the same section — numbered, testable statements of observable behaviour.
EARS only fixes the *syntax*, so that "the trigger", "the state" and "the response" cannot
be read two ways. Specs written before this change use `## Behaviour`; that heading is
still valid in them and does not need converting.

### `Edge cases` and `States` are not the same list

- **`Edge cases`** — situations that can *arise*: an empty result set, the 101st item, a
  path with a unicode character, two writers at once, a dependency timing out. Written
  before the code, because finding these is the point of writing a spec at all. **Each
  carries an ID — `EC-1`, `EC-2` — because traceability closes over them too.**
- **`States`** — what the user *observes*, per case: empty, zero, loading, error, partial.
  "The cases that get skipped and then ship broken." Written when the code exists, because
  it names real responses and real screens.

### Every criterion carries a `Verify:` hint

One of four words, and they are **the same four** `plan-verifier` uses when it later checks
the finished diff (ISO/IEC/IEEE 29148, as described in NASA's Systems Engineering
Handbook). Writing the hint at spec time means the criterion and its future evidence were
designed together:

| `Verify:` | Means it will be checked by |
|---|---|
| `inspection` | reading the code — the requirement is visible in it |
| `analysis` | reasoning over the code paths, without executing them |
| `demonstration` | running something and observing the behaviour |
| `test` | an automated test asserting it |

```markdown
- **AC-3** — WHEN a review completes, the system **shall** write one `agent_runs` row
  per agent that ran. `Verify: test` — *observable: the row count equals the number of
  agents in `resolveTargets`, for a review with two agents enabled.*
```

The method says **how**; the *observable* says **what you would see**. Both, always — a
method alone still lets two people disagree about what passing looks like.

**A criterion nobody can name a method for is not a criterion.** If the only honest answer
is "you'd just look at it and know", it is prose — rewrite it until one of the four fits.
The hint is a *hint*, not a contract: the planner may choose a stronger method, and
`plan-verifier` records what was actually done.

### `Cross-module interactions` and `Contracts`

Two sections for the gap that is cheapest to catch here and most expensive to catch in
review: **a field drawn in a mock, or implied by a criterion, that no contract carries.**

- **`Cross-module interactions`** — which packages or modules talk, in which direction,
  and what crosses. A `mermaid` diagram is usually clearer than prose. This is a
  **boundary** statement, not a file layout: name the modules and the direction, never the
  folder.
- **`Contracts`** — every shared type that must change, and what it must then carry. Name
  the type and the field; do **not** name the file it lives in, and do not write the Zod.
  `server/src/vendor/shared/` and its hand-made client copy are do-not-touch and change
  only by agreement — so a spec is precisely where that agreement goes on the record.

Both drop to `— none, single package` for a feature inside one package, rather than being
omitted.

### `Non-functional` takes numbers

`perf`, `security`, `a11y` and `scale`, each as a figure with the condition it holds under
— `p95 < 200 ms at 500 concurrent rows`, not `fast`. An adjective here is the same failure
as an adjective in a criterion, and it survives longer because nobody tests this section.

Prompts worth answering before dropping the section, each with the shape its answer takes:

| Ask | The answer looks like |
|---|---|
| What is the slowest acceptable response, measured where? | a **latency budget** — `p95 < 200 ms, server-side, excluding cold start` |
| What volume must it survive, and what happens above it? | a **cap and its behaviour** — `1 000 rows; above that, paginate rather than truncate` |
| How often may this be called, and by whom? | a **rate limit** — `10 req/min per workspace` |
| Can it be used without a mouse, and by a screen reader? | a **WCAG level** — `WCAG 2.2 AA` |
| Who may see this data? | the **scope** — `workspace-scoped; the lookup is the authorization check` |

`## Non-functional — none` is a real answer; a vague one is not. **A requirement that
belongs here but has no number goes to `## Open questions` with a proposed default** — it
does not ship as an adjective.

### `Traceability`

One table. Every `AC` appears exactly once, and every `US` appears at least once:

```markdown
| AC | Serves | Package | Verify |
|---|---|---|---|
| AC-1 | US-1 | server | test |
| AC-2 | US-1, US-3 | server | analysis |
| AC-3 | EC-2 | client | test |
| — | EC-4 | — | `accepted` — a duplicate label is legal and rare |
```

Two rules, and they are hard:

- **Every `US` is served by at least one `AC`.** A story with no criterion was agreed and
  then not built.
- **Every `EC` is either served by an `AC` or explicitly `accepted`.** An edge case found
  and then silently dropped is worse than one never found — the analysis was done and the
  result thrown away. `accepted` means *we know, and we choose to let it happen*; write the
  reason beside it.

The inverse is the third failure: **a criterion serving nothing** is scope that arrived
without anyone deciding to add it. An `AC` may legitimately trace to a non-functional
budget rather than a story — say which, rather than leaving the cell blank.

This table is what `plan-verifier` traces against after the code lands: it checks
requirements by ID, so an `AC` that no row accounts for is an `AC` nobody will verify.

## EARS — the acceptance-criteria syntax

EARS (*Easy Approach to Requirements Syntax*, Alistair Mavin, Rolls-Royce, 2009) exists so
each criterion collapses into **one testable statement**, with no ambiguity about the
trigger, the state or the response. Five patterns:

| Pattern | Shape | Example |
|---|---|---|
| **Ubiquitous** — always true | *The system shall …* | The system **shall** log every authentication attempt. |
| **Event-driven** — on an event | `WHEN … SHALL` | **WHEN** a user submits the sign-in form, the system **shall** verify the credentials with the auth provider. |
| **State-driven** — while a state holds | `WHILE … SHALL` | **WHILE** a sync is running, the system **shall** show a progress indicator that cannot be dismissed. |
| **Unwanted behaviour** | `IF … THEN … SHALL` | **IF** credential validation fails three times in 60 seconds, **THEN** the system **shall** lock the account for 15 minutes. |
| **Optional feature** | `WHERE … SHALL` | **WHERE** MFA is enabled, the system **shall** require a TOTP code after the password. |

The five patterns are the easy half. **The hard half is turning a vague requirement into
an unambiguous one**, and it is where a spec earns its keep:

| Vague | EARS criterion |
|---|---|
| "should work fine on big repos" | **WHEN** a repository exceeds the indexing threshold, the system **shall** generate the overview from deterministic facts only, without reading whole files. |
| "shouldn't fall over if the model is unavailable" | **IF** a structured model call fails, **THEN** the system **shall** render the deterministic review skeleton with the reason, instead of an error. |
| "should hint where to start reading" | The system **shall** order the reading path by file rank from the import graph — not alphabetically and not by date. |

Rules that make a criterion checkable:

- **One criterion, one behaviour.** An "and" joining two responses is two criteria.
- **`shall`, not `should` / `may` / `will`.** Only `shall` is a requirement.
- **Name a threshold, never an adjective.** "fast", "large", "reasonable" are not
  testable; `< 200 ms at p95`, `> 500 files` are.
- **Every criterion carries an ID** — `AC-1`, `AC-2` — because plans, tasks, tests and
  review findings cite them.

## What a spec is not

- **Not a design doc.** Trade-offs, rejected approaches and gotchas belong in the
  package's `docs/` or, if they were discovered the hard way, `INSIGHTS.md`.
- **Not a rule.** "Never call `fetch` in a component" is a convention → `CLAUDE.md`.
- **Not a test plan.** Acceptance criteria should be testable, but the suites and the CI
  matrix are `TESTING.md`'s.
- **Not a plan.** Tasks, ordering, owned paths and done-conditions are
  `implementation-planner`'s. A spec says *what*, never *in which order we will
  build it* — and that agent reads this file as input, never writes one.

## Why the format matters beyond humans

The `specs` prompt slot in `reviewer-core` (`assemblePrompt`, `src/prompt.ts`) passes spec
text to the reviewing model as **untrusted, delimiter-wrapped data** — so a spec is a
future review input, not just documentation. Two consequences:

- Write acceptance criteria as checkable statements; that is what a model can review a
  diff against.
- Never put instructions to the reviewer in a spec ("ignore X", "don't flag Y"). The
  injection guard is built to disregard exactly that, and it will.
