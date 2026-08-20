# Fix plan — round 1

Base `06d7488`, diff uncommitted. Three findings, all triaged `mechanical`. One implementer,
single pass — F1 touches both `vendor/shared` copies, so splitting by package would put two
agents in one contract file.

## Triage of everything Phase 3 raised

| ID | Source | Severity | Bucket | In this round |
|---|---|---|---|---|
| F1 | plan-verifier, R14 / AC-30 `partial` | CRITICAL | mechanical | **yes** |
| F2 | wave 2 report → ledger `P1-1` | CRITICAL | mechanical | **yes** |
| F3 | architecture-reviewer SUGGESTION → ledger `P3-1` | SUGGESTION | mechanical | **yes** |
| — | architecture-reviewer SUGGESTION → ledger `P3-2` (`adapters/tokenizer` second consumer) | SUGGESTION | **accepted** | no — no rule governs it, `layer-map.md`'s guidance is advisory, and it repeats a shape `project-context/service.ts` already has. Promoting `Tokenizer` into `vendor/shared` is its own change with its own agreement |
| — | ledger `P1-2` (no message key for a refused generation) | SUGGESTION | **accepted** | no — **no acceptance criterion requires it.** AC-51 requires an inline error inside the card and T10 renders the server's own message, which satisfies it. A dedicated key is polish, and inventing copy for a 409 nobody has specified is worse than showing what the server said |
| — | plan-verifier, R2 / AC-2's "nine values" vs eight clauses | — | **spec-level** | no — the code's reading is internally consistent and tested; the spec's wording is `doc-writer`'s at Phase 5, in the same pass as the other spec corrections |
| — | plan-verifier, R11 / AC-25's review-focus half | — | **spec-level** | no — vacuous **by construction**: `ReviewFocusItem` is `{ path, line, reason }` and none of those can name an endpoint. Not fixable without a contract change nobody has agreed, and the risk half **is** actively grounded and mutation-verified |
| — | plan-verifier, R16 / AC-33's "no linked issue" example | — | **spec-level** | no — a genuine two-reading ambiguity in the criterion itself. The code took the "one entry per input **offered**" reading, which is the criterion's own normative sentence; its worked example assumes the other. `doc-writer`'s |

## F1 — AC-30's blast counts are not on the stored brief

**The finding.** AC-30 says a brief the model did not produce "shall carry … the blast map's
counts". It does not. `BriefDiffStats` has exactly `files_changed`, `files_listed`, `additions`,
`deletions`; the blast figures reach only the single log line in `service.ts` and the separate
Blast Radius card. Both the implementer (T13) and `plan-verifier` found this independently, and
the verifier called it "the one I'd call closest to a real gap rather than a wording quibble,
since AC-30's text is unambiguous and the payload plainly doesn't carry it."

**Why it is mechanical and not a contract negotiation.** `server/src/vendor/shared/contracts/pr-brief.ts`
is **untracked** — a new file this feature created in wave 1. `DDG-DNT-003` governs reshaping or
renaming an **existing** export; this export does not exist in `HEAD`. Adding two fields to our
own not-yet-shipped contract is finishing it, not reshaping a frozen symbol. `DDG-DNT-001` still
applies in full: **both copies move together and must stay byte-identical.**

Owned paths:
- `server/src/vendor/shared/contracts/pr-brief.ts`
- `client/src/vendor/shared/contracts/pr-brief.ts`
- `server/src/modules/brief/service.ts`
- `server/test/brief-service.test.ts`

Change: give `BriefDiffStats` the blast counts the criterion names — the changed-symbol count and
the impacted-endpoint count, matching what `BriefBlastReader` already returns and what the log
line already prints. They must be present on **every** stored brief, not only a degraded one, so
the reader is not asked why a figure appears in one state and vanishes in another; on a brief
built where the blast map is `degraded` they are the honest zero the map itself reported. Populate
them in `service.ts` at the one place `diff_stats` is assembled, from the same values the log line
uses — do not re-read the blast map for them. Extend `test/brief-service.test.ts`'s existing
degraded-brief assertions to read them back.

Do **not** touch `contracts/brief.ts`, `contracts/platform.ts`, or the client card: AC-30 requires
the brief to *carry* the counts, not the card to render them, and `BriefCard` is out of scope for
this round.

Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd client && CI=true ./node_modules/.bin/tsc --noEmit
diff -q server/src/vendor/shared/contracts/pr-brief.ts \
        client/src/vendor/shared/contracts/pr-brief.ts && echo IDENTICAL
cd server && git diff --stat -- src/vendor/shared/contracts/brief.ts   # must print nothing
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  > /tmp/f1.txt 2>&1; echo "rc=$?"; tail -6 /tmp/f1.txt
```

## F2 — a Docker-gated test still asserts the pre-AC-61 model default

**The finding.** `server/test/settings-models.it.test.ts:54-57` asserts
`resolveFeatureModel(db, workspaceId, 'risk_brief')` equals `{ provider: 'openai', model: 'gpt-4.1' }`
— the exact pair AC-61 changed. Found by T2's own `grep`, outside its Owned paths, so it correctly
did not touch it. Confirmed at the source line by the orchestrator.

**Why it matters more than a red test.** Two recorded facts compound: no gate typechecks
`server/test/`, and a whole-suite `vitest run` silently skips most `.it.test.ts` files even when
Docker is up. So this can stay red for months while every visible signal is green.

Owned path: `server/test/settings-models.it.test.ts`

Change: the two values, to whatever the three registry declarations now carry. Read them from
`server/src/vendor/shared/contracts/platform.ts` rather than from this plan, so the test and the
registry cannot disagree again. Change nothing else in the file.

Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json \
  > /tmp/f2.txt 2>&1; grep -c 'error TS' /tmp/f2.txt   # must be 16, the standing baseline
cd server && grep -n -A3 "risk_brief'" test/settings-models.it.test.ts   # must show openrouter
# Docker IS authorised for this round, and devdigest-postgres is up:
cd server && CI=true ./node_modules/.bin/vitest run settings-models.it \
  > /tmp/f2b.txt 2>&1; echo "rc=$?"; tail -8 /tmp/f2b.txt
```
Read the `↓` skip lines, not the pass count: a whole-suite run silently skips most `.it.test.ts`
files, so a green summary is not evidence this file executed.

## F3 — six new client files label the feature `(L06)`

**The finding.** The branch is `L05-spec-driven-development`, the spec is SPEC-03, and every other
file in the diff says L05. The architecture reviewer named two files; the orchestrator's own
`grep -rn "L06" client/src server/src` found **six**.

Owned paths:
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/BriefCard.tsx`
- `.../BriefCard/constants.ts`
- `.../BriefCard/helpers.ts`
- `.../BriefCard/styles.ts`
- `.../PrDetailView/PrDetailView.tsx` (line 79 only)
- `client/src/lib/hooks/brief.ts`

Change: `L06` → `L05` in those six comments and nowhere else. **Leave every other `L06` in the
tree alone** — `client/src/app/skills/_components/SkillEditor/constants.ts`,
`client/src/vendor/shared/contracts/eval-ci.ts` and `server/src/modules/repo-intel/README.md` are
pre-existing and legitimately about a future lesson.

Done-condition:
```sh
cd client && CI=true ./node_modules/.bin/tsc --noEmit
grep -rn "L06" client/src/app/repos client/src/lib/hooks   # 0 lines = pass
grep -rlc "L06" client/src/app/skills client/src/vendor/shared/contracts/eval-ci.ts \
  server/src/modules/repo-intel/README.md   # must still match — these are NOT yours
cd client && CI=true ./node_modules/.bin/vitest run > /tmp/f3.txt 2>&1; echo "rc=$?"; tail -4 /tmp/f3.txt
```

## Exit conditions for this round

The round is done when all three Done-condition blocks are green and the standing figures have not
moved: `depcruise` `0 errors, 22 warnings`; `tsc -p tsconfig.eslint.json` at 16 pre-existing errors
across the six known files; client `tsc` clean. Server and client unit counts may only go **up**,
and only by tests this round added.

Two exits, per `remediation.md`: this round's budget (`max-fix:2`, so one more round is available)
and **no progress** — a round that changes nothing the reviewers can see. Anything surviving is
`escalated` with what it needs and what it blocks.
