# Fix plan — round 2

Base `06d7488`, diff uncommitted. **One finding: F1, carried from round 1 where it was blocked.**
This is the last available round (`max-fix:2`).

Round 1 closed F2 (the Docker-gated model-default assertion) and F3 (six `L06` labels) and left
F1 untouched — deliberately, and with a measurement rather than an argument. Its Owned paths in
`fix-1.md` were **wrong**, and the implementer proved it by applying the change, reading the
typechecks, and restoring all four files byte-for-byte from a scratchpad copy. Everything below
is that measurement turned into a correct path list.

## The finding, unchanged

R14 / AC-30 came back `partial` from `plan-verifier`. AC-30 says a brief the model did not produce
"shall carry … the blast map's counts". It does not: `BriefDiffStats` has exactly `files_changed`,
`files_listed`, `additions`, `deletions`, and the blast figures reach only the single log line and
the separate Blast Radius card. Found independently by T13's own implementer and by the verifier.

Still not a do-not-touch violation: `contracts/pr-brief.ts` is **untracked** in both copies — a new
file this feature created in wave 1 — and `DDG-DNT-003` governs reshaping an **existing** export.
`DDG-DNT-001` applies in full: both copies move together and must end byte-identical.

## What round 1 established, and why the path list was wrong

Two facts the first plan did not know:

1. **`diff_stats` is not assembled in `service.ts`.** `assemble.ts:151` declares
   `diffStats: BriefDiffStats` on `AssembledInput` and builds the four-field literal at `:415`;
   `service.ts:576` only forwards `assembled.diffStats`. So the population site was never inside
   F1's granted paths.
2. **One breaking site is invisible to every typechecker.** `server/test/brief-assemble.test.ts`
   has two `expect(result.diffStats).toEqual({…four fields})` assertions — verified by the
   orchestrator at `:430` and `:445`. `toEqual` demands an exact match, so both fail **at runtime**
   the moment `assemble.ts` emits two more keys; `tsc` says nothing, because `toEqual`'s parameter
   type accepts a wider object. A round that fixed only the reported `error TS` sites would have
   turned that suite red.

`.optional()` is the only spelling that would keep the change small, and it is ruled out three
ways: the counts must be on **every** stored brief, the contract file's own header states every
field is `.nullable()` and never `.optional()` on purpose, and `zod`'s
`object-optional-vs-nullable` is explicit that `.optional()` means the key may be missing.
`.nullable()`, `.default(0)` and `.catch(0)` all leave the key **required** in the inferred output
type, so none of them shrinks the blast radius.

## F1 — give `BriefDiffStats` the blast counts

**Decision the round-1 report asked for: the population belongs in `assemble.ts`, not in a spread
in `service.ts`.** `AssembleInput` already receives `blast: BriefBlastFacts`, so `input.blast.counts`
is the same object the log line prints — no re-read of the blast map, and the four-field literal at
`:415` becomes a six-field one in the one place `diff_stats` is actually built. A spread in
`service.ts` would put half the shape in one file and half in another.

Owned paths — the four from round 1 plus the seven it measured:

- `server/src/vendor/shared/contracts/pr-brief.ts`
- `client/src/vendor/shared/contracts/pr-brief.ts`
- `server/src/modules/brief/assemble.ts`
- `server/src/modules/brief/repository.ts`
- `server/src/modules/brief/service.ts`
- `server/test/brief-assemble.test.ts`
- `server/test/brief-service.test.ts`
- `server/test/brief-trigger.test.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/BriefCard.test.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.test.tsx`
- `client/src/lib/hooks/brief.test.tsx`

Forbidden: `contracts/brief.ts` and `contracts/platform.ts` in both copies; `BriefCard.tsx` and
every other **non-test** client file — AC-30 requires the brief to *carry* the counts, not the card
to render them; `file-roles.ts`, `cache-key.ts`, `documents.ts`, `grounding.ts`, `prompt.ts`,
`schemas.ts`, `constants.ts`, `types.ts`; `db/schema/**` and the migrations — the counts live inside
the existing `json` payload and need no column.

Change: two integer fields on `BriefDiffStats` carrying the changed-symbol count and the
impacted-endpoint count, named to match what `BriefBlastReader` already returns. Present on
**every** stored brief, not only a degraded one, so a reader is never asked why a figure appears in
one state and vanishes in another; where the blast map is `degraded` they are the honest zero the
map itself reported. Populate at `assemble.ts:415` from `input.blast.counts`. Then update every
construction site and every assertion in the eleven paths above — including **both** `toEqual`
pairs in `brief-assemble.test.ts`, which no typechecker will point you at.

Extend, do not merely repair: `brief-service.test.ts`'s degraded-brief case should read the two new
figures back, so AC-30 has an assertion rather than a type.

Done-condition:
```sh
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd server && CI=true ./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json \
  > /tmp/f1r2-tsce.txt 2>&1; grep -c 'error TS' /tmp/f1r2-tsce.txt   # must be 16
cd client && CI=true ./node_modules/.bin/tsc --noEmit
diff -q server/src/vendor/shared/contracts/pr-brief.ts \
        client/src/vendor/shared/contracts/pr-brief.ts && echo IDENTICAL
git diff --stat -- server/src/vendor/shared/contracts/brief.ts \
                   client/src/vendor/shared/contracts/brief.ts   # must print nothing
cd server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs \
  --output-type err src ../reviewer-core/src 2>&1 | tail -1   # "0 errors, 22 warnings"
cd server && CI=true ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
  > /tmp/f1r2-sv.txt 2>&1; echo "rc=$?"; tail -6 /tmp/f1r2-sv.txt   # ≥ 741, 0 failures
cd client && CI=true ./node_modules/.bin/vitest run \
  > /tmp/f1r2-cv.txt 2>&1; echo "rc=$?"; tail -6 /tmp/f1r2-cv.txt   # ≥ 414, 0 failures
```

**Both `vitest` runs are load-bearing here, not routine.** The failure this round exists to avoid
is a green `tsc` over a red suite, and it lives in a `toEqual`.

## Exit conditions

Done when every command above is green and the standing figures have not moved: `depcruise`
`0 errors, 22 warnings`; `tsc -p tsconfig.eslint.json` at 16 across the six known files; client
`tsc` clean. Unit counts may only go **up**.

This is the last round. Anything surviving is `escalated` with what it needs and what it blocks —
and for this finding that would mean AC-30 ships unmet, which is a decision for a human, not for a
third round.
