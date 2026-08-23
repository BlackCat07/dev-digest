# evals — engineering insights

Append-only journal for `@devdigest/evals`. Seven fixed sections; newest entry at the bottom
of its section.

**Relationship to `README.md`:** this file is the inbox — one-off, file-grounded observations.
`README.md` holds what has stabilised into a documented rule of the package. When the same
insight costs a second mistake, promote a one-line version into `README.md` and leave the entry
here as the record of how it was found.

**Reading this file:** if every section below reads "no entries yet", that is the real state —
report `0 entries` rather than treating it as a failed load.

Note: an insight here is usually about the **Claude Agent SDK or the measurement**, not about
DevDigest's product code. Say which, because the SDK facts apply to any future code in this repo
that opens an agent session, not just to evals.

## Rules

- **Append only.** Never edit or delete an existing entry, never rewrite this file.
  Superseded? Append a new bullet that says so and name the date it replaces.
- **Never `Write` this file** — the `Write` tool replaces it wholesale and destroys every prior
  entry. Append with an anchored `Edit` on the target section's `<!-- append below -->` marker.
- **File-grounded.** Every entry names a real path, and a line or symbol where useful.
- **Non-duplicate.** Re-read this file before recording; skip anything already here or already
  stated in `README.md` / the root `CLAUDE.md`.
- **Substantial.** Record what cost real time or would mislead the next reader. Not: code
  structure that is plain from reading it, style nits, or facts true only inside one session.
- Nothing substantial this session → write nothing. That is a valid outcome.

## Entry format

One bullet per insight, appended under the one section it belongs to:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `src/path/file.ts` (`functionName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

Replacing a section's `_No entries yet._` placeholder on first append is expected — it is not
an entry.

## What Works

<!-- append below -->

_No entries yet._

## What Doesn't Work

<!-- append below -->

_No entries yet._

## Codebase Patterns

<!-- append below -->

_No entries yet._

## Tool & Library Notes

<!-- append below -->

- **2026-08-23** — **In the Claude Agent SDK, `allowedTools` does not restrict anything and
  `disallowedTools` does not hold under `permissionMode: "bypassPermissions"`. The only gate that
  held is a `PreToolUse` hook returning `permissionDecision: "deny"`.** `allowedTools` is the
  auto-approve list ("To restrict which tools are available, use the `tools` option instead" —
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`), so a read-only-looking list never made a
  session read-only. Adding `disallowedTools`, documented as removing a tool from the model's
  context, was not enough either: a session still emitted `Edit`, and one `Edit` **succeeded** and
  appended a fabricated entry to `server/INSIGHTS.md`. The SDK's own docs name the working layer —
  "PreToolUse hook denies bypass canUseTool". Evidence: `src/runtime/run-claude.ts` (`runClaude`,
  the three-layer comment), `src/config.ts` (`MUTATING_TOOLS`). This applies to **any** code in this
  repo that opens an SDK session, not just evals.

## Recurring Errors & Fixes

<!-- append below -->

- **2026-08-23** — **A model-backed test can fail in three ways that all read as "fine" unless the
  runner is built to distinguish them: a wrong verdict, a session that ends dirty, and a case that
  never reports at all.** For a tier with no judge and no grounding gate, `record()` was scoring
  `!result.isError` — "the session ended cleanly" — so a trace case that made **zero tool calls**
  was recorded as a pass while a correct negative that exhausted `maxTurns` was recorded as a
  failure. Separately, `eval:repeat` used "records written" as its denominator, so a case killed by
  vitest's 240s `testTimeout` (which runs no user code, so no `catch` fires) vanished from the
  arithmetic and printed as `✓ 4/5`. Fixes: `RecordData.passed` carries the case's own verdict and
  outranks the judge, `measure()` records a failure when the model call throws, and the per-run line
  counts cases vitest collected. Evidence: `src/records/record.ts` (`record`), `src/dsl/case.ts`
  (`measure`, `runWorkflowCases`), `src/repeat.ts`.

## Session Notes

<!-- append below -->

### 2026-08-23

- Workflow tier ran for the first time in this repo. Its three original `trace` cases asserted
  `server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md` and
  `reviewer-core/insights/gotchas.md` — none of which exist here (they belong to the course
  template's tree), so the tier had never produced a single record.
- A `Read` assertion needs a task the **injected** guide cannot answer. Asking "what must you read
  before answering" scored 0/2 with zero tool calls: root `CLAUDE.md` is in the session's context
  via `settingSources:["project"]`, so the model answered correctly without opening a file. Asking
  for content that lives only inside the target file is what makes the read happen.
- Practical ceiling on a merged `trace`: about two independent reads per session. Four was 0/2 then
  1/2 — the failing runs read the package `CLAUDE.md`, decided that was enough, and stopped at 8 of
  14 allowed turns, so it was never a turn-budget problem.
- A package `CLAUDE.md` **does** appear as an explicit `Read` in the trace (`client/CLAUDE.md`,
  `server/CLAUDE.md`), so asserting one is viable — but the second-hop doc is the discriminating
  signal.
- Skill activation on `claude-haiku-4-5` is genuinely intermittent, ~1 in 2–4: both
  `engineering-insights` and `onion-architecture` positives have each answered from context with
  `skills: []` instead of invoking. The trace tier records this faithfully; it is a property of the
  skill descriptions, not of the case.
- The trace tier cannot see a lie. One session produced a fabricated verbatim quote attributed to
  `client/CLAUDE.md` (a heading that file does not contain) and was caught only because a Read
  happened to be missing. `kind: "trace"` now accepts optional `practices`, which disables the
  early stop (an early-stopped session leaves ~27 output tokens — nothing to judge).

## Open Questions

<!-- append below -->

- **2026-08-23** — Why did one `activation` session hang past vitest's 240s `testTimeout` in the
  `workflow-final` run, when the same case takes 13–19s? No record exists for it by definition —
  that is what the missing-case accounting in `src/repeat.ts` now surfaces, so the next occurrence
  should at least be visible instead of silently shrinking the run.
