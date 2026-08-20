# Implementation report — PR Brief (SPEC-03) / T8

**Status: complete.**

As of `06d7488` (`L05-spec-driven-development`); 1 file changed, 2 added, nothing committed. The tree also carries waves 1–4's uncommitted work, which this task did not touch.

## Coverage

- INSIGHTS client: 32 entries, 5 relevant (2026-08-11 — a mutation that omits an optional request field is a silently successful no-op, and only asserting the outgoing body at the `fetch` boundary sees it; 2026-08-10 — no `@testing-library/user-event` and **no shared QueryClient test helper**, each test builds one inline; 2026-08-19 — under fake timers a `refetchInterval` refetch commits its data on the render *after* the timer, so `flush(1)` is what lands it; 2026-08-03 + addendum — client imports of `@devdigest/shared` must stay `import type`; 2026-08-06/CLAUDE.md — `apiFetch`'s conditional `content-type` must not be "simplified").
- INSIGHTS server: not read — no file under `server/` is in T8's Owned paths and none was opened for writing.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | `client/src/lib/hooks/brief.ts`, `client/src/lib/hooks/index.ts` |
| `react-best-practices` | preloaded | `client/src/lib/hooks/brief.ts` |
| `react-testing-library` | preloaded | `client/src/lib/hooks/brief.test.tsx` |
| `typescript-expert` | preloaded | all three files |

Matches the plan's routing table for T8: yes, exactly those four.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/lib/hooks/brief.ts` | T8 | yes | new — `usePrBrief(prId)` over `GET /pulls/:id/brief` with a function-form `refetchInterval` on `generation_state === "running"`; `useGenerateBrief(prId)` over `POST /pulls/:id/brief/generate` sending `FORCE_BODY` (`{ force: true }`, typed `GenerateBriefPayload`) and invalidating `["pr-brief", prId]`; local `BriefGenerateAccepted` interface for the 202; both contract imports `import type` |
| `client/src/lib/hooks/index.ts` | T8 | yes | one line — `export * from "./brief";`, after `./blast` |
| `client/src/lib/hooks/brief.test.tsx` | T8 | yes | new — 5 tests, `fetch` stubbed via `vi.stubGlobal`, inline `QueryClient` wrapper, fake timers |

Not touched: `client/src/lib/api.ts` (`git diff --stat` empty), every component file.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| R1 (client half — a read answers the stored brief; no traffic when idle) | T8 | yes — `enabled: !!prId`, and the interval is `false` for `never_generated` and `done`; asserted by "makes no further request for a never-generated brief, or any at all with no prId" (10 s of fake time, still 1 call) |
| R3 (a regenerate rebuilds regardless — `force: true`) | T8 | yes — `JSON.parse(String(post[1].body))` equals `{ force: true }`, asserted on the outgoing request, not the response |
| R22 / AC-44 (the card's regenerate control sends `force: true`) | T8 | yes — same assertion; the control itself is T10's, this is its data half |
| Polls only while `running` | T8 | yes — 1 → 2 → 3 calls across two 2000 ms windows, then zero further calls once the payload turns `done` (`flush(1)` used to land the commit) |
| Mutation invalidates rather than writing the response into the cache | T8 | yes — after the POST the query's data reads `running`, and a following poll window adds more GETs |
| Every `@devdigest/shared` import is `import type` | T8 | yes — `grep` shows two import lines, both `import type`; the 202 shape is a local `interface` |
| Test stubs `fetch`, not `api`/`apiFetch` | T8 | yes — `vi.stubGlobal("fetch", fetchMock)`; `apiFetch`'s conditional `content-type` stays inside the code path under test |

## Deviations from the plan

None.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `CI=true ./node_modules/.bin/tsc --noEmit` | pass — rc=0, no output |
| client | lint | `CI=true ./node_modules/.bin/eslint "src/lib/hooks/brief.ts" "src/lib/hooks/brief.test.tsx" "src/lib/hooks/index.ts"` | pass — rc=0 (only the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` node warning) |
| client | unit | `CI=true ./node_modules/.bin/vitest run` | pass — 48 files / 401 tests, 0 failures. Baseline run **before** the first edit on the same dirty tree was 47 / 396, so the 5 new tests are the whole delta and nothing regressed |
| server | — | — | gate did not run — no `server/` file was touched; another implementer owns `server/` in this wave |
| client | integration / e2e | — | gate did not run — Docker not authorised, and not requested |

Each path was quoted separately in the `eslint` invocation (zsh does not word-split), and every gate's output was redirected and read by exit code plus tail.

## Not done

- `absent` — the brief card, the Overview wiring and the `?file=`/`?line=` URL plumbing. Those are T10 (wave 6); nothing under `client/src/app/**` was touched.
- `absent` — the routes these hooks call. `GET /pulls/:id/brief` and `POST /pulls/:id/brief/generate` land in T13 (wave 9). Expected: the test stubs `fetch`, so nothing here needs a live server, and no request was made against a running API.
- `not checked` — behaviour in the running app (`DDG-UI-001`). No component renders these hooks yet, so there is nothing to look at; the flag belongs to T10.
- `not checked` — the two optional `targetFile` / `targetLine` props on `DiffTab` / `SmartDiffViewer` in the working tree. Wave 4's work, wired by T10.

## For the parent

- No `INSIGHTS.md` candidate. The three insights this task leaned on (2026-08-11 outgoing-body assertion, 2026-08-10 no shared QueryClient helper, 2026-08-19 `flush(1)`) all held exactly as written and re-recording them would duplicate. Nothing non-obvious was newly discovered.
- `specs/pr-brief.md` was read only as an input via the plan's requirement list; no criterion was contradicted by this diff and no spec file was edited.
- `plan-verifier` has not been run — that is the next step and it is not mine.

---

## Parent's notes on this report

**The cleanest dispatch of the run so far: zero deviations, and the one assertion that matters
is pointed at the right thing.** `force: true` is asserted on the **outgoing request body**,
parsed out of `fetch`'s second argument — not on the response. That distinction is the entire
reason the Intent card's Re-derive button shipped broken: the response was a valid 200 with a
valid record, and the request was empty. A test written against the response passes in both
worlds.

**"No `INSIGHTS` candidate" is the right answer and worth noting as such.** Three recorded
insights were load-bearing for this task and all three held exactly as written. Re-recording
them would duplicate, and the journal's own rules forbid it. An agent that reports nothing
because nothing was learned is doing the protocol correctly, not skipping it.

**The base SHA is right in this report** (`06d7488`), where T3, T5 and T6 each reported
`34cb66e`. Same run, same tree — so the slip in those three was a reading error, not a
different checkout.
