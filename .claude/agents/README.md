# Agents

Subagents this repo ships. Canonical location is `.claude/agents/`; every `.md`
file here is auto-discovered and shared with the team through version control.

An agent runs in its own context, with its own tool allowlist and its own model,
and returns a **single final message** to whoever dispatched it. For how agents
differ from skills, commands and rules, see the table in
[`../skills/README.md`](../skills/README.md) — not repeated here.

This file is a **map of the set**: what each agent is for, what it may touch,
what goes in and what comes out, and where its rules come from. The rules
themselves live in the agent files. Read the agent file before changing an agent.

## Catalog

| Agent | Model | Tools | Writes files? | Does |
|---|---|---|---|---|
| [researcher](researcher.md) | `sonnet` | Read, Grep, Glob, Bash, WebSearch, WebFetch | no | Answers **one** research question — inside this repo or from external sources — as an evidence-cited report with an explicit list of what could not be found |
| [implementation-planner](implementation-planner.md) | `opus` | Read, Grep, Glob, Bash | no | Turns **one** agreed set of requirements into an Implementation Plan: verified `R<n>` with a `Source:` each, tasks with Owned paths and Done-conditions, a Depends-on DAG grouped into waves, and the `Execution mode` question. Plans **how**, never **what**, and never touches a spec |
| [implementer](implementer.md) | `opus` | Read, Grep, Glob, Bash, Write, Edit, Skill | **yes — source only** | Carries out a plan's tasks in `client`/`server`/`reviewer-core`, edits only its Owned paths, checks the existing tests still pass, and reports. Writes no spec |
| [test-writer](test-writer.md) | `opus` | Read, Grep, Glob, Bash, Write, Edit, Skill | **yes — test paths only** | Writes the tests a change owes across all five suites, maps each to the requirement and seam it covers, and never edits the code under test |
| [architecture-reviewer](architecture-reviewer.md) | `opus` | Read, Grep, Glob, Bash | no | Checks architectural boundaries and returns findings with `path:line`, quoted code and the rule violated. Emits **no** merge verdict |
| [plan-verifier](plan-verifier.md) | `opus` | Read, Grep, Glob, Bash | no | Checks each `R<n>` and each Done-condition one at a time against the finished diff, with a verdict, a verification method and evidence per item |
| [doc-writer](doc-writer.md) | `sonnet` | Read, Grep, Glob, Bash, Write, Edit | **yes — doc paths only** | Turns a plan, report or diff into the document the conventions call for, in the one place they name, with diagrams. Owns a spec from `Status: implemented` onward |
| [spec-creator](spec-creator.md) | `opus` | Read, Grep, Glob, Bash, Write, Edit, AskUserQuestion, Agent | **yes — one spec file + its index row** | Writes the feature spec **before** the code: interrogates the request across six fixed categories, analyses the design for gaps and corner cases, and lands EARS acceptance criteria as `Status: draft` |

## Inputs and outputs

The output artefact is **always the final message**. No agent here writes its own
report to a file, and none of them commits anything.

| Agent | Takes in | Returns | Leaves on disk |
|---|---|---|---|
| `researcher` | one question, plus the packages or the external topic it is scoped to | a research report — `Answer → Conclusions → Evidence → Not found → Coverage → Sources` | nothing |
| `implementation-planner` | one agreed set of requirements — prose, a dispatch, or an existing spec's `AC-n` — plus answers to any earlier clarification | an Implementation Plan — `**Execution mode:**`, Scope, Execution mode, `Requirements (verified)` with a `Source:` each, Constraints, Skills, Waves, `T<n>` tasks (Owned paths, Skill, Invariant, Acceptance, Done-condition), Contracts & wiring, Tests, Verification, Non-goals, Assumptions, Open questions & recommendations, Coverage. **No `Specs` section** | nothing |
| `implementer` | **the plan text in full**, plus which tasks (one wave in multi-agent mode, the whole plan in single-agent mode) | an Implementation report — Coverage, Skills applied, Changes, Acceptance, Deviations, Blocked, Gates, Not done | source inside its Owned paths, **uncommitted**; a generated migration when the plan explicitly grants `pnpm db:generate`. **Never a spec** |
| `test-writer` | the seam or task to cover, plus the behaviour to assert | a Test report — Coverage, Skills applied, Tests written (each with the `R<n>`/`T<n>` it covers), Not tested, Deviations, Blocked, Gates, For the parent | test files inside its allowed test paths, **uncommitted** |
| `architecture-reviewer` | a diff, or a named area and package | an Architecture review — Coverage, CRITICAL, WARNING, SUGGESTION, Known drift not reported, Not checked, Delegated not done, Grounded in | nothing |
| `plan-verifier` | **the plan text in full**, plus the diff or the implementation report | a Plan verification — Coverage, Requirements (one row per `R<n>`), Done-conditions (one row per `T<n>`), the two inverse checks, Not checked, Out of scope, For the parent | nothing |
| `doc-writer` | the material to document — a plan, a report, a diff or notes — for a feature that already shipped | a Documentation report — Coverage, Documents written, Diagrams, Placement decisions, Deviations, Blocked, Not done, For the parent, Grounded in | `docs/` and `specs/` files inside its allowed doc paths, plus the index row, **uncommitted** |
| `spec-creator` | one feature described but not yet specified — prose, a ticket or a change request — plus any design material **as file paths** | a Spec report — Coverage, Research delegated, Spec written, The six questions, Self-check (17 items), Design findings, Open questions, Deviations, Blocked, Not done, For the parent, Grounded in | exactly one `specs/<feature>.md` at `Status: draft`, plus its index row, **uncommitted** |

### Recognising the output

Each agent has one normal artefact and one stop-and-ask artefact. They are told
apart by the first line, and by the absence of the normal document's headings.

| Agent | Normal | Stop-and-ask |
|---|---|---|
| `researcher` | `# Repo research — …` / `# External research — …` | `# Clarification needed — no research performed` |
| `implementation-planner` | `# Implementation Plan — …` | `# Clarification needed — no plan produced` |
| `implementer` | `# Implementation report — …` | `# Cannot implement — no executable plan` |
| `test-writer` | `# Test report — …` | `# Cannot write tests — no testable target` |
| `architecture-reviewer` | `# Architecture review — …` | `# Clarification needed — no architecture review performed` |
| `plan-verifier` | `# Plan verification — …` | `# Cannot verify — no plan or no diff` |
| `doc-writer` | `# Documentation report — …` | `# Cannot document — nothing implemented to document` |
| `spec-creator` | `# Spec written — …` | `# Clarification needed — no spec written` |

**A stop-and-ask response means go back to the human.** For seven of the eight,
a subagent has no channel to a person, so: relay the questions **verbatim**,
then re-dispatch with the answers. Do not read it as findings and do not answer
on the human's behalf. Re-dispatching without answers makes the agent proceed on
stated defaults, recorded under `## Assumptions`.

Those seven ask **at most once**, at most four questions, each with its own
default. **`spec-creator` is the exception**: it declares `AskUserQuestion` and
is told to ask a *blocking* gap directly, up to two rounds of four, keeping the
artefact for the case where there is nothing to specify at all — or where the
tool turns out not to work. Whether it does is unverified; see Known limits.

Two acceptance checks the parent owes every report, because nothing else enforces
them:

- **A report that names a package and carries no `INSIGHTS <pkg>: N entries`
  receipt for it is incomplete** — reject it and re-dispatch. All eight agents do
  the **read half** of the `engineering-insights` protocol by hand (root
  `CLAUDE.md` requires it); `0 entries` is a real answer.
- **No agent may append to an `INSIGHTS.md`.** Anything worth recording comes back
  under `## For the parent` or `## Open questions`, and the **parent** runs
  `/engineering-insights`.

## The pipeline

```
             ┌── researcher ──┐   (optional, either side: an external question
             │                │    the implementation-planner cannot answer)
             │                │
change ─► spec-creator ─► implementation-planner ─► implementer ─► plan-verifier ─► /pr-self-review ─► gh pr create
request   (spec, draft)   (plan: how, not what)       (diff)     (per-item verdict)   (verdict)       (hook-gated)
               ▲                    │      ▲                │
          human approves            │  execution mode:      ├─► test-writer           (tests, test paths only)
          draft → approved          │  human answers        ├─► architecture-reviewer (boundaries, read-only)
                                    │  before dispatch      └─► doc-writer            (specs, docs, diagrams)
                                    └─► questions + recommendations back to the human
```

`spec-creator` is in the chain but **not automatic**: a change request that
arrives already specified goes straight to `implementation-planner`. Its output
is `draft`, and a human — not the parent, not the planner — moves it to
`approved`. Planning from a `draft` is allowed and normal; building from one is
how a criterion nobody agreed to reaches production.

**The spec belongs to exactly two agents, and the planner is neither.**
`spec-creator` owns it while `Status` is `draft` or `approved`; `doc-writer` owns
it from `implemented` onward, including the `approved → implemented` flip and the
lower half (`## Data`, `## States`, `## Implementation`, `## History`).
`implementation-planner` reads a spec and cites its `AC-n` as a requirement's
`Source:`; `implementer` reads one and reports a contradiction under
`## For the parent`. Neither writes one, and neither plans a task that does.

**Two things the plan now carries that the parent must act on**, both of which
exist because a subagent has no channel to a person:

- **`## Execution mode`** — the plan recommends `multi-agent` (parallel
  implementers, one wave at a time) or `single-agent` (one linear pass) and asks
  the human to confirm. The section carries both orderings, so the answer never
  costs a re-plan; relay the question before dispatching any implementer.
- **`## Open questions & recommendations`** — the numbered gaps found while
  verifying the requirements, each with the default the plan already took, plus
  explicit recommendations for a cleaner, safer or cheaper approach. A
  recommendation is advice, never a requirement: the plan follows the
  requirements as given, and an accepted recommendation means a re-dispatch.

`researcher` is not in the chain — it is dispatched on demand, from anywhere.
`/pr-self-review` is a **skill**, not an agent, and a `PreToolUse` hook denies
`gh pr create` / `gh pr merge` until its verdict is fresh and CRITICAL-free.

Of the four later agents, only `plan-verifier` sits in the chain: it answers *did
we build what the plan said*, which is a different question from *is this diff
safe to merge*, and answering it first means `/pr-self-review` is not the place a
missing requirement is discovered. The other three are dispatched on demand.
`architecture-reviewer` is deliberately placed **before** `/pr-self-review` — a
misplaced file is cheap to move while the diff is still local and expensive once
a verdict has been recorded against it.

### Who answers which question

| The question | Whose |
|---|---|
| where / why / since when does this repo do X | `researcher`, repo mode |
| what does library X actually do in version N | `researcher`, external mode |
| what must this feature do, exactly, before anyone builds it | `spec-creator` |
| how do we build it, in what order, owned by whom | `implementation-planner` |
| are these requirements complete, and is there a better approach | `implementation-planner`, Step 1 |
| should this run as parallel implementers or one linear pass | `implementation-planner`, `## Execution mode` — answered by the **human** |
| build it | `implementer` |
| the seam has no test | `test-writer` |
| is this file in the right ring / the right folder, and may it import that | `architecture-reviewer` |
| did we do what the plan said, item by item | `plan-verifier` |
| where does this document go, and what must it contain | `doc-writer` |
| what did the design forget — which state, which corner case, which contract | `spec-creator` |
| is this diff good, is it safe to merge | `/pr-self-review` — **not** the implementer, **not** the architecture-reviewer, **not** the plan-verifier |

### The implementation-planner → implementer handoff

The plan exists **only as the planner's final message**, and the implementer
starts with a fresh context: no conversation history, no files the planner read,
no reasoning it did. Whatever is not in the plan text does not reach it.

So **the parent relays the plan verbatim** — not a summary, not "see above". This
is also why `implementation-planner.md` requires *quoting* the `INSIGHTS.md` entry
or skill rule that binds, rather than pointing at the file: a pointer is read
differently by someone who did not do the reading.

Two consequences of adding four more agents to this handoff:

- **`plan-verifier` needs the plan text verbatim too**, for exactly the reason
  `implementer` does. The plan exists only as a message; a verifier handed a
  summary verifies the summary, and it will do so fluently.
- **Owned paths now arbitrate between *agents*, not just between implementers.**
  `implementer`'s Owned paths may include a spec file and a test file, and both
  overlap `doc-writer`'s and `test-writer`'s write scopes. Within one wave a path
  belongs to exactly **one** dispatch; the other agent blocks rather than editing
  it. Nothing enforces this — see Known limits.

Parallelism is by **wave**. Two tasks share a wave only when their Owned paths do
not intersect **and** they sit in different packages — two implementers running
`tsc --noEmit` over the same package read each other's half-written files.
Dispatch a wave, wait for every report, then dispatch the next.

## Permissions

The allowlist is the safety design; the prose in each agent file only explains
it. What is **not** granted:

At eight agents this reads better agent-per-row. `✗` means **not granted**;
`Bash` is granted to every one of them and is discussed below.

| Agent | `Write`, `Edit` | `Skill` | `WebSearch`, `WebFetch` | `Task` | `AskUserQuestion` |
|---|---|---|---|---|---|
| `researcher` | ✗ | ✗ | **granted** | ✗ | ✗ |
| `implementation-planner` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `implementer` | **granted** | **granted** | ✗ | ✗ | ✗ |
| `test-writer` | **granted, test paths only** | **granted** | ✗ | ✗ | ✗ |
| `architecture-reviewer` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `plan-verifier` | ✗ | ✗ | ✗ | ✗ | ✗ |
| `doc-writer` | **granted, doc paths only** | ✗ | ✗ | ✗ | ✗ |
| `spec-creator` | **granted, spec paths only** | ✗ | ✗ | **granted — `researcher` only** | **granted — unverified** |

What each column costs:

- **`Write`, `Edit`.** For the four agents without them, *"cannot write a file"*
  is a missing tool, not a promise. For the four with them, the path scope is
  prose — see Known limits.
- **`Skill`.** Granted only where a *missing* injected body needs a mid-run
  fallback and the agent may act on it: `implementer` and `test-writer`.
  `architecture-reviewer`, `plan-verifier`, `doc-writer` and `spec-creator` fall
  back to a `Read` on `.claude/skills/<name>/SKILL.md` instead, as
  `implementation-planner` does. `researcher`
  cannot reach `/deep-research`.
- **`WebSearch`, `WebFetch`.** Only `researcher`. An external question is routed
  to it (`implementation-planner` via `## Open questions & recommendations`). One
  consequence worth naming:
  `doc-writer` therefore cannot open the live mermaid editor, so it reports every
  diagram's rendering as `not checked`.
- **`Task` / `Agent`.** Seven of the eight cannot spawn a subagent, so none of
  them can inherit a wider allowlist and bypass its own restrictions.
  **`spec-creator` is the single exception, and it is narrowed to
  `researcher`.** The reasoning: a spec is blocked far more often by not
  knowing what the system already does than by anything else, and the
  alternative is asking a human a question the repo could have answered.
  `researcher` is read-only *by allowlist* — no `Write`, no `Edit` — so this
  particular delegation cannot widen what the dispatch can change. That is the
  whole safety argument, and it holds only as long as the target stays
  `researcher`: the restriction to it is **prose**, and a `spec-creator` that
  dispatched `implementer` would have escaped its own write scope entirely.
  See Known limits.
- **`AskUserQuestion`.** `spec-creator` only, and its effect is **unverified** —
  see Known limits. The other seven have a stop-and-ask artefact instead, and
  `spec-creator` keeps one too, as the fallback for an unavailable tool.

`Bash` is granted to **all eight**, because `git log`, `git log -S`, `git blame`,
`rg` and `gh pr view` are most of what repo work is — and because three of them
have to run gates. Bash can write files, so the read-only agents each carry an
explicit prohibition **naming the constructs**: `>`, `>>`, heredocs, `tee`,
`sed -i`, `mv`/`cp`/`rm`/`mkdir`/`touch`, state-changing `git`, writing `gh`
calls, package managers and builds, `curl -o`. That list appears in
`researcher.md`, `implementation-planner.md`, `architecture-reviewer.md` and
`plan-verifier.md`.
`implementer.md`, `test-writer.md`, `doc-writer.md` and `spec-creator.md` carry
the command half of it plus their do-not-touch zones. `spec-creator` is the one
write-capable agent that also carries the **full** named-construct list, because
it runs no gates at all — nothing it legitimately does needs a shell to write.

Two deliberate carve-outs from that list, both narrow and both stated in the file
that holds them: `architecture-reviewer` may run `depcruise` (read-only,
deterministic, and the primary evidence in its own domain), and `plan-verifier`
may run **a Done-condition's command verbatim** — including `tsc`, `eslint` and
`vitest run` — because re-running one is the entire job. Neither carve-out
extends to `pnpm run`, an install, or anything needing Docker.

**Two prohibitions all eight agents repeat, both paid for already:** never
`pnpm run <script>` (a pre-script can shell out to `pnpm install` and, without a
TTY, purge `node_modules` — `server/INSIGHTS.md`, 2026-08-02 / 2026-08-04), and
never `next build` (it writes the same `client/.next` a running `next dev` owns
and corrupts it — `client/INSIGHTS.md`, 2026-08-03). Use the direct binaries
under `./node_modules/.bin/`.

One operational note: the `PreToolUse` hook in
[`../settings.json`](../settings.json) matches **`Bash`**, so `check-gate.sh`
forks on *every* shell call these agents make — and that is now **eight**
Bash-holding agents, not three. It only denies `gh pr create` / `gh pr merge` —
both already forbidden — so there is no functional clash, but it is a per-call
subprocess on Bash-heavy agents. Worth knowing before someone debugs a slow run.

## `skills:` — which bodies reach which agent

| Agent | Count | Which |
|---|---|---|
| `implementation-planner` | 11 | the full set below |
| `implementer` | 11 | the same eleven |
| `test-writer` | 3 | `react-testing-library`, `fastify-best-practices`, `typescript-expert` |
| `architecture-reviewer` | 2 | `onion-architecture`, `frontend-ui-architecture` |
| `spec-creator` | 4 | `product-ui-language`, `mermaid-diagram`, `onion-architecture`, `zod` |
| `doc-writer` | 1 | `mermaid-diagram` |
| `plan-verifier` | **0, deliberately** | — see below |
| `researcher` | none | no `skills:` field at all |

The eleven: `onion-architecture`, `frontend-ui-architecture`,
`fastify-best-practices`, `next-best-practices`, `react-best-practices`,
`react-testing-library`, `drizzle-orm-patterns`, `postgresql-table-design`,
`zod`, `typescript-expert`, `security`.

**`implementation-planner`'s and `implementer`'s lists are identical and must stay
identical.** The planner plans the implementation, so it has to hold every rule the
implementer will be held to — otherwise it writes tasks the implementer then has
to deviate from. Add a skill to one, add it to the other in the same commit.

**That pairing rule applies to those two only.** The other lists are deliberately
narrow, are not kept in sync with anything, and a skill added to
`implementation-planner`/`implementer` does **not** propagate to them. Each narrow list is
justified skill-by-skill inside its own agent file, including what was excluded
and why.

Three skills are deliberately excluded from `implementation-planner` and
`implementer`:
`engineering-insights` (the write half is the parent's), `pr-self-review` (a
later gate — but both agents read its `routing.md` and `gate.md` as **files**),
and `mermaid-diagram` (a plan is prose and tables — it goes to `doc-writer`
instead, where a document's contents are the point).

**`plan-verifier` declares no `skills:` at all, and that is the design.** Its job
is to check the plan's own items against the diff and re-run the plan's own
commands. An injected architectural rubric is a rubric it will apply, and the
moment it applies one it stops verifying items and starts writing a second,
worse `/pr-self-review` — substituting *"this route should use a repository"* for
*"R3: yes/no"*. An empty list is the cheapest possible enforcement of a scope
boundary. It reads `gate.md` and `routing.md` as files when it needs them.

`skills:` and the `Skill` tool are different mechanisms. `Skill` lets an agent
decide *mid-run* to load a skill. `skills:` loads the body **unconditionally at
startup**, before the agent has read anything — it costs context on every
dispatch, and in exchange the rule is in front of the model whether or not it
thought to go looking. For `implementation-planner`, which has no `Skill` tool, it
is the only
route.

Three things about it that are not obvious, all verified by a no-tools startup
self-check on both agents (2026-08-08 `implementation-planner`, 2026-08-10
`implementer`):

- **It works.** All eleven bodies come back quotable, with 0 tool calls.
- **Only `SKILL.md` is inlined.** Sibling detail files (`rules/*.md`,
  `references/*.md`, `layer-map.md`, `enforcement.md`, `examples.md`,
  `checklists.md`) are not — so `zod`, `fastify-best-practices`,
  `next-best-practices` and others arrive as *indexes*, meaning the agent holds
  the **rule names, not the rules**. **Every agent declaring `skills:` therefore
  carries a per-skill table of what is held vs. what needs a `Read`** — all five
  of them, for the same reason. Same gap applies to the `DDG-*` invariants, which
  live in `../skills/pr-self-review/routing.md` and are never in context.
- **Editing an agent file needs a full CLI restart.** `/clear` does not re-read
  `.claude/agents/`. Compare the process start time against these files' mtimes
  to tell whether the running build has the current definitions.

Cost, measured 2026-08-10 with `wc -w` over each `SKILL.md` body:

| Agent | Words injected per dispatch |
|---|---|
| `implementation-planner` | 15 025 |
| `implementer` | 15 025 |
| `test-writer` | 4 993 |
| `architecture-reviewer` | 2 798 |
| `spec-creator` | 4 375 |
| `doc-writer` | 1 121 |
| `plan-verifier` | 0 |
| **full eight-agent fan-out** | **43 337** |

Had every agent been handed all eleven, the same fan-out would cost **90 150** —
more than double, for rules most of them are forbidden to act on. **That
arithmetic, not taste, is why a narrow justified list is the default for a new
agent.**

`spec-creator`'s 4 375 is `product-ui-language` (1 082) + `mermaid-diagram`
(1 121) + `onion-architecture` (1 435) + `zod` (737). The third is the one that needs
defending, because it is the same skill the agent's own prose forbids it to act
on: it is loaded for **module-boundary** reasoning — may this module read that
table directly, which way may a call run — and explicitly **not** for placing
files, which is `architecture-reviewer`'s and `implementation-planner`'s. The
agent file carries that split as a rule; the skill list alone does not enforce
it. Two exclusions worth naming: `security` (1 962), because
`## Untrusted inputs` needs one rule and that rule is stated inline; and
`frontend-ui-architecture` (1 363), because `product-ui-language` already
supplies the half this agent may use — what a screen owes the user — without the
half it must not act on. `zod` (737) is in, cheaply, and for one section: every
contract here is a Zod schema, so *the shape a type must carry* is stated in
Zod's terms whether or not the syntax is written — and the agent still writes
none. `engineering-insights` (1 389) is **out**, on the same test: most of that
body is the *append* half, which this agent is forbidden to perform, and its
read protocol is already stated inline here in a more specific form. It is the
closest call in the set — the journals are the richest source of real edge cases
in the repo — and it is the first skill to add if `EC-n` entries start coming
back thin.

Of `implementation-planner`'s and `implementer`'s eleven, `postgresql-table-design` +
`react-testing-library` are 31.5% and carry no sibling files at all. Slimming
them into the `zod` shape is **deliberately deferred** — correctness does not
depend on it. Revisit only on a trigger: dispatches running 5–10 agents per
feature, or a twelfth entry in `skills:`. One addition to that ledger:
`react-testing-library` (2 557 words) is now `test-writer`'s single largest cost
too, which strengthens the case rather than triggering it.

## Frontmatter reference

Getting a field name wrong here raises no error — it produces an agent that
silently ignores the field.

| Field | Required | Values | Notes |
|---|---|---|---|
| `name` | yes | lowercase, digits, hyphens | must match the filename |
| `description` | yes | prose | when to dispatch, **and when not to** |
| `model` | yes | `inherit` \| `sonnet` \| `opus` \| `haiku` | |
| `color` | yes | `blue` `cyan` `green` `yellow` `magenta` `red` | **six values, eight agents** — two duplicates are now forced (`green`, `blue`), and a duplicate is silent rather than an error |
| `tools` | no | `Read, Grep, Bash` or `["Read","Grep"]` | **omitting it grants every tool** |
| `skills` | no | `onion-architecture, zod` | injects those skills' `SKILL.md` **bodies** at startup |

Three traps:

- **`tools:` is the agent field. `allowed-tools:` is the *skill* field.** The only
  other frontmatter in this repo is `../skills/pr-self-review/SKILL.md`, which
  uses `allowed-tools:` correctly — *for a skill*. Copying that key into an agent
  file yields an agent with `Write`, `Edit` and everything else, with no warning.
  For an agent whose whole point is that it cannot write, that one word is the
  entire safety design — and that now covers **four** agents whose allowlist is
  the boundary: `researcher`, `implementation-planner`, `architecture-reviewer`,
  `plan-verifier`,
  plus the two whose write access is deliberately scoped. Each of their
  Done-conditions greps for `^allowed-tools:` and treats **no output** as the
  pass.
- **`isolation: worktree` exists and is unusable here.** `git worktree` does not
  carry ignored files, `node_modules/` is ignored in all four packages, and these
  agents are forbidden from installing. An agent in a fresh worktree has no
  `tsc`, no `vitest`, no `eslint` — it could write code and not check it.
  Parallelism here comes from disjoint Owned paths and waves instead.
- **There is no documented `version:` field.** Version history lives at the bottom
  of this file.

Frontmatter schema verified against Claude Code's `plugin-dev:agent-development`
skill and the shipping agents beside it under
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/*/agents/`.

## Where each agent's rules come from

No agent invents a rule. Every constraint traces to a file in this repo or to a
named external source. This is the map of that grounding — the rule text stays
where it lives.

The two tables below are `implementation-planner`- and `implementer`-specific; the
other agents
follow, one paragraph each.

### Repo sources

| Source | What it supplies to `implementation-planner` / `implementer` |
|---|---|
| [`../skills/pr-self-review/gate.md`](../skills/pr-self-review/gate.md) | the canonical gate commands (verbatim, so a Done-condition is runnable); the direct-binary rule; the three zsh traps (`${PIPESTATUS[0]}` empty, no word-splitting on unquoted vars, missing `node_modules` ⇒ `gate did not run`); the `pass` / `fail` / `gate did not run` triple |
| [`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) | the `DDG-*` invariant IDs and severities both agents quote — `DDG-WIRE-001` static registration, `DDG-WIRE-002` ESM `.js` extension, `DDG-WIRE-003` schema ships its migration, `DDG-WIRE-004` port bound in `container.ts`, `DDG-DOC-001` `INSIGHTS.md` append-only, `DDG-DOC-005` a feature owes a spec. Read as a **file** — `skills:` would not preload it |
| [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) | the delegate-rather-than-duplicate framing, and why the implementer does not review its own diff |
| root [`../../CLAUDE.md`](../../CLAUDE.md) | the INSIGHTS receipt protocol; the do-not-touch zones; not-a-monorepo; static module registration; ESM `.js` extensions; docs-before-code order |
| `server/CLAUDE.md`, `client/CLAUDE.md`, `reviewer-core/CLAUDE.md`, `e2e/CLAUDE.md` | per-package rules, and the tie-break: a package `CLAUDE.md` and a `DDG-*` invariant **win over a general skill** |
| [`../../docs/specs-convention.md`](../../docs/specs-convention.md) | who may edit a spec at which `Status`, and therefore that **neither** of these two agents may — the `implementation-planner` reads one to source an `R<n>`, the `implementer` reads one to report a contradiction. Also that spec text reaches the reviewing model as untrusted, delimiter-wrapped data, so a spec never carries instructions to a reviewer |
| [`../../docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) | no invented vocabulary; **no count target** — zero tasks, zero deviations and zero findings are all valid answers |
| `server/src/vendor/shared/contracts/findings.ts` | the 0–1 `confidence` scale and the `CRITICAL` / `WARNING` / `SUGGESTION` severities — reused rather than re-invented |
| the four `INSIGHTS.md` journals | the hazards each agent quotes **by date at the point it binds**: `pnpm <script>` purging `node_modules` (server, 2026-08-02 / 04), `drizzle-kit generate` blocking on an interactive rename (server, 2026-08-06), `next build` corrupting a live `.next` (client, 2026-08-03), `e2e.sh` defaulting Postgres to `:5433` and colliding with a running stack (e2e, 2026-08-04) |
| [`../../.github/workflows/`](../../.github/workflows/) | the CI shape the gates mirror — notably the `.it.` filename path filter in `server-unit.yml`, which is why a hermetic test must not be named `*.it.test.ts` |
| [`../settings.json`](../settings.json) | the `PreToolUse` hook on `Bash`, and why `gh pr create` / `gh pr merge` are out of reach |
| the eleven skill bodies, via `skills:` | every architectural, framework, schema, typing and security rule a task is planned and built under — see the section above for what arrives and what still needs a `Read` |

### External source

- Anthropic, **"When to use multi-agent systems"** —
  <https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them>
  — retrieved 2026-01-23. Why the implementation-planner/implementer split is
  justified by
  **context isolation** — the plan as a self-contained artefact — rather than by
  division of labour. It is also why the plan must be relayed verbatim.

`researcher.md` additionally draws its report spine, its coverage block and
"empty is a good report" from `gate.md` Part 4; its `Evidence:` citation form and
"a symbol name outlives a line number" from
[`../skills/engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md);
and its `**Grounded in:**` list, `Author — Title — URL` reading-list form and
`## Disagreements` table from `../skills/onion-architecture/README.md` and
`../skills/frontend-ui-architecture/README.md`.

`test-writer.md` draws its suite map, its typological philosophy and the
`.it.test.ts` convention from [`../../TESTING.md`](../../TESTING.md); test
placement from `server/CLAUDE.md` (tests in `test/`, not colocated),
`client/CLAUDE.md` + `client/docs/feature-unit.md` (colocation, and the
`vitest.config.ts`-alias trap), and `e2e/CLAUDE.md` +
`e2e/docs/adding-a-flow.md` (deterministic locators, and that **every locator is
positive** — there is no "assert absent"); its invariants from `routing.md`'s
`TEST` section; and three hazards by date — `server/INSIGHTS.md` 2026-08-06 (a
whole-suite `vitest run` silently skips most `.it.test.ts` files),
`client/INSIGHTS.md` 2026-08-03 (`PRRow.test.tsx`'s providers), `e2e/INSIGHTS.md`
2026-08-04 (`e2e.sh` and `:5433`). Its one external source is the measured
finding that discarding failing tests during generation yields suites which pass
on broken code — <https://arxiv.org/html/2412.14137v1>, retrieved 2026-08-10 —
quoted because it is the evidence behind *never tune a test until it passes*.

`architecture-reviewer.md` draws its rules from `onion-architecture`'s `SKILL.md`
+ `layer-map.md` + `enforcement.md` (including the exception ledger and the
**0 errors, 18 warnings** baseline measured 2026-08-04, which is why it has a
"known drift, do not report as new" section at all),
`frontend-ui-architecture`'s `SKILL.md` + `references/devdigest-map.md`,
`routing.md` Part 2 (`DNT`, `WIRE`, `ARCH`, `UI`), and
`pr-self-review/SKILL.md` (the precision bar, and the
delegate-rather-than-duplicate table that keeps it out of `/pr-self-review`'s
lane). Its severities and 0–1 confidence come from
`server/src/vendor/shared/contracts/findings.ts`, reused rather than reinvented.
External: practitioner reviewer designs converge on *no citable location ⇒
downgrade or drop the finding* — <https://blog.cloudflare.com/ai-code-review/>,
retrieved 2026-08-10. No official source prescribes a severity taxonomy, which is
why this repo's own is reused.

`plan-verifier.md` draws its result vocabulary, its three zsh traps and the
pre-existing-debt rule from `gate.md`; what an `R<n>` and a Done-condition *are*
from [`implementation-planner.md`](implementation-planner.md); what
`## Deviations` and `## Blocked` mean in the
report it is checking from [`implementer.md`](implementer.md); and the no-count-target
rule from `docs/agent-prompts/README.md`. External, and load-bearing: the four
verification methods — `inspection` / `analysis` / `demonstration` / `test` — and
per-requirement traceability, via a secondary summary of ISO/IEC/IEEE 29148
(<https://www.reqview.com/blog/requirements-traceability-matrix/>; the standard
itself is paywalled and was not read); the Definition of Done as a binary that
returns an unmet item rather than marking it partly done
(<https://scrumguides.org/scrum-guide.html>); the documented reviewer-drift
failure modes it is built to resist — confirmation bias, decision fatigue,
rubber-stamping (<https://arxiv.org/html/2407.01407>); and staying in scope
(<https://google.github.io/eng-practices/review/reviewer/standard.html>). All
retrieved 2026-08-10. Its `yes (differently)` verdict has **no** standards
counterpart — the recognised statuses stop at pass / fail / partial — so it is
this repo's convention and is labelled as such in the file.

`doc-writer.md` draws its placement rules from
[`../../docs/specs-convention.md`](../../docs/specs-convention.md), the four
`<pkg>/docs/README.md` and three `<pkg>/specs/README.md`, and root `CLAUDE.md`
(the `e2e/specs/`-is-not-a-specs-directory exception, and the do-not-touch
zones); the reason `docs/agent-prompts/` is off-limits from that folder's own
README (the DB is the source of truth at run time); its diagram rules from
`mermaid-diagram`'s `SKILL.md` + `examples.md`; and the
check-the-bare-filename-citations rule from `server/INSIGHTS.md` 2026-08-04.
External: Diátaxis on not mixing document modes in one file
(<https://diataxis.fr/how-to-guides/>) — which is what the repo's own
`specs/` (reference) vs. `docs/` (explanation) split already implements; the C4
model on titles, keys and one abstraction level per diagram
(<https://c4model.com/diagrams/notation>, <https://c4model.com/abstractions>);
Mermaid's own docs, both for what they do **not** prescribe (no diagram-type
selection guidance) and for the **experimental** status of their C4 syntax, which
is why that syntax is forbidden (<https://mermaid.js.org/intro/>,
<https://mermaid.js.org/syntax/c4.html>); and Google's style guidance on timeless
documentation and on linking rather than duplicating
(<https://developers.google.com/style/timeless-documentation>,
<https://google.github.io/styleguide/docguide/best_practices.html>). All
retrieved 2026-08-10.

`spec-creator.md` draws the skeleton, the two-halves split, `Spec ID`, the
`Status` lifecycle and the EARS patterns from
[`../../docs/specs-convention.md`](../../docs/specs-convention.md), which it is
required to re-read on every dispatch because it is the authority and it moves;
placement from that file plus [`../../specs/README.md`](../../specs/README.md)
and the four `<pkg>/specs/README.md`; the `e2e/specs/`-is-not-a-specs-directory
exception, the do-not-touch zones and the INSIGHTS receipt protocol from root
`CLAUDE.md`; its ownership boundary from [`doc-writer.md`](doc-writer.md) — that
agent owns a spec from `Status: implemented` onward, this one owns it before;
what a delegated question may be, and which mode it belongs to, from
[`researcher.md`](researcher.md); the four verification methods from
[`plan-verifier.md`](plan-verifier.md), reused verbatim so a `Verify:` written
at spec time and a verdict recorded after the diff share one vocabulary;
`DDG-DOC-001`, `DDG-DOC-005` and `DDG-SEC-002` from `routing.md`; the required
screen states it checks a design against from `product-ui-language`'s
`SKILL.md`; the module-boundary half — and only that half — of
`onion-architecture`'s `SKILL.md`; and the two hazards by date,
`server/INSIGHTS.md` 2026-08-02 / 04 (`pnpm <script>`) and
`client/INSIGHTS.md` 2026-08-03 (`next build`).

External, and load-bearing: **EARS** — Alistair Mavin et al., *"Easy Approach to
Requirements Syntax (EARS)"*, IEEE International Requirements Engineering
Conference, 2009 — the five patterns (ubiquitous, `WHEN`, `WHILE`,
`IF … THEN`, `WHERE`) and the reason the syntax is constrained at all: each
criterion must collapse into one testable statement with no ambiguity about
trigger, state or response. The `shall`-only rule is EARS'; the
threshold-or-question rule, the six interrogation categories, the four
design-analysis findings, the WHAT/HOW table and the 17-item self-check are this
repo's, and are labelled as such in the file. The four verification methods and
per-requirement traceability come from ISO/IEC/IEEE 29148 (as described in
NASA's Systems Engineering Handbook), reached through `plan-verifier` rather
than independently — the standard itself is paywalled and was not read.

## Design decisions worth not re-litigating

**The planner plans `how`, and owns no part of `what`.** It was renamed from
`planner` to `implementation-planner` because the old name invited it to decide
the feature, and it did — the previous version planned the spec as a task and let
the implementer write it. Requirements now arrive agreed (from a human, or from
`spec-creator`), and the planner's own contribution to `what` is confined to two
places that cannot be mistaken for a decision: a `Source:` field marking any
requirement it inferred as `assumed default — confirm`, and
`## Open questions & recommendations`, where a better approach is offered as
advice while the plan still follows the requirements as given. The alternative —
a planner that quietly improves the requirements — produces a plan that is
internally consistent and answers a question nobody asked.

**The execution mode is the human's call, and the plan carries the question.**
Multi-agent and single-agent produce genuinely different plans (disjoint Owned
paths and waves versus one linear chain with tasks merged), so guessing wrong
costs a re-plan or a lost edit. The planner has no `AskUserQuestion` — none of
these agents does — so the question travels in `## Execution mode` with **both**
orderings already written out, and the parent relays it before dispatching an
implementer. Carrying both orderings is what makes the answer free.

**The implementer's verification is deliberately narrow.** *The package still
type-checks, and the tests that were already there still pass.* It does not judge
whether the design is right, the layering elegant, the coverage adequate, or
whether something nearby looks wrong — those are verdicts, they belong to
`/pr-self-review` and the review agents, and they are worth less coming from the
author who spent the run talking themselves into the choices. A test that was red
before the first edit is reported `pre-existing` and left alone; it does not
degrade the `Status`.

**The implementer blocks instead of redesigning.** A *mechanical* difference (the
plan said `helpers.ts`, the logic is one function in `service.ts`) is adapted and
recorded in `## Deviations`. A difference touching anything another person
reasoned about — a `vendor/shared` field, a column, a new port needing
`container.ts`, a file outside its Owned paths, a skill rule contradicting the
task — stops that task with `Status: blocked`. There is no channel back to the
implementation-planner, so a redesign made here is reviewed by nobody: blocking
costs one round
trip, a quiet redesign costs a diff that is green and wrong. Blocked on one task
does not stop the others.

**`plan-verifier` holds no skills on purpose.** An injected architectural rubric
is a rubric it will apply, and the moment it applies one it stops doing item-by-item
verification and starts writing a second, worse `/pr-self-review`. The empty
`skills:` is the enforcement; the prose only explains it. It is also the
counterexample to the assumption that more preloaded context makes a better
agent.

**`architecture-reviewer` reports and never fixes, and never records a verdict.**
It has no `Write`, so the verdict file is out of reach by allowlist rather than by
promise. The split matters because that file is what the `gh pr create` hook
reads, and two writers of one gate file is the fastest route to a false green.

**`spec-creator` cannot approve its own spec.** It writes `Status: draft`; only a
human moves it to `approved`. The rule is prose — the agent has `Edit` on the
file and could type the word — but it is the one prohibition in the set whose
violation is *cheap to detect*: `rg '^# Spec:.*Status: approved' specs/ */specs/`
against the diff, with `git log` saying no human touched it. It exists because
`approved` is the only signal that a person agreed to the acceptance criteria,
and a criterion nobody agreed to still gets planned, built, tested and reviewed
as though someone had.

**`spec-creator`'s hard line is WHAT vs HOW, and it is drawn as a two-column
table rather than as a principle.** "Avoid implementation detail" is the wrong
rule — a spec that will not name a payload field is useless, and a required
contract change is genuinely a requirement because the client cannot render what
the payload does not hold. The workable test is *would a competent team be free
to build this differently and still satisfy the criterion?* The table lists what
may be specified (data shapes crossing a boundary, workflows, which modules
interact and in which direction, contracts, thresholds, observable states)
against what may not (files, folders, layers, wiring, migrations, mechanisms,
and every task, wave and owned path — those are `implementation-planner`'s).
A load-bearing HOW detail becomes a `## Non-functional` constraint or a
recommendation to the planner, never a criterion.

**A missing threshold is an open question, not a default.** The agent is told
never to invent a number and write it as a requirement. This is the single
highest-value rule in the file: an invented `p95 < 200 ms` or `top 50 results`
is indistinguishable, downstream, from one a human chose — the planner plans to
it, the implementer builds it, the test-writer asserts it, and
`/pr-self-review` confirms the diff matches. Four agents then agree on a number
that came from nowhere.

**`test-writer` blocks rather than touching the code under test.** The failure
mode it exists to prevent is measured, not hypothetical: LLM test generators that
discard failing tests produce suites where up to 68% pass on an incorrect
implementation and fail on the correct one. An agent that may edit the subject
will eventually edit the subject, so the rule is a prohibition with a named
consequence rather than a preference.

## Adding an agent

1. `name` matches the filename; both lowercase-with-hyphens.
2. **Write the allowlist first, then the prose.** If a rule can be enforced by
   omitting a tool, omit the tool and say so here rather than asking the model to
   behave.
3. `description` says when to dispatch **and when not to** — see `pr-self-review`'s
   description for the house shape.
4. **Reuse existing vocabulary.** This repo already has `CRITICAL` / `WARNING` /
   `SUGGESTION`, `request_changes` / `approve` / `comment`, a 0–1 `confidence`,
   `pass` / `fail` / `gate did not run`, `absent` / `not checked`, and
   `complete` / `partial` / `blocked`. A second scale is the fastest way to make
   an artefact untrusted.
5. No "return at most N findings" quota — models treat it as a target and pad.
   Zero is a valid answer (`docs/agent-prompts/README.md`).
6. Give it the INSIGHTS read protocol and a stop-and-ask artefact with a
   first line that cannot be confused with its normal one.
7. **Update every place in this file that describes the set** — not just the
   catalog. All of them: the Catalog, Inputs and outputs, Recognising the output,
   the pipeline diagram, Who answers which question, the Permissions matrix
   **and the paragraphs after it**, the `skills:` per-agent table **and its cost
   arithmetic**, a rules-provenance paragraph, Known limits, and Versions. A row
   added to one table and missed in five leaves a README that is confidently
   wrong. The hardest ones to spot are the sentences carrying the agent **count**
   in prose — `rg -n 'seven|eight|all (five|six|seven|eight)|write-capable'` over
   this file before calling it done.
8. **Restart the CLI**, then confirm with a no-tools self-check that the agent
   sees what you think it sees.
9. **Justify the `skills:` list skill by skill, and prefer the narrowest list
   that works** — including what you excluded and why. The full eight-agent
   fan-out costs 43 337 words of injected body; handing every agent all eleven
   would cost 90 150. A skill an agent is forbidden to act on is pure cost, and
   worse than cost when it hands the agent a rubric outside its lane.

## Provenance and limits

Authored in this repo. Agents have no upstream and do not belong in
`skills-lock.json`, which pins vendored skills by hash — the same status as
`engineering-insights`, `onion-architecture`, `frontend-ui-architecture` and
`pr-self-review`.

Known limits:

- **The tool allowlist is the only real enforcement.** Everything in the Bash
  prohibitions is prose a model can violate. It is written as a named list of
  constructs rather than a principle so that a violation is *obvious in the
  transcript* — not so that it is impossible.
- **`implementer` has `Write` and `Edit`, which moves most of its safety into
  prose.** `DDG-DOC-001`, both `vendor/shared` copies, `vendor/ui/`,
  `db/migrations/`, the lockfiles and the Owned-paths boundary are rules the model
  follows or does not. The transcript and `git status --short` are the audit;
  there is no gate.
- **The largest failure mode is an implementer that quietly redesigns.** The
  mechanical/structural line is drawn, but a violation surfaces only in a
  `## Deviations` section the model writes itself. One that both diverged and
  omitted the line is invisible until `/pr-self-review` reads the diff.
- **`skills:` costs context unconditionally** — 15 025 words per dispatch,
  including the skills the task does not need. That is the trade. If a dispatch
  starts running out of room, the honest fix is a narrower per-agent `skills:`
  list, not a quieter agent.
- **A wrong `skills:` field name fails silently**, and eleven skills that never
  arrived look exactly like eleven the model chose not to mention. Both agents
  carry a fallback instruction, and the startup self-check is the only real
  verification — re-run it after any edit, and after any CLI restart.
- **A *new* agent file is discovered mid-session; an *edit* to one is not.**
  Observed 2026-08-17: `spec-creator.md` was created two hours into a running
  session and appeared in the dispatchable agent list without a restart — but a
  later edit to its `tools:` line did not take, and the dispatch ran the
  definition as first discovered. The two halves fail differently and only one
  of them is loud: a missing agent is an error, a **stale** agent runs happily
  and produces a plausible report against rules you have already changed. Check
  the process start time against the file mtime (`ls -lT`) before trusting any
  behavioural test of an edited agent, and re-run it after a full restart.
- **`spec-creator`'s `AskUserQuestion` is declared but not yet verified.** It is
  the only agent in the set granted the tool, on the grounds that closing
  ambiguity before code is written is the whole job. Whether a subagent's
  `AskUserQuestion` actually reaches a human here is **unproven** — the first
  test hit the stale-definition trap above. The agent file carries a fallback
  (an unavailable tool must produce the clarification artefact plus a
  `## Deviations` line, never a silent default), because this is the one tool
  whose failure is invisible: an agent that cannot ask looks exactly like an
  agent with no questions. Until a post-restart test confirms it, treat the
  sentence *"A subagent has no channel to a person — no `AskUserQuestion`"*
  above as describing the other seven agents.
- **`spec-creator` can spawn `researcher`, and only prose says so.** The
  allowlist grants `Agent`, not `Agent(researcher)` — the harness has no such
  form. The safety argument (a read-only target cannot widen the dispatch) is
  sound but is enforced by a sentence, and it is the one prohibition in the set
  whose violation would be *invisible in the diff* rather than merely
  unenforced: a `spec-creator` that dispatched a write-capable agent leaves the
  same clean `git status` either way. The transcript is the only audit. Worth an
  eval before it is worth anything else.
- **A fan-out from inside a subagent has no wave discipline.** Two or three
  researchers are read-only so they cannot collide on a path, but nothing caps
  the total, and a `spec-creator` that decides it needs eight will spend eight
  model runs before the parent sees a single line. The ceiling — two or three,
  and a bigger number means the request is underspecified — is prose in the
  agent file.
- **The 17-item self-check is self-graded.** Items 6 and 17 are commands whose
  output the agent pastes; the other fifteen are judgements it makes about its
  own file, reported by the same model that wrote it. That is strictly better
  than nothing — a named list is harder to skip than a vague instruction to
  check your work — but a `pass` is a claim, not evidence. The two command items
  exist because they are the two that can be made into evidence cheaply.
- **`isolation: worktree` is unusable**, for the `node_modules` reason above.
  Parallelism costs a scheduling discipline instead of being free.
- **`Skill` gives `implementer` skills that declare their own
  `allowed-tools: Write, Edit`** (`drizzle-orm-patterns`). That does not widen its
  allowlist, but skill text does arrive in a context that can write.
- **`test-writer` and `doc-writer` have `Write`/`Edit`, so their path scopes are
  prose too.** A test-writer editing production source, or a doc-writer editing a
  `CLAUDE.md`, is a rule the model follows or does not.
  `git status --short --untracked-files=all` is the audit; there is no gate.
- **Four write-capable agents can still be dispatched at overlapping paths.**
  `implementer` writes tests by its own definition, and `test-writer` owns those
  same paths. Owned paths are the only arbitration and nothing enforces them —
  two dispatches in one wave at one path is a lost edit. The
  `spec-creator` / `doc-writer` overlap has one extra guard the others do not:
  the split is by the spec's own `Status` field, so a collision is at least
  *visible in the file*. It is still prose. **`specs/**` is no longer contested
  by three agents**: `implementation-planner` cannot write at all,
  `implementer` is now forbidden there in prose, and only `spec-creator` and
  `doc-writer` remain — which is the point of the change, and also the one part
  of it a `Write` from a mis-prompted implementer could still violate silently.
- **Nothing makes the parent relay the execution-mode question.** The plan is a
  message; a parent that reads `## Execution mode`, sees a recommendation and
  dispatches on it has silently answered on the human's behalf, and the plan
  still looks complete. Same failure shape as the missing-`INSIGHTS`-receipt rule
  above, and the same fix — the parent is the only check.
- **`assumed default — confirm` is a label, not a gate.** A requirement the
  planner inferred is planned, built, verified and reviewed exactly like an agreed
  one; the label only makes it *findable*
  (`rg 'assumed default — confirm'` over the plan). It is a cheaper version of the
  same trade `spec-creator`'s never-invent-a-threshold rule makes, and it fails
  the same way: silently, if nobody reads the field.
- **`Status` is the boundary between two agents and nothing validates it.**
  Neither the `draft → approved` promotion nor the `approved → implemented` flip
  is checked by a gate; a spec with a `Status` line nobody updated silently
  reassigns the file's owner. Worth an eval before it is worth a hook.
- **`spec-creator` cannot see a design.** No MCP tools, so no Figma; and a
  subagent does not inherit the parent's chat images, so a pasted screenshot is
  invisible to it. Every design reaches it as a **file path the parent saved**,
  which means a dispatch that says "see the mock above" gets a spec derived from
  code alone — and the agent is told to raise that as a clarification rather
  than proceed quietly. The manual save step is the weak link.
- **`plan-verifier` re-runs commands the plan wrote.** A plan with a wrong
  Done-condition earns a green verification of the wrong thing. It checks that the
  command ran, not that it was the right command — the mismatch surfaces only if
  it thinks to flag it under `## For the parent`.
- **`architecture-reviewer`'s known-drift list is a copy of a moving target.** If
  it falls out of date with `enforcement.md`, the agent starts reporting eighteen
  findings that are already on a burn-down list — and an agent that always finds
  something stops being read.
- **`doc-writer` cannot render a mermaid diagram.** No `WebFetch`, and `mmdc` is
  not a dependency of any package, so every diagram ships `not checked`. A
  syntactically broken diagram reaches the reader.
- **The colour palette is exhausted.** Six values, eight agents. `test-writer`
  shares `green` with `implementer` (both write-capable code agents) and
  `spec-creator` shares `blue` with `implementation-planner` (both turn a change
  request into a
  numbered upstream artefact, and they sit next to each other in the chain).
  Both duplicates are deliberate and both are silent rather than an error; a
  ninth agent will duplicate too.
- **`model: opus` on `implementer` is a lever, not a doctrine.** The common
  convention is Opus to plan, Sonnet to implement, and with skills preloaded and
  every task carrying Owned paths and a Done-condition, most of the work is
  mechanical. It is `opus` because `DDG-WIRE-002` (ESM `.js` extension) and
  `DDG-WIRE-004` (a port bound in `container.ts`) are both CRITICAL and both
  invisible to `tsc --noEmit`. First knob to turn if the cost bites. **That now
  covers five opus agents** — `test-writer`, `architecture-reviewer` and
  `plan-verifier` too, each carrying its own justification and its own
  "sonnet is the knob" note in-file. Whether to turn one is a cost decision, not
  a correctness one.
- **`model: sonnet` is pinned on `researcher` and `doc-writer`, not inherited.** A
  parent running Opus gets Sonnet research and Sonnet documentation. That is the
  intent — breadth-first searching and prose-from-supplied-material are the jobs,
  and a doc in the wrong folder is cheap to move. Escalate `doc-writer` only if
  placement decisions start coming back wrong. A question needing deep reasoning
  over a large body of code is still better answered by the parent directly.
- **`model:` omitted would mean `inherit`, not a safe default.** Every agent here
  pins it deliberately; an agent added without the field silently runs on whatever
  the parent is using.
- **Nothing validates any report's format.** No schema, no gate, no eval. The
  parent reading it is the only check, including the missing-receipt rule above.
  The first eval worth writing is the negative one: a question whose answer
  genuinely is not in this repo must come back with an empty `## Conclusions` and
  honest `absent` lines — an agent that always finds something stops being
  informative. The second is the clarification gate on a bare topic. Four more
  are now worth writing, none of them yet written: (3) `architecture-reviewer` on
  a clean tree must return an empty findings list and must **not** report the 18
  known `depcruise` warnings; (4) `plan-verifier` given a plan whose `R3` is
  genuinely unmet must return `no` with a locator, not a paragraph of advice;
  (5) `test-writer` given a DB-backed target must produce a `*.it.test.ts`
  filename; (6) `doc-writer` handed an `INSIGHTS`-shaped finding must route it to
  `## For the parent` and write no journal; (7) `spec-creator` given a request
  containing "should be fast" must return an open question with a proposed
  default, **not** an invented threshold, and must write `Status: draft`;
  (8) `spec-creator` given a feature touching `client` and `server` must write
  **one** file in root `specs/`, not a pair. Follow the hand-scored rubric
  convention in `../skills/engineering-insights/evals/`.
- **Agent files are still `unrouted` in `/pr-self-review`.**
  `../skills/pr-self-review/routing.md` Part 1 has a row for `.claude/skills/**`
  and none for `.claude/agents/**`, so all eight agent files are reviewed against
  "the nearest package `CLAUDE.md`". Routing rule 1 there says twice-unrouted
  earns a row; this is now the **third** occasion. Root `specs/**` was added to
  that table in the same change that added this agent — `*/specs/**` does not
  match a top-level directory — but `.claude/agents/**` was again left out.
- **Seven features still have a `client/` + `server/` spec pair.** The
  cross-module rule now says one file in root `specs/`; `smart-diff`,
  `blast-radius`, `intent-layer`, `findings-severity`, `conventions-extractor`,
  `prior-prs` and `skills` predate it and were not migrated. Two placement rules
  are in flight until they are, and `spec-creator` amending one of those
  features will have to pick a side.
- **Confidence is model output.** The `How to check:` requirement at ≥0.8 makes an
  unfounded high-confidence claim cheap to disprove, not impossible to make.
- **No caching.** Two dispatches on the same question repeat the same searches.

## Versions

| Date | Change |
|---|---|
| 2026-08-08 | First agent. `researcher` — two research modes, shared report spine, clarification path, `sonnet`, no write tools, no `Skill` / `Task`. |
| 2026-08-08 | `planner` + `implementer`. Read-only planner, write-capable implementer, the plan as the only handoff. Eleven skills injected into both via `skills:`. Parallelism by disjoint Owned paths and waves — `isolation: worktree` rejected, `node_modules` is not carried into a worktree. Implementer verifies one thing: the existing tests still pass. Both `opus`, both without `Task`. |
| 2026-08-10 | Both `skills:` agents gained a "your skills are loaded — their reference files are not" section, after a no-tools self-check confirmed injection works but inlines `SKILL.md` only. This README reshaped into a map: inputs/outputs per agent, a permissions matrix, and the grounding sources for `planner` and `implementer` broken out. |
| 2026-08-17 | `spec-creator`, round two. Gains `Agent` — **the first and only exception** to the no-subagent rule, narrowed to read-only `researcher` (and `Explore` for a locations-only sweep), fanned out in one message so independent questions run concurrently. Gains `AskUserQuestion` (unverified) and a three-route clarify-first rule. Gains a `## WHAT, not HOW` two-column table, a scoped read protocol — journals only for packages in scope, with a `not read` receipt for the rest — and a 17-item final self-check, two of whose items are commands whose output is pasted. `zod` joins `skills:` for `## Contracts` only; `engineering-insights` stays out and the call is recorded. The convention gains `Cross-module interactions`, `Contracts`, `Traceability`, `EC-n` ids, a `Verify:` method per criterion reusing `plan-verifier`'s four ISO 29148 words plus a one-line observable, and a `Non-functional` table that takes latency budgets, caps, rate limits and WCAG levels instead of adjectives. |
| 2026-08-17 | `spec-creator` (`opus`, `blue` — a second forced duplicate, shared with `implementation-planner`), taking the set to eight. Writes the spec **before** the code, at the head of the pipeline: six fixed interrogation categories, four design-analysis findings, EARS acceptance criteria with `AC-n` IDs. Two rules carry most of its value and both are prose — it may not write `Status: approved`, and it may not invent a threshold. Its write scope is one spec file plus one index row; `skills:` is `product-ui-language` + `mermaid-diagram` (2 203 words), with `security` excluded and the reason recorded. Shipped with a reshaped `docs/specs-convention.md` — the EARS skeleton merged into the existing one, `Spec ID`, a four-value `Status` that also decides file ownership, and `Acceptance criteria (EARS)` replacing `Behaviour` — plus a new root `specs/` for cross-module features (`specs/README.md`), a `routing.md` row for it, and the `spec-creator` / `doc-writer` boundary written into both agent files. |
| 2026-08-10 | Four agents, taking the set to seven. `test-writer` (`opus`, `green` — a forced duplicate, the palette holds six values) writes only inside test paths; `doc-writer` (`sonnet`, `magenta`) only inside doc paths. `architecture-reviewer` (`opus`, `red`) and `plan-verifier` (`opus`, `yellow`) are read-only by allowlist and carry the full named-construct prohibition. `plan-verifier` declares **no** `skills:` as a design choice — a rubric it holds is a rubric it applies. Narrow justified `skills:` lists become the default: full fan-out costs 38 962 injected words instead of 75 125. Permissions matrix transposed to agent-per-row. Four external practice sets cited in the provenance section — subagent design, LLM-generated-test failure modes, requirements verification, and documentation/diagram conventions. |
| 2026-08-17 | `planner` → **`implementation-planner`**, and the artefact `Development Plan` → **`Implementation Plan`**. The agent now plans **how**, never **what**: a new `## You do NOT own the specification` section forbids writing, amending or *planning* a spec, ticket or acceptance criterion, and the plan's `## Specs` section is gone. Two mandatory steps run before any planning — **Step 1, verify the requirements** (restate each as an `R<n>` with a `Source:` of a spec `AC-n`, the dispatch, or `assumed default — confirm`; find gaps as numbered questions with defaults; recommend a cleaner/safer/cheaper route as advice, never as an edit) and **Step 2, ask the execution mode** (`multi-agent` waves versus a `single-agent` linear pass, recommended-but-confirmed, with both orderings written out so the answer is free). New sections: `## Execution mode`, `Requirements (verified)`, `## Open questions & recommendations`, and a `## Red-flags check` the agent runs before returning. Spec ownership now stops at two agents: `implementer` lost its spec-writing step entirely (`specs/**` added to its do-not-touch list, a contradiction goes to `## For the parent`), leaving `spec-creator` before the code and `doc-writer` after it — recorded in `docs/specs-convention.md` too. References updated in `implementer.md`, `plan-verifier.md` (whose `## Requirements` table gained a `Source` column), `doc-writer.md`, `spec-creator.md` and `test-writer.md`. |
