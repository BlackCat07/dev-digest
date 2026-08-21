# Stage 3 — wave 3 — T5: promote the document renderer, and give the diagram a fallback

**Status: complete.**

As of `7bc2916` (`L05-spec-driven-development`); 2 files changed, 4 files moved, nothing committed. Nothing under `server/` was read for editing or touched.

## Coverage

- INSIGHTS client: 29 entries, 4 relevant (2026-08-05 — `<Markdown>` from `@devdigest/ui` is inline-only, which is why `DocumentMarkdown` exists at all and why `vendor/ui` is not the fix; 2026-08-10 — `@testing-library/user-event` is not a dependency here, so the moved test keeps its `render`/`screen` shape and no dependency was added; 2026-08-03 — `next build` corrupts a running `next dev`, so it was not run; 2026-08-14/08-06 — an undefined CSS custom property silently drops, which is why `styles.ts` moved byte-identical rather than being "tidied").
- INSIGHTS server: not read — no `server/` file is in T5's Owned paths and none was touched.

## Skills applied

| Skill | How loaded | Files |
|---|---|---|
| `frontend-ui-architecture` | preloaded | the move to `client/src/components/document-markdown/`, `DocPreview.tsx` import |
| `react-best-practices` | preloaded | `client/src/components/mermaid-diagram/MermaidDiagram.tsx` |
| `react-testing-library` | preloaded | `client/src/components/document-markdown/DocumentMarkdown.test.tsx` (moved, unmodified) |
| `typescript-expert` | preloaded | both changed `*.tsx` |
| `next-best-practices` | preloaded | client `src/app/**` file touched (`DocPreview.tsx`) — row matched, no rule bore on a one-line import change |
| `security` | preloaded | `DocumentMarkdown.tsx` carries the `javascript:` href guard; verified byte-unchanged |

Matches the plan's T5 row (`frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `typescript-expert`), plus `next-best-practices` and `security`, whose routing-table rows matched the changed files.

## Changes

| File | Task | Owned? | What changed |
|---|---|---|---|
| `client/src/components/document-markdown/DocumentMarkdown.tsx` | T5 | yes | moved from `app/repos/[repoId]/context/_components/DocumentMarkdown/`; **only** the doc-comment's last two paragraphs changed — new home, its two consumers, and why the promotion happened |
| `client/src/components/document-markdown/styles.ts` | T5 | yes | moved, byte-identical |
| `client/src/components/document-markdown/index.ts` | T5 | yes | moved, byte-identical |
| `client/src/components/document-markdown/DocumentMarkdown.test.tsx` | T5 | yes | moved, byte-identical (its `./DocumentMarkdown` import still resolves) |
| `client/src/app/repos/[repoId]/context/_components/DocumentMarkdown/` | T5 | yes | removed (directory gone) |
| `client/src/app/repos/[repoId]/context/_components/DocPreview/DocPreview.tsx` | T5 | yes | import line only: `"../DocumentMarkdown"` → `"@/components/document-markdown"` |
| `client/src/components/mermaid-diagram/MermaidDiagram.tsx` | T5 | yes | one optional `fallback?: React.ReactNode` prop, default `null`, rendered where `state === "invalid"` returned `null`; doc-comment records why a caller cannot pre-validate |

Move verified mechanically against `HEAD` — `git show HEAD:<old path> | diff -u - <new path>` produced **zero** lines for `styles.ts`, `index.ts` and `DocumentMarkdown.test.tsx`, and for `DocumentMarkdown.tsx` a hunk confined to the doc-comment. No component mapping, no restyle, and the `javascript:` href guard is untouched. `DocPreview/styles.ts` was not opened.

## Acceptance

| Requirement | Task | Met |
|---|---|---|
| AC-36 (document bodies render as a document from a shared home) | T5 | yes — renderer promoted intact; its own test passes at the new path |
| AC-38 (enabling — a notice can replace an unrenderable diagram) | T5 | yes — `fallback` prop added; `<MermaidDiagram chart="…" />` with no `fallback` still renders nothing |
| AC-37 (enabling) | T5 | yes — no change was needed beyond the two above |
| `context/_components/DocumentMarkdown/` no longer exists | T5 | yes |
| Project Context screen renders as before | T5 | yes — only its import specifier changed; the full client suite (43 files, 353 tests) is green, including the Context screen's tests |
| `BlastRadiusCard` and its test mock unaffected | T5 | yes — `fallback` is optional with a `null` default; `BlastRadiusCard.tsx:285` and `BlastRadiusCard.test.tsx` are unmodified and green |

The `fallback`-renders-the-notice half of T5's Acceptance is verified by reading the changed branch and by the unchanged default path staying green — **not** by a new test. The `MermaidDiagram` fallback has no row in `## Tests`; the assertion the plan schedules for it is `TourSection.test.tsx`, owned by `test-writer`.

## Deviations from the plan

None.

## Blocked

None.

## Gates

| Package | Gate | Command | Result |
|---|---|---|---|
| client | typecheck | `./node_modules/.bin/tsc --noEmit` | pass — `rc=0`, no output |
| client | unit | `./node_modules/.bin/vitest run` | pass — `rc=0`, 43 test files passed, 353 tests passed; `src/components/document-markdown/DocumentMarkdown.test.tsx (2 tests)` green at its new path |
| client | stale-import grep | `grep -rn "context/_components/DocumentMarkdown\|\.\./DocumentMarkdown" src/` | pass — 0 lines (grep exit 1 on no match, as the plan notes) |
| client | lint | `./node_modules/.bin/eslint src/components/document-markdown/{DocumentMarkdown.tsx,styles.ts,index.ts,DocumentMarkdown.test.tsx} src/components/mermaid-diagram/MermaidDiagram.tsx "src/app/repos/[repoId]/context/_components/DocPreview/DocPreview.tsx"` (paths listed literally) | pass — `rc=0`, 0 errors, 1 warning: `pre-existing` |
| client | build | `next build` | gate did not run — forbidden; it corrupts the `client/.next` a running `next dev` owns |
| server | — | — | gate did not run — no `server/` file was touched (T4 owns that half of wave 3) |

The one lint warning is `react-hooks/set-state-in-effect` at `MermaidDiagram.tsx:51` (`setState("invalid")` inside the effect). It is `pre-existing`: the diff shows the entire effect body byte-unchanged from `HEAD` — the edits are the props signature, the prop doc-comment and the `state === "invalid"` return — and eslint exited `0`, so it is a warning, not a failure.

## Not done

- `not checked` — the running app. `DDG-UI-001`-style visual confirmation of the Project Context screen after the move was not performed; the change is an import specifier plus a doc-comment, and no `next build` or dev server was started.
- `absent` — no test for `MermaidDiagram`'s `fallback` branch. The plan's `## Tests` table assigns that assertion to `test-writer` (`TourSection.test.tsx`); T5's only test row is the moved file.
- `not checked` — server gates, integration tests and e2e flows. Out of T5's scope and not requested; both need Docker.

## For the parent

- T5's `## Tests` row is discharged: the moved test is byte-identical and green at `client/src/components/document-markdown/DocumentMarkdown.test.tsx`. `test-writer` should not re-author it.
- `client/src/app/repos/[repoId]/context/_components/DocPreview/styles.ts:12` still names `DocumentMarkdown` in a prose comment about the deliberate background relationship with its fenced blocks. The name is still correct and the file is Forbidden to T5, so it was not touched — flagged only so nobody reads it later as a dangling reference.
- The moved component's doc-comment now states that the Onboarding Tour's section bodies are its second consumer. That import does not exist yet — T9/T10 add it. If those tasks end up not importing it, the sentence becomes inaccurate.
- `plan-verifier` has not been run, and neither has `/pr-self-review`. Nothing was committed; all work is in the worktree.

---

**Parent's independent re-run of T5's Done-conditions:** stale-import grep 0 lines; the old directory is gone (`context/_components/` now holds only `ContextView`, `DocList`, `DocPreview`); and the moved component's diff against `HEAD` was read in full — **22 changed lines, every one of them inside the doc-comment**, with the `"use client"` directive and the code below it untouched.
