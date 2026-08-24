# Implementation report — SPEC-03 PR Brief / T4

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 1 file added, 0 changed, nothing committed. Work left uncommitted in the worktree.

## Coverage

- INSIGHTS client: 32 entries, 3 relevant (2026-08-10 — a feature's copy in another feature's i18n namespace fails silently in both directions, which is how "Brief not available yet." landed on the Intent card, and `src/i18n/request.ts` `readdirSync`s `messages/en/` so a namespace is one new file; 2026-08-11 — a component legitimately reads two namespaces, so the diff tab's own sentence stays in `prReview` rather than being duplicated here; 2026-08-19 — `getByRole(…, { name })` normalises whitespace, which bears on the review-focus row's accessible name embedding a path).
- INSIGHTS server: `not checked` — no `server/` file was touched. `server/src/vendor/shared/contracts/pr-brief.ts` was read as input only, per the dispatch, for `BriefReason`'s eleven values and their doc-comments.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `client/messages/en/prBrief.json` (law: user-visible strings live in the translation catalogue, in this feature's own namespace) |

No other routing row matched: no `*.ts`, `*.tsx`, `*.test.tsx`, schema, route or input-handling file is in this task's Owned paths.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/messages/en/prBrief.json` | T4 | yes | new file, 56 messages: section and statement labels, the three risk-level words and three per-risk severity words, empty/loading/running/stale/partial/degraded/error states with their hints, the review-focus row labels and accessible names, the risk file-reference labels, the token/cost line and its unpriced counterpart, the deterministic figure lines, one message per `BriefReason` value, and `reasonUnknown` |

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R22 (T4's slice — the card's message namespace) | T4 | yes — all 27 enumerated keys resolve non-null; the namespace is `prBrief` by filename alone, no shared edit; every string is a complete sentence or a label |

Task-level acceptance from the plan:

- "no key is duplicated from `brief.json`" — see Deviations; verified against the key names the plan itself quotes, not against the file.
- "every string is a complete sentence or a label, never a fragment assembled in code" — yes. Multi-part states are a self-standing sentence plus a self-standing `…Hint` sentence (the `intent.json` `unavailable` / `unavailableHint` precedent), never two halves concatenated.
- "`grep -rn 'useTranslations("prBrief")' client/src` returns nothing yet" — yes, no output. T10 is the consumer.

## Deviations from the plan

- **The catalogue carries keys beyond the 27 the Done-condition enumerates** — `emptyHint` / `emptyCta`, `runningHint`, `staleHint`, `partial` / `partialHint`, `degraded` / `degradedHint`, `errorHint`, `regenerating`, `levelLabel`, `severity.{high,medium,low}` / `severityLabel`, `riskFilesLabel`, `riskNoFiles`, `risksNone`, `reviewFocusNone`, `reviewFocusOpen` / `reviewFocusOpenLine`, `costUnpriced`, `provenance`, `generatedAt`, `headSha`, `stats.*`. Reason: AC-30, AC-46, AC-48, AC-50, AC-52 and AC-53 each require rendered copy on the card, T10 is the only consumer and `client/messages/en/prBrief.json` is **not** in T10's Owned paths — so a key missing here is a blocked wave 6, not a wave-6 edit. All additions are inside this task's single Owned path and none renames or restructures an enumerated key path.
- **`brief.json` was not opened, so "no key is duplicated from `brief.json`" was discharged indirectly.** The task's `Forbidden` line and the dispatch both say not to read it; the Acceptance line as written needs its key list. The Forbidden line wins. The names the plan itself quotes from that file — `block.{intent,blast,risks,history}`, `noRisks`, `noHistory`, `overlap`, `unavailable`, `unavailableHint`, `why.*` — are all absent from this catalogue.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | parse | `node -e "JSON.parse(…'messages/en/prBrief.json'…)"` | pass — `parsed` |
| client | key enumeration | the plan's `node -e` loop over the 27 required keys | pass — 0 `MISSING:` lines (`checked 27 keys`) |
| client | ICU syntax (extra, not in the plan) | `@formatjs/icu-messageformat-parser@2.11.4` `parse()` over every leaf string | pass — `ICU parsed 56 messages`, 0 errors |
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 47 files, 388 passed, 0 failed |
| client | consumer grep | `grep -rn 'useTranslations("prBrief")' src` | pass — no output, as the plan requires at this wave |
| client | lint | — | gate did not run — no `*.ts` / `*.tsx` file was changed; `eslint` does not cover `messages/*.json` and T4's Done-condition does not list it |
| server | all | — | gate did not run — no `server/` file was touched. The concurrent wave-3 implementer owns `src/db/schema/reviews.ts` and `0019_misty_terrax.sql`; those gates are theirs |
| — | integration / e2e | — | gate did not run — Docker not authorised by the dispatch |

## Not done

- `absent` — the consumer of these keys. `BriefCard` is T10 (wave 6); nothing reads the namespace during this dispatch, which is why the enumeration script rather than a render was the check.
- `absent` — the diff tab's "this file is not in the rendered diff" sentence. It is `prReview.json`'s, owned by T6, deliberately not duplicated here so one situation does not get two wordings.
- `not checked` — how these strings look in the running app. `DDG-UI-001` applies to T6 and T10's render, not to a catalogue; nothing renders yet.
- `not checked` — `server/INSIGHTS.md`. No server file was in scope.

## For the parent

- `client/messages/en/brief.json` was deliberately never opened, so this run adds no evidence for or against the plan's standing recommendation to split `why.*` into `messages/en/why.json` and delete the dead composed-shape keys. The trap is still there for whoever next reads a "brief" namespace.
- Two figures for whoever dispatches T10, so it does not have to rediscover them: the level words are `level.{high,medium,low}` ("High risk" / …) and are distinct from the per-risk `severity.{high,medium,low}` ("High severity" / …), because AC-37 and AC-39 are two different facts; and `cost` is an ICU pattern taking `{tokensIn}`, `{tokensOut}` and a pre-formatted `{cost}`, with `costUnpriced` for `cost_usd === null`, which per the contract is "no price known", not a free call.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Both are the parent's, after the remaining waves.

---

## Parent's notes on this report

**The over-delivery is correct and the reasoning is the part worth keeping.** T4 wrote 56
messages where its Done-condition enumerates 27, and justified it from the wave structure
rather than from taste: `client/messages/en/prBrief.json` is **not** in T10's Owned paths, so a
key this task omits is not a small edit in wave 6 — it is a blocked wave 6. Every addition sits
inside T4's single Owned path and none renames an enumerated key. Accepted, no finding.

**The one place it could not satisfy its own Acceptance line, it said so.** "No key is
duplicated from `brief.json`" needs that file's key list, and both the task's `Forbidden` line
and the dispatch forbid opening it. It discharged the check against the names the plan itself
quotes and recorded the substitution as a deviation instead of quietly claiming a pass. That is
the right resolution — the Forbidden line exists because *reading* those keys is the bug — and
it is a small defect in the plan's Acceptance wording, not in the work.

**Two useful handles for T10**, held here so wave 6 does not rediscover them: `level.*` and
`severity.*` are deliberately distinct vocabularies because AC-37 and AC-39 are different
facts, and `cost` is an ICU pattern with `costUnpriced` for the `cost_usd === null` case, which
the contract defines as "no price known for this model" and never as a free call.
