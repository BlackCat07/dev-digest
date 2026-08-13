# Intent in the prompt — the `## Stated intent and scope` slot

`assemblePrompt` places the PR's derived intent into the user message, and a deterministic
floor labels every surviving finding's scope relative to it, without ever removing one.

Server half of this feature: [`../../server/specs/intent-layer.md`](../../server/specs/intent-layer.md).

## Behaviour

1. `PromptParts.intent` is `string | undefined` — a single **pre-rendered** block, not
   `PrIntent`'s shape. The engine never learns Intent's structure; the caller (the server's
   `run-executor.ts`) renders the stored record into markdown before passing it in.
2. When present and, after trimming, non-empty, the block renders as a
   `## Stated intent and scope` section, wrapped with `wrapUntrusted('intent', …)`.
3. The section sits **after** `## PR description` and **before** `## Skills / rules` (and
   every section after it) — the frame the reviewer judges the diff against, placed right
   below the material it was derived from.
4. Presence of a non-empty intent block appends a second, LABELLING-ONLY system rule
   (`SCOPE_LABEL_RULE`) after `INJECTION_GUARD`. Its absence leaves the system message
   byte-identical to the pre-L03 shape — `INJECTION_GUARD`'s own text is never edited.
5. `SCOPE_LABEL_RULE` instructs the model to set each finding's `scope` field
   (`in_scope`/`out_of_scope`) and states explicitly that this is a label only: it must
   never omit, downgrade, soften or merge a finding, and must never change a finding's
   severity, because of stated scope. It deliberately avoids the words "ignore" /
   "suppress" / "do not report" — the exact phrasings `INJECTION_GUARD` tells the model to
   disregard when they appear in *untrusted* data; a trusted rule using them would
   undercut that defense.
6. `undefined` and an empty/whitespace-only string both omit the section and the rule —
   the assembled message is then identical to one produced with the key absent.
7. The rendered block is recorded on `PromptAssembly.intent`, or `null` when omitted, so
   the run trace can show it.
8. The block is **not** trimmed before being wrapped and inserted — only checked for
   non-blank content after trimming. Whitespace the caller left in is preserved verbatim in
   the prompt.
9. `applyScopeGuard` runs on the grounded finding set (`ground.kept`) **only when an intent
   block actually reached the prompt for this review** — `reviewPullRequest` gates the call
   on `assembly.intent != null`, read back off the `PromptAssembly` the same call already
   built, so this can never drift from the slot's own "present and non-blank" definition
   (Behaviour #6). When it runs, it labels every finding: a `CRITICAL` finding, or one whose
   `kind` is in `FULL_FILE_KINDS`, is forced to `in_scope` regardless of what the model said;
   any other finding with no scope label is normalised to `in_scope`; everything else keeps
   the model's label verbatim.
10. When no intent block was supplied, `applyScopeGuard` does not run at all: every finding
    passes through with whatever `scope` the model set (or left absent) on the grounded set,
    untouched. No finding is back-filled to `in_scope` — the contract's "absent/null when no
    intent was available" (`@devdigest/shared` `contracts/findings.ts`) is what a
    no-intent review actually produces, for every review produced by this code, not only for
    ones persisted before the feature shipped. No `scope`-prefixed event (`scope: N
    in-scope, …` or `scope floor: …`) is emitted on this path either, so the whole no-intent
    review — prompt and event stream both — is byte-identical to the pre-L03 one.
11. `applyScopeGuard` changes labels only: `output.findings.length === input.length`,
    always, same order, same objects but for the `scope` key. Nothing is added, removed, or
    reordered.
12. `groundingSummary` is computed **before** `applyScopeGuard` runs, from the grounding
    result (`ground`) — not from the scoped output. `agent_runs.grounding` is therefore
    byte-identical to what it would have been without this feature, for every input.
13. `scoreFromFindings` is called on `scoped?.findings ?? ground.kept` — the guard's output
    when it ran, otherwise the same grounded set the guard would have received. Because the
    guard never drops or reorders anything when it does run, this is always the same set
    `scoreFromFindings` would have received without scope labelling — the score is unaffected
    by scope, whether or not an intent was supplied.
14. Nothing is ever dropped, hidden, or omitted from a review's output for being labelled
    `out_of_scope`. Filtering, where it happens at all, is a client-side display concern
    (see [the client spec](../../client/specs/intent-layer.md)) — this package never
    filters its own output.

## Data

Nothing is read. The intent block arrives as a parameter, per this package's purity
contract; the only outputs are the two chat messages, the `PromptAssembly` record, and —
downstream of the LLM call — the scope-labelled `Finding[]`.

## States

| Case | Result |
|---|---|
| `intent` absent | section omitted, `SCOPE_LABEL_RULE` omitted, `assembly.intent === null` |
| `intent: ""` or whitespace-only | identical to absent |
| A non-empty block | section rendered, wrapped, `SCOPE_LABEL_RULE` appended to the system message |
| A block that already contains `<untrusted …>` | passed through as-is inside the outer wrap; the caller is responsible for its own content |
| No intent given, findings produced | the floor does not run; each finding keeps whatever `scope` the model set on the grounded set, absent/`null` if the model left it unset — no scope events are emitted |
| A `CRITICAL` finding, or a `FULL_FILE_KINDS` finding | forced `in_scope`, whatever the model set or omitted |
| An `out_of_scope`-labelled finding | kept in the output array, in place, with the label intact — never removed |

## Non-goals

- **No wrapping, escaping, or re-classification here beyond the one `wrapUntrusted` call.**
  The block is rendered by the caller; this package treats it exactly like the PR
  description and every other untrusted slot.
- **No edit to `INJECTION_GUARD`'s existing text.** `SCOPE_LABEL_RULE` is a separate,
  additively-appended message, present only when an intent block is present.
- **No per-category or per-severity scope override beyond the floor's two rules**
  (`CRITICAL`, `FULL_FILE_KINDS`). A finding of any other severity or kind is labelled by
  the model, or defaults to `in_scope` if the model said nothing.
- **No third LLM call and no string-matching** of a finding's title or rationale against
  `in_scope`/`out_of_scope` bullets — scope labelling is the model's own structured-output
  field, checked only by the deterministic floor above it.
- **No token budget or truncation on the intent block** — unlike the repo map, this section
  is not budget-searched; truncation (`MAX_INTENT_CHARS` and friends) is applied by the
  caller before the block ever reaches this package.

## Implementation

| File | Role |
|---|---|
| `src/prompt.ts` | `SCOPE_LABEL_RULE`, its conditional append, the `## Stated intent and scope` section and its position, `assembly.intent` |
| `src/grounding.ts` | `FULL_FILE_KINDS`, exported for the floor to consult |
| `src/review/scope.ts` | `applyScopeGuard`, `scopeFloorReason` — the deterministic floor |
| `src/review/run.ts` | `hasIntent = assembly.intent != null`, the gate on calling `applyScopeGuard` at all; the ordering that makes the design safe: `groundingSummary` computed from `ground` before `applyScopeGuard` runs; `scoreFromFindings` fed `scoped?.findings ?? ground.kept` |
| `src/index.ts` | barrel exports: `applyScopeGuard`, `ScopeGuardResult`, `FULL_FILE_KINDS` |
| `test/prompt.test.ts` | covers `INJECTION_GUARD`'s existing "intentional/test/demo" defense, plus the `intent` slot's position, the `SCOPE_LABEL_RULE` append, and the omit-when-absent/blank behaviour |
| `test/scope.test.ts` | `applyScopeGuard` as a unit: the floor (CRITICAL, each `FULL_FILE_KINDS` member) and membership (same count/order, no mutation of the input) |
| `test/run.test.ts` | the gating itself — "scope labelling is gated on the intent slot": no intent ⇒ no guard call, no scope events, scores/grounding/finding ids identical to a scoped run |

## History

- **2026-08-10** — Added with L03. The load-bearing safety property: `groundingSummary` is
  computed **before** the scope guard, and `scoreFromFindings` receives exactly the
  guard's output, which is `ground.kept` with only the `scope` key ever changed — so
  "annotate instead of drop" is a no-op for `agent_runs.grounding` and for every score this
  package has ever produced.
- **2026-08-10** — Review found that `applyScopeGuard` ran unconditionally on every review,
  labelling `scope: 'in_scope'` onto findings from PRs with no intent — the opposite of the
  contract's "absent/null when no intent was available" — and emitting `scope: …` events for
  a feature that was supposed to be a no-op when absent. The code now gates the call on
  `hasIntent = assembly.intent != null`, read back off the `PromptAssembly` `assemblePrompt`
  already built for this chunk, so the gate can never disagree with the slot's own
  "present and non-blank" definition. A no-intent review is now byte-identical to the pre-L03
  one in both the prompt and the event stream. `test/scope.test.ts` (new), plus extensions to
  `test/prompt.test.ts` and `test/run.test.ts`, now cover the `intent` slot, `SCOPE_LABEL_RULE`,
  the floor, membership, and the gating decision itself — the package went from 4 test files /
  31 tests to 5 / 45.
