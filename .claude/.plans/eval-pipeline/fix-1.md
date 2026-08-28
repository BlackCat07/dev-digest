# Fix plan 1 — the feature forgot about skills

Round 1 of ≤2. Two findings, one underlying gap: **the eval pipeline treats an agent as a
(prompt, model) pair, and an agent is also its linked skills.**

Both were surfaced by Phase 3 and both were verified against the spec's own text before landing
here. `F2` (AC-47's skip-reason enum) is **deferred by the user's decision** — it needs a
`vendor/shared` change in both copies and is recorded in `run.md` as an accepted gap.

## F1 — the eval replay carries no skill bodies, so one of three stated levers is dead

**Source:** `architecture-reviewer` raised it as a non-boundary observation; I verified the
functional consequence.

| | real review (`modules/reviews/run-executor.ts`) | eval replay (`modules/eval/runner.ts`) |
|---|---|---|
| system prompt | yes | yes, from the batch snapshot |
| model | yes | yes, from the batch snapshot |
| **skill bodies** | yes — `resolveSkills(agent.id)` → `skills: bodies` | **no** |

`run-executor.ts:307-350` resolves the agent's enabled skills through the skills service and
spreads them onto `ReviewInput` omit-when-empty. `runner.ts`'s call passes `systemPrompt`, `model`,
`diff`, `llm`, `maxRetries: 0`, `sessionId` — and nothing else. `grep -an 'skills'` over
`modules/eval/runner.ts` and `service.ts` returns **zero lines**.

Consequence: editing a linked skill cannot move recall, precision or citation accuracy. The
homework's framing is *"changed a system prompt, a model **or a linked skill** → ran the evals →
saw in numbers whether the agent got better or worse"*, and the spec's opening sentence repeats it.
Two of the three levers work.

**Not the implementer's error.** AC-21 says verbatim that a case is replayed *"with the batch's
snapshotted prompt and model"*. `runner.ts` satisfies AC-21 exactly. The divergence is between the
criterion and the feature's purpose, and it is in the spec.

**Decision taken (user):** the replay carries the agent's **current** linked skills, resolved
through the same service the real review path uses. Not the version snapshot's — `agent_versions
.config_json.skills` stores skill **ids with no version numbers**, so a strictly reproducible
replay of an old batch is already impossible by schema, and "the skills as linked right now" is
exactly what makes the lever work: change a skill, run, watch the number move.

## F3 — promotion does not restore the promoted version's skill links

**Source:** T10 found it; `plan-verifier` graded R14 `partial` and corrected my framing.

I had put this to the user as "a question about intent". **The verifier showed the spec already
answers it.** `specs/eval-pipeline.md`, `## Problem & why`: `agent_versions` is *"an immutable
per-agent snapshot of provider, model, `system_prompt`, output schema, strategy, `ci_fail_on`,
repo-intel settings **and ordered skill ids**"*. So AC-43's *"that version's stored config"*
includes the skill ids by the spec's own definition, and

> **AC-43** — WHEN the user promotes a stored agent version, the system **shall** write that
> version's stored config onto the agent as a **new** version whose number is higher than every
> existing one.

is **not met**: `AgentsRepository.update`'s patch has no skills field and `snapshotVersion`
re-reads `skillIdsForAgent(row.id)` — the agent's *current* links — so promoting v6 while v7 is
current yields a v8 whose `config.skills` is v7's set. Prompt, model and strategy restore
correctly. Evidence: `server/src/modules/agents/repository.ts:148-149`,
`server/src/modules/agents/service.ts:118` (whose own doc-comment admits it).

## Tasks

### FT1 — the eval replay carries the agent's current skills
Satisfies: F1
Owned paths: `server/src/modules/eval/types.ts`, `server/src/modules/eval/runner.ts`,
`server/src/platform/container.ts`, `server/test/eval-runner.test.ts`
Forbidden: `modules/eval/{service,repository,helpers,constants,schemas,routes}.ts`,
`modules/reviews/**`, `reviewer-core/**`, `modules/skills/**`, both `vendor/shared` copies

Change: one new consumer-declared port in `types.ts` — a skills source exposing the one method
this module reads, mirroring the shape `container.skills` already offers
(`resolveBodiesForAgent(agentId)`); `container.ts` satisfies it from the existing
`get skills()` service, which is already exposed as a service rather than a repository precisely
because the cross-module need applies rules; `runner.ts` resolves the bodies once per **batch**
(not per case — the set shares one agent and one config) and spreads them onto `ReviewInput`
**omit-when-empty**, matching `run-executor.ts:350` exactly:
`...(bodies.length ? { skills: bodies } : {})`.

The omit-when-empty spread is load-bearing, not cosmetic: `run-executor.ts`'s own comment records
that an agent with no enabled skills must produce a **byte-identical prompt** to one where the
field is absent. Break that and every batch recorded before this fix becomes incomparable to every
batch after it, which is the one thing a regression harness may not do.

Constraints that still bind: no `node:` specifier, no sibling-module import (declare the fields you
read — `import type` does **not** exempt you from `no-cross-module-internals`, measured 22 → 24),
no Row type in a port signature, and the engine still gains no eval-specific parameter.

Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json   # 16 = baseline
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' eval-runner
cd server && CI=true ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src | tail -2        # 0 errors, 22 warnings
cd server && grep -arnE "^import .* from 'node:" src/modules/eval/          # 0 lines
cd server && grep -arnE "from '\.\./[a-z_-]+/" src/modules/eval/            # 0 lines
cd server && grep -an "skills" src/modules/eval/runner.ts                    # non-empty now
```

Tests, `Owner: implementer`: a batch whose agent has two enabled skills passes both bodies, in link
order, on **every** case's call; an agent with none passes **no** `skills` key at all (assert the
key's absence, not an empty array); the bodies are resolved **once per batch**, not once per case
(assert the port's call count is 1 for a four-case batch).

### FT2 — promotion restores the promoted version's skill links
Satisfies: F3, AC-43
Owned paths: `server/src/modules/agents/service.ts`, `server/test/agents-promote.test.ts`
Forbidden: `server/src/modules/agents/repository.ts` (reuse `update` and `setSkills`, reshape
neither), `modules/agents/routes.ts`, `modules/agents/helpers.ts`

Change: `promoteAgentVersion` sets the version's stored skill ids alongside the config, so the
resulting version's snapshot carries v6's ordered ids rather than the current set. `setSkills`
validates every id against the workspace, so a skill deleted since the snapshot is a real failure
mode: **decide it and say which** — the honest reading is that promotion of a version naming a
skill that no longer exists is refused with a named reason rather than silently promoting a
different config, because a promote that quietly drops a skill is exactly the lie AC-43 exists to
prevent. Extend the port in that file; do not widen the contract.

Ordering matters: the snapshot is taken by `update`, so the links must be in place **before** it
runs, or the new version records the old set again and the fix is invisible.

Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' agents-promote
cd server && CI=true ./node_modules/.bin/eslint "src/modules/agents/service.ts" "test/agents-promote.test.ts"
```

Tests, `Owner: implementer`: promoting v6 while v7 is current produces v8 whose `config.skills`
equals **v6's** ordered ids, not v7's; no existing `agent_versions` row is mutated; a version
naming a skill absent from the workspace is refused with a named reason and leaves the agent
untouched.

## Waves

Both tasks are `server/`, and FT2 touches `agents/service.ts` while FT1 touches
`platform/container.ts` — disjoint paths, but a whole-package `tsc` is each one's Done-condition,
so they run **sequentially**: FT1, then FT2.

## Not in this round

**F2 / AC-47** — `EvalRunAllResult.skipped[].reason` cannot express "this agent already has a batch
in flight", so `runAllAgents` returns the in-flight batch in `created` instead of naming it a skip.
Deferred by the user: it needs a third enum member in **both** `vendor/shared` copies, which is a
contract change and a human agreement. Recorded as an accepted gap; `plan-verifier` graded R15
`partial` on this and corrected the criterion number from AC-48 to **AC-47** (AC-48 is the period
filter and is fully met).
