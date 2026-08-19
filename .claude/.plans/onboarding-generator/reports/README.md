# SDD pipeline run — SPEC-02, Onboarding Generator

This directory is the artefact trail of **one** Spec-Driven Development run: the feature was
specified, planned, cross-model reviewed, built across six implementer waves, tested and
reviewed, and each stage left its own report here. The files are named in the order the
stages ran, so reading them top to bottom is reading the run. Each report is the agent's
own verdict in its own words — including its deviations, its `not done` list and, in one
case, its own near-miss with `git checkout` — because a report that records only successes
is not evidence of anything.

The one thing the reports do **not** carry on their own is independent confirmation. The
parent re-ran every wave's Done-conditions itself before dispatching the next wave, rather
than taking an implementer's green line on trust; where that happened, the confirmation is
appended to the bottom of the report under a *Parent's independent re-run* heading. So a
green line in an implementer report is never the only evidence behind it.

The plan these reports execute is [`../plan.md`](../plan.md); the requirements they trace to
are [`specs/onboarding-generator.md`](../../../../specs/onboarding-generator.md).

## Index

| File | Stage | Agent | Model | Outcome |
|---|---|---|---|---|
| [`stage1-spec-creator.md`](stage1-spec-creator.md) | 1 — specify | `spec-creator` | default | SPEC-02 written: 47 EARS criteria, 29 edge cases, 15 design findings. Four blocking questions returned to the human; all fourteen closed on a second dispatch |
| [`stage2-cross-model-review.md`](stage2-cross-model-review.md) | 2 — review the plan | two `general-purpose` reviewers | **Sonnet** (the plan was written by Opus) | 1 CRITICAL, 9 WARNING, 3 SUGGESTION across both. Thirteen edits applied to `plan.md`; no reviewer premise was disproved |
| [`stage3-wave1-t1.md`](stage3-wave1-t1.md) | 3 — build | `implementer` | default | The eight contract types, byte-identical in both `vendor/shared` copies |
| [`stage3-wave2-t2.md`](stage3-wave2-t2.md) | 3 — build | `implementer` | default | Fourteen `onboarding` columns + migration `0018`; no `DROP`, no `ALTER COLUMN` |
| [`stage3-wave2-t3.md`](stage3-wave2-t3.md) | 3 — build | `implementer` | default | Nav entry, the `activeKeyFor` collision fix, and the whole message namespace |
| [`stage3-wave3-t4.md`](stage3-wave3-t4.md) | 3 — build | `implementer` | default | `getFileFacts` on the facade; a `match` predicate on the confined walk, default behaviour unchanged |
| [`stage3-wave3-t5.md`](stage3-wave3-t5.md) | 3 — build | `implementer` | default | `DocumentMarkdown` promoted to `src/components/`; `MermaidDiagram` gains a `fallback` |
| [`stage3-wave4-t6.md`](stage3-wave4-t6.md) | 3 — build | `implementer` | default | The deterministic layer: facts, ranked paths, chains, declared commands — nothing executed |
| [`stage3-wave4-t7.md`](stage3-wave4-t7.md) | 3 — build | `implementer` | default | Client data layer: the polling query, the body-less mutation, the reason map with its default |
| [`stage3-wave5-t8.md`](stage3-wave5-t8.md) | 3 — build | `implementer` | default | The server module — 25 criteria. One bounded call, grounded, priced, registered |
| [`stage3-wave5-t9.md`](stage3-wave5-t9.md) | 3 — build | `implementer` | default | The tour section card |
| [`stage3-wave6-t10.md`](stage3-wave6-t10.md) | 3 — build | `implementer` | default | The screen and its 16-line route entry. Full-tree verification and the applied migration are recorded at the end |
| [`stage4-architecture-reviewer.md`](stage4-architecture-reviewer.md) | 4 — review the code | `architecture-reviewer` | default | **0 CRITICAL, 1 WARNING, 0 SUGGESTION.** `depcruise` baseline verified line-for-line against the parent commit: zero new violations |
| [`stage4-test-writer.md`](stage4-test-writer.md) | 4 — test | `test-writer` | default | Nine test files from the criteria, not from the code. Server 563 → 618, client 353 → 388, each key assertion proved failable by mutation |

## What each stage was committed as

| Stage | Commit |
|---|---|
| 1 — the spec | `cb5226b`, then `e2cd58c` for the human's approval |
| 2 — the plan | `a64a1b0` |
| 3 — the code | `401e8d6` |
| 4 — tests and reviews | see the commit that carries these reports |
