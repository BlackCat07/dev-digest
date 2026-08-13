# Intent Layer

A user opening a PR now sees what the system understood the PR to be for, before reading a
single finding — and can tell at a glance which findings the reviewer judged on-task versus
off-task.

Server half of this feature: [`../../server/specs/intent-layer.md`](../../server/specs/intent-layer.md).

## Behaviour

1. The PR detail page's Overview tab renders an INTENT card above the PR's own description
   — the card is what the system understood; the description below it is the raw claim it
   was derived from.
2. `OverviewTab` is the container: it owns `usePrIntent(prId)` and `useDeriveIntent(prId)`
   and passes plain props to `IntentCard`, which calls no data hook of its own.
3. The card's header is **inside** the card, on one line: the target icon and `INTENT` at the
   left, and at the right the derivation's `CONFIDENCE nn%` followed by the re-derive control
   (labelled "Re-derive", or "Deriving…" and disabled while one is in flight). Confidence sits
   there rather than below the columns because it is what tells a reader whether the two lists
   under it are worth trusting; it is omitted for a `failed` row, which has no figure to show.
4. While loading **or while a derivation is in flight**, the card body is skeletons — the
   in-flight state REPLACES whatever was there. It must not render a "deriving" note above the
   previous answer: the stale sentence still reads as current, so the card would show two
   intents at once. The query error state (the intent could not be **read**) is rendered
   distinctly from a derivation that ran and recorded `status: 'failed'`.
5. A PR that has never been classified — no stored row — renders an empty state ("Intent not
   derived yet."), unless a derivation is currently in flight, in which case the pending
   mutation's own "Deriving…" state is shown instead of the empty state.
6. A `status: 'failed'` row renders the failure message and the deterministic
   `missing_context` list — never a blank card.
7. An `ok` or `partial` row renders: the intent sentence, two columns ("In scope" / "Out of
   scope") from `in_scope`/`out_of_scope`, a `RISK AREAS` block (see #15) and
   `missing_context`. The `sources` audit trail is **not** rendered — see Non-goals.
8. `missing_context` is **always last on the card**, after `RISK AREAS`, for every status.
   There is deliberately no promotion for `partial`: an earlier version put the gap above the
   intent sentence when the derivation had flagged one, which placed "Could not read X"
   between the card's header and the sentence it qualifies and read as an error banner on a
   card that is not in error — a `partial` derivation still produced a usable intent. One
   predictable position is worth more than the emphasis was. Consequence, stated plainly:
   `partial` and `ok` are no longer visually distinguishable. Nothing is lost, because the list
   itself names what failed and `confidence` is already capped by the `unfetched` source.
8a. The intent sentence renders as white **italic inside typographic quote marks**, with no
    left rule: it is a quotation of the classifier's words, and a coloured bar made it read as
    a callout instead.
8c. `MISSING CONTEXT` renders through the vendored `SectionLabel` with an `EyeOff` icon, the
    same way `RISK AREAS` does — an optional block that only sometimes appears still has to
    read as a peer of the card's other sections. `EyeOff` rather than a warning triangle
    because the triangle belongs to `RISK AREAS`, and reusing it would say this is a risk; it
    is not, it is material we did not get to see.
8d. `INTENT`, `CONFIDENCE`, the percentage, `RISK AREAS` and `MISSING CONTEXT` all render at
    **12px/700** — the vendored `SectionLabel`'s own scale. `vendor/ui` is do-not-touch, so the
    hand-rolled labels are the side that agrees with it. The four header items also share one
    centre line; each carries an explicit `line-height: 1`, because with mixed font sizes on a
    row it is the differing line box, not the font size, that pushes an item off centre.
8b. Each scope bullet carries a small `·` marker tinted per column — green in "In scope",
    muted in "Out of scope" — rather than the browser's list bullet, whose colour always
    follows the text.
9. When the stored `head_sha` differs from the PR's current `head_sha` (and both are
   known), the card shows a "derived from an earlier commit" note. Neither side being known
   is not treated as staleness.
10. `FindingsPanel` renders a `ScopeFilter` chip row beside `SeverityFilter` — a separate
    unit, not a third chip merged into `SeverityFilter` (whose tests pin exactly three
    severity chips).
11. `ScopeFilter` uses the same isolate semantics as `SeverityFilter`: clicking a chip shows
    only that scope, clicking the active chip again clears the filter, and the default
    (`null`) shows every finding — in-scope, out-of-scope, and unlabelled alike.
12. Filtering to a specific scope (e.g. `in_scope`) therefore also hides **unlabelled**
    findings (`scope` absent/null) — a finding must actually carry the chosen label to
    survive the filter. With no scope filter active, unlabelled findings are always shown.
13. `FindingCard` shows an "out of scope" badge only when `finding.scope === 'out_of_scope'`.
    An in-scope or unlabelled finding renders with no scope marker at all — visually
    identical to a pre-Intent-Layer finding.
14. The scope filter's chip counts (`countByScope`) tally only labelled findings; an
    unlabelled finding contributes to neither count, so the two counts can sum to less than
    the total finding count.
15. `RISK AREAS` renders below the scope columns, under a divider, as a row of chips — one per
    `risk_areas` entry, icon tinted by `severity`. The chips are **buttons**: clicking one
    opens a single panel with that risk's explanation and the files it cites, clicking it again
    closes it, and opening a second closes the first. Exactly one panel is ever open.
16. An **empty** `risk_areas` renders nothing at all — no chips, no heading, no divider, no
    "no risks found" line. The classifier is not asked to prove a negative, so the card does
    not claim one.
17. A `risk_areas` entry whose `kind` the client does not recognise still renders, with a
    neutral icon. `Risk.kind` is an open string in the contract while only the classifier is
    held to a closed enum, so an unknown kind is a data case, not a crash.
18. The re-derive control sends `force: true`. Without it the server's freshness check returns
    the stored record and the button is a silent no-op on precisely the case a user presses it
    for — see History.

## Data

| Read | Hook | Endpoint |
|---|---|---|
| Stored intent for the open PR | `usePrIntent(prId)` | `GET /pulls/:id/intent` |
| Re-derive on demand | `useDeriveIntent(prId)` | `POST /pulls/:id/intent` with `{ force: true }` |

`usePrIntent` polls every 2s (`INTENT_POLL_MS`) only while `status === 'running'`; every
other status — including `null` (never derived) — makes no further request. `PrIntent` and
`FindingScope` are the vendored copies of the server's contracts
(`client/src/vendor/shared/contracts/{intent,findings}.ts`); the shape and its fields are
[the server spec](../../server/specs/intent-layer.md)'s to define.

## States

| Case | Rendered as |
|---|---|
| Never derived, not deriving | `EmptyState` ("Intent not derived yet.") |
| Never derived, deriving in flight | the mutation's own pending row (spinner + "Deriving…"), not the empty state |
| Loading, or a derivation in flight | skeleton rows, REPLACING any previous answer |
| Query error (the `GET` itself failed) | an alert box with the error message, distinct from `status: 'failed'` |
| `status: 'running'` | polling continues; card shows whatever it already had, plus a "Deriving…" note if a manual re-derive is also pending |
| `status: 'ok'` | full card: confidence in the header, intent, both scope columns, risk areas, missing-context last |
| `status: 'partial'` | identical to `ok` — the gap is last either way; only `confidence` (capped) and the gap's own text differ |
| `status: 'failed'` | error box and missing-context — no intent quote, no confidence |
| Stored `head_sha` ≠ current `head_sha` | a stale-head note, in addition to whichever status render above |
| `risk_areas` non-empty | a chip per risk under a `RISK AREAS` divider; one open panel at most |
| `risk_areas` empty | the whole block absent, heading included |
| Findings panel, no scope filter active | every finding shown, labelled or not (default) |
| Findings panel, scope filter active | only findings carrying that exact label; unlabelled findings drop out |

## Non-goals

- **No filtering that hides anything by default.** The scope filter's null default is a
  product decision, not an oversight — see History.
- No out-of-scope marker anywhere but `FindingCard`'s title row (no dimming, no reordering
  of the findings list by scope).
- No fourth chip inside `SeverityFilter` — scope is a second, orthogonal filter unit.
- No intent card on the Findings tab; it renders once, on Overview.
- **The `sources` audit trail is not on the card.** It is still derived, stored and logged —
  `confidence` is computed from it, and `missing_context` partly derived from it — but a reader
  of a pull request does not need the receipt, so the block and its two copy keys were removed.
- **Risk areas render INSIDE the card**, under a divider below the scope columns — not beside
  it. Blast radius remains a later feature and nothing here touches it.
- No test for `OverviewTab` as the container (Behaviour #1–#2), and nothing asserts the chip
  row's placement *beside* `SeverityFilter` (Behaviour #10) as opposed to both being mounted.

## Implementation

| File | Role |
|---|---|
| `client/src/lib/hooks/intent.ts` | `usePrIntent`, `useDeriveIntent` |
| `client/src/lib/scope.ts` | `SCOPE_VALUES`, `countByScope` — runtime values, kept out of the vendored barrel per the client's type-only-import rule |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx` | the presentational card and its state ladder |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/ScopeFilter/ScopeFilter.tsx` | the chip row, isolate semantics |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` | the container: owns both intent queries, mounts the card above the description |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx` | passes `prId`/`headSha` down to `OverviewTab` |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx` | mounts `ScopeFilter`, holds the `scope` filter state |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts` | `visibleFindings`'s scope isolate |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` | the out-of-scope badge |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts` | `outOfScopeTag` |
| `client/messages/en/intent.json` | the card's own namespace: `label`, the empty state, and the `card.*` copy |
| `client/.../IntentCard/_components/RiskAreas/` | the chip row and its single-open disclosure — nested because `IntentCard` is its only renderer |
| `client/src/lib/risk.ts` | `riskIcon` / `riskSeverityColor` — runtime maps, kept out of the vendored barrel per the type-only-import rule |
| `client/src/**/_components/{IntentCard,ScopeFilter}/*.test.tsx`, `FindingsPanel/helpers.test.ts`, `src/lib/hooks/intent.test.tsx` | the tests for all of the above — see History |
| `client/messages/en/prReview.json` | `finding.outOfScope`, `scopeFilter.*` copy |

## History

- **2026-08-10** — Shipped with L03. A deliberate deviation from the L03 task brief (not
  checked into this repository),
  which specifies that out-of-scope comments are filtered out: this feature **annotates and
  never drops**, and the filter's default shows everything, including findings the Intent
  Layer never labelled at all. The requirement that a serious out-of-scope problem still
  leaves a signal is met by the reviewer's deterministic scope floor
  (see [`../../reviewer-core/specs/intent-in-prompt.md`](../../reviewer-core/specs/intent-in-prompt.md)),
  not by anything client-side. This iteration shipped with **no automated test** for
  `IntentCard`, `ScopeFilter`, `usePrIntent`/`useDeriveIntent`, or the `visibleFindings`
  scope isolate — the pre-existing `SeverityFilter` tests (pinned to three chips) still
  pass unmodified, which proves no regression there, not that the new behaviour is covered.

- **2026-08-10** — The card's copy was moved out of `messages/en/brief.json` into its own
  `messages/en/intent.json`. It had been appended to the **PR Brief**'s namespace, and
  `IntentCard` was the only consumer of that whole namespace — so a never-classified PR
  rendered an empty state reading *"Brief not available yet."*, naming a different feature
  on the Intent card. Nothing caught it: the keys resolved, so next-intl was silent and
  typecheck, eslint and all 175 client tests stayed green. `src/i18n/request.ts` autoloads
  every `messages/en/<ns>.json`, so a feature's own namespace costs one file and no shared
  edit — which is what L02's `conventions.json` did and what this should have done. The
  section label now reads `t("label")` from that namespace instead of `brief.block.intent`;
  the rendered string is unchanged, which is what keeps `e2e/specs/11-pr-intent.flow.json`'s
  `INTENT` assertion passing.

- **2026-08-10** — The missing tests were written, and one of them found a real bug. Behaviour
  #8 says `missing_context` sits **below the sources** when `status === 'ok'` and above the
  quote when `partial`; `IntentCard` rendered it above the sources in both, so the two states
  differed only in the gap's position relative to the quote. Typecheck, eslint and all 175
  tests were green while the documented ordering was wrong — an order-asserting test is the
  only thing that catches it, and asserting mere presence would have passed. The JSX now
  matches the spec. Added: `IntentCard.test.tsx` (8 — the whole state ladder, including a read
  error rendered distinctly from `status: 'failed'`, the pending derivation suppressing the
  empty state, both gap orderings, the stale-head note requiring BOTH SHAs, and an `unfetched`
  source's marker), `ScopeFilter.test.tsx` (4 — isolate semantics), `FindingsPanel/helpers.test.ts`
  (3 — the scope isolate hiding unlabelled findings, in both the `null` and key-absent
  spellings), 2 added `FindingsPanel` cases (`countByScope` tallying only labelled findings, so
  the chips sum to less than the list), `lib/hooks/intent.test.tsx` (3 — polling starts only
  while `running` and stops for every other status, and the re-derive POST stays body-less so
  `apiFetch` omits `content-type`), and 4 `FindingCard` cases for Behaviour #13 whose
  load-bearing half is negative: an in-scope or unlabelled finding must carry no marker at all,
  or the badge would relabel every finding written before this feature. Client is now 199 tests
  over 30 files. Note `@testing-library/user-event` is **not** a dependency here, so these use
  `fireEvent` like all 20 pre-existing test files.

- **2026-08-11** — Two fixes and one addition, all from looking at the card on a real PR.
  1. **The Re-derive button was a silent no-op.** `useDeriveIntent` POSTed with no body, so
     `force` was never set, the server's freshness check returned the stored record, and the
     mutation still resolved 200 and still invalidated — a perfectly successful nothing. It
     now sends `{ force: true }`. The failure was invisible to every layer that usually
     catches things: the request succeeded, the UI re-rendered, and the only way to see it is
     to assert the REQUEST at the `fetch` boundary, which is why `intent.test.tsx` mocks
     there rather than at `api`.
  2. **`RISK AREAS` added**, inside the card under a divider below the scope columns, per the
     design mock — chips as buttons with a single-open disclosure revealing each risk's
     explanation and the files it cites. Two deliberate omissions: the explanation renders as
     plain text rather than through the `Markdown` primitive (that primitive maps `a`, and
     this string is model output derived from an author-controlled PR description — a
     markdown link would become a live anchor), and the cited paths render as mono text
     rather than `MonoLink` (without an `href` that primitive is a `<button>`, and a button
     that does nothing is worse than a label; the Files-changed deep link is not wired).
  3. `CONFIDENCE`, `SOURCES` and `MISSING CONTEXT` were considered for removal and
     **deliberately kept**: the task brief requires the intent to visibly mark missing
     context, and confidence is the only thing on screen that separates a 10% title-only
     derivation from a 46% informed one. Removing them would have made the two look identical.
  Client is now 209 tests over 31 files, measured.

- **2026-08-11** — Card redesigned against the mock, and one thing removed on request.
  The label and its icon moved **inside** the card (top-left) with `CONFIDENCE nn%` on the same
  line at the right; the intent sentence became white italic in typographic quotes with the
  left accent bar gone; scope bullets got tinted `·` markers instead of browser list bullets;
  a derivation in flight now **replaces** the body instead of stacking a note above the old
  answer (two intents on screen at once, the stale one reading as current); and the `SOURCES`
  block was removed from the card altogether, along with its `card.sources` / `card.notFetched`
  copy. `sources` itself stays server-side — it is what `confidence` is derived from, so
  deleting the data would delete the number the header now features.
  On the risk chips: the icons were never the problem. `Risk.kind` came back `other` for every
  risk on a large PR, so every chip drew the same fallback glyph — and that glyph was lucide's
  `Info`, a circled "i", which made four identical letters. The fallback is now
  `AlertTriangle`, and the server infers a real kind from the cited paths when the model says
  `other` (see the server spec). Measured after: a 100-file PR renders three ⚠ chips tinted by
  severity plus a distinct `Boxes` chip for the dependency risk. Fewer than five distinct icons
  on a PR whose changes genuinely all fall into one category is the honest outcome, not a bug.

- **2026-08-11** — Three UI corrections found by looking at real pull requests, in the order
  they were found.
  1. **The label scale was three sizes pretending to be one.** `INTENT` was 12, `CONFIDENCE`
     11.5, the percentage 14, and `RISK AREAS` 12 because it comes from the vendored
     `SectionLabel`. All are 12/700 now, anchored on the primitive because `vendor/ui` cannot
     move. The four header items also share a centre line to the pixel (measured: identical
     `centreY` for all four), via an explicit `line-height: 1` — mixed font sizes on one row
     are thrown off by the line box, not by the size.
  2. **`MISSING CONTEXT` had no icon**, so an optional block that appears only sometimes read
     as a stray paragraph rather than a section. It now goes through `SectionLabel` with
     `EyeOff`, which also settled its size for free. `blockLabel` and `block` became dead and
     were removed rather than left in `styles.ts` for the next reader to wonder about.
  3. **The gap jumped to the top on `partial`** — see Behaviour #8. This had been in the code
     from the start and simply never fired: every PR looked at until then was `ok`. It showed
     up the first time a derivation could not read a linked document
     (`docs/skills/deprecation-policy.md` on PR #114 — two `unfetched` sources, so
     `status: 'partial'`). Removed, and the test that pinned the old behaviour was **inverted
     rather than deleted**, so a future edit that reintroduces the promotion fails instead of
     passing quietly. Verified on that same PR: reading order is now intent → in scope → risk
     areas → missing context.
