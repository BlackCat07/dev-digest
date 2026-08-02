---
name: engineering-insights
description: Reads and appends the touched module's INSIGHTS.md (client, server, reviewer-core, e2e). Use before answering a question about or changing code in one of those modules — read that file first; during a session the moment you hit something a future agent would otherwise relearn — a gotcha, a working approach, a dead-end antipattern, a codebase convention, a tool/library quirk, a recurring error+fix, or an open question; and again at session end, on wrap up / retro / what did we learn, or when /engineering-insights is invoked. Never duplicates what INSIGHTS.md or CLAUDE.md already says, writes only substantial file-grounded entries, and is strictly append-only — never overwrites.
---

# Engineering Insights

Each module keeps an append-only journal at `<module>/INSIGHTS.md`. This skill has two
halves at opposite ends of the work:

- **Read first** — before answering about a module, load its journal.
- **Capture** — during and after the work, append one durable insight per finding, so the
  next session doesn't relearn it.

A session that reads and writes nothing is normal. A session that writes without reading
is a bug.

## Read first (before the work, not after)

1. **Resolve the module** from the paths or package names in the prompt. Ambiguous →
   `git status --short` to see what's in flight. Still ambiguous → ask; don't guess and
   read the wrong journal.
2. **Read that `INSIGHTS.md` in full.** These files are short. Never `head` them. Two
   modules in scope → read both.
3. **Emit a one-line receipt per file, before anything else:**

   ```
   INSIGHTS server: 4 entries, 1 relevant (2026-08-02 — migrations never run on boot)
   INSIGHTS client: 0 entries
   ```

4. **`0 entries` is a real answer.** If every section reads "no entries yet", say so. Don't
   re-read, don't go hunting for another file.
5. **Treat entries as high-confidence guidance** unless told otherwise. If one contradicts
   the approach about to be taken, raise it **before** starting — discovering the conflict
   afterwards is the failure this journal exists to prevent.

No answer about a module's code ships before that module's receipt.

## Where to write (module routing)

| Work touched | File |
|---|---|
| client (`@devdigest/web`) | `client/INSIGHTS.md` |
| server (`@devdigest/api`, incl. repo-intel) | `server/INSIGHTS.md` |
| reviewer-core (`@devdigest/reviewer-core`) | `reviewer-core/INSIGHTS.md` |
| e2e (`@devdigest/e2e`) | `e2e/INSIGHTS.md` |
| a CI workflow | the journal of the module it gates |
| one cause spanning several modules | the **owning** module only — name the other paths in the same bullet |
| pure root config, no owning module | not a module insight — surface it to the user for root `CLAUDE.md`, write nothing |

Never write the same insight into two journals — two copies drift, and drift is how a
journal starts contradicting itself. Never write insights into this SKILL.md.

## What counts (the 7 sections)

Each `INSIGHTS.md` has fixed sections — append each entry under the right one:

- **What Works** — an approach or solution that worked here.
- **What Doesn't Work** — dead ends and antipatterns. **Highest-value section, most often
  skipped — check it before concluding there's nothing to write.** The code does not
  record what was tried and abandoned; nobody can reconstruct it later.
- **Codebase Patterns** — conventions and architectural decisions, with the reason.
- **Tool & Library Notes** — dependency and tooling quirks.
- **Recurring Errors & Fixes** — an error you'd hit again, its real cause, and the fix.
- **Session Notes** — dated summaries, for when the shape of a session is the lesson.
- **Open Questions** — what's still unresolved, stated precisely enough to pick up.

## Concrete, not banal

Test before writing: **"if this were obvious to anyone reading the code, don't write it."**

| ❌ Noise | ✅ Useful (actionable cold) |
|---|---|
| "Promises can be tricky" | "`Promise.all()` on the ingest pipeline times out past 30 items — use `Promise.allSettled()` in batches of 10" |
| "be careful with the vendored copies" | "a client/server type mismatch is usually `client/src/vendor/shared` lagging the server's canonical copy — no sync script, no CI check; surface the drift, don't sync it" |
| "be careful with the e2e ports" | "the hermetic script runs web 3100 / API 3101 / Postgres 5433 deliberately, so it coexists with a live dev stack" |

More worked examples, good and bad → `references/examples.md`.

## Entry format

One bullet per insight, appended under the matching `##` section:

```
- **YYYY-MM-DD** — <one to three sentences: what actually happens, and what to do
  instead>. Evidence: `path/file.ts` (`symbolName`).
```

A symbol name outlives a line number — use `:42` only when the line itself is the point.
Superseding an earlier entry adds `Supersedes YYYY-MM-DD.`; the old bullet stays.

**Session Notes** groups under a dated subheading instead:

```
### YYYY-MM-DD
- <what the session decided or discovered, one line per point>
```

## Workflow

Copy this checklist and work through it:

```
- [ ] 1. Gate check — was this session substantial?
- [ ] 2. Read the touched module's INSIGHTS.md and its CLAUDE.md
- [ ] 3. Draft ≤5 candidates, ranked by signal
- [ ] 4. Dedup against both files
- [ ] 5. Append (append-only, no approval prompt)
- [ ] 6. One-line summary
```

1. **Gate check.** Did the session produce something substantial — a problem solved, a
   decision made, a non-obvious discovery? If not → **write nothing** and stop. That is a
   valid and common outcome; padding a journal is how it stops being read.
2. **Read first.** Open the module's `INSIGHTS.md` **and its `CLAUDE.md`** before drafting.
   Re-read even if the pre-read already loaded them this session — the file may have
   changed, and dedup has to run against current content.
3. **Draft ≤5 candidates**, ranked by signal — **user corrections and gotchas highest**,
   nice-to-know patterns lowest. Each candidate = the exact proposed bullet + its target
   section + its evidence path.
4. **Dedup.** Drop any candidate already covered by an existing entry, **or already stated
   in that module's `CLAUDE.md`, root `CLAUDE.md`, `README.md`, or `TESTING.md`** — those
   carry most of what is currently known, so this is where real candidates die. If reality
   contradicts an old entry, add a new dated bullet that supersedes it; never edit the old
   one.
5. **Append** the survivors. If nothing survives gate + dedup, write nothing.
6. **Summary.** One line: what was written, to which file, what was skipped and why.

## Non-destructive write contract (hard rule)

This skill is **append-only** and must never clobber existing content:

- **Re-read the target `INSIGHTS.md` immediately before writing** — its state may have
  changed since the session started.
- **Never use the `Write` tool on an existing `INSIGHTS.md`** — `Write` replaces the whole
  file and would destroy every prior entry.
- **Insert with an anchored `Edit`** that adds the bullet under the correct `##` heading.
  Each section carries an `<!-- append below -->` marker; anchor on it.
- **Preserve verbatim** the `# <module> — engineering insights` header, the preamble, the
  Rules and Entry format blocks, every section heading and marker, and every existing
  entry. New content is only ever *added*.
- Replacing a section's `_No entries yet._` placeholder on first append is correct — that
  placeholder is not an entry.
- **Corrections are additive** — supersede a wrong entry with a new dated bullet; never
  rewrite or delete the old one.
- **Idempotent** — if an equivalent entry already exists, skip it. No duplicate, no
  rewrite. This matters because the skill can fire twice in one session (mid-session and
  again at wrap-up).

## Maintenance (not per-session)

Append-only means the file only grows, so keep it lean out of band: prune monthly
(drop fixed-bug, duplicate, and never-needed entries), and aim for ~30 high-value entries
per file before splitting into domain files. Report a file that has outgrown that to the
user rather than pruning it unilaterally.

Treat a journal as a draft under review, not as verified documentation — spot-check it. An
incorrect entry propagates into every future session until someone corrects it.

**Promotion:** when an insight costs a second mistake, it has earned a rule. *Propose* a
one-line version for that module's `CLAUDE.md` (Conventions or Gotchas) and leave the
bullet in place as the record of how it was found. Propose it — never edit a `CLAUDE.md`
silently.
