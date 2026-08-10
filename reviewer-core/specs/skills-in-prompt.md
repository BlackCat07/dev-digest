# Skills in the prompt — the `## Skills / rules` slot

`assemblePrompt` places an ordered list of skill bodies into the user message, ahead of the
diff they are meant to judge.

Server half of this feature: [`../../server/specs/skills.md`](../../server/specs/skills.md).

## Behaviour

1. `PromptParts.skills` is `string[] | undefined` — resolved skill **bodies**, not ids or
   slugs. The engine never looks a skill up; it cannot, being pure.
2. When present and non-empty, the bodies are joined with a blank line and pushed as a
   `## Skills / rules` section.
3. The section sits **after** `## PR description` and **before** `## Relevant memory`,
   `## Repo skeleton`, `## Project context`, `## Callers of changed symbols`, and
   `## Diff to review`. Rules arrive before the material they judge.
4. The order of the array is preserved verbatim. It is the agent's link order, and it is
   what the reorder UI edits.
5. `undefined` and `[]` both omit the section entirely — no heading, no blank block. The
   assembled user message is then byte-identical to one produced with the key absent.
6. The joined block is recorded on `PromptAssembly.skills`, or `null` when omitted, so the
   run trace can show it and attribute its tokens.
7. Bodies are **not** wrapped by this function. Whether a given body is trusted depends on
   where it came from, which is a fact the engine does not have; the caller wraps what needs
   wrapping before passing it in.

## Data

Nothing is read. The bodies arrive as a parameter, per this package's purity contract, and
the only output is the two chat messages plus the `PromptAssembly` record.

## States

| Case | Result |
|---|---|
| `skills` absent | section omitted, `assembly.skills === null` |
| `skills: []` | identical to absent |
| One skill | section with that body, no separator |
| Several skills | bodies joined with `\n\n`, in the given order |
| A body that already contains `<untrusted …>` | passed through as-is; the caller wrapped it |

## Non-goals

- **No wrapping, escaping or sanitising here.** Doing it in the engine would double-wrap an
  already-wrapped body and would make a trusted, hand-written rule read to the model as
  data. The trust decision lives next to the `source` column that drives it.
- **No per-skill heading or delimiter.** A skill body carries its own markdown headings;
  adding a wrapper heading per skill would nest them unpredictably.
- **No token budget or truncation.** Unlike the repo map, the skill block is not
  budget-searched — the operator chose these skills explicitly, and silently dropping one
  would make a review differ from its configuration with no signal.
- **No deduplication.** Two agents can share a skill, but one agent linking the same skill
  twice is prevented by the join table's primary key, not here.

## Implementation

| File | Role |
|---|---|
| `src/prompt.ts` | `skillsBlock`, its position in `userSections`, and `assembly.skills` |
| `src/review/run.ts` | `ReviewInput.skills` forwarded into `promptParts` for both strategies |
| `test/prompt.test.ts` | ordering, join, omit-when-empty, no-wrap, trace record |

## History

- **2026-08-05** — Documented and covered by tests with the L02 Skills feature. The slot
  itself shipped unused in Part-0; nothing about its behaviour changed.
