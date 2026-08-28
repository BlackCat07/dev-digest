# Dispatching subagents

Rules for whoever writes the brief, not for the agent that receives it. They exist
because each one has already cost this repository a re-run.

> Not to be confused with [`agent-prompts/`](./agent-prompts/), which holds the
> **product's** reviewer prompts — the `system_prompt` a DevDigest agent uses to
> review a pull request. Nothing here is about those.

## 1 — A subagent inherits no images. Pass a PATH, never a description

A subagent does not see the chat. Screenshots, mockups, a pasted log, a diff shown
in conversation — none of it reaches the brief unless it reaches the **file
system**. `Read` renders images, so a path is all it takes.

**Do not paraphrase the artifact into the brief.** A description of a design is
not a degraded copy of it; it is a *third source of truth*, and it will disagree
with the other two. The disagreement surfaces after the work is built on it.

Measured twice on SPEC-05:

- The spec was written against a prose description of six reference screens. Its
  `AC-29` then required a disagreement group to need **two** flagging agents —
  under which the design's own reference screen renders **zero** groups. One
  `spec-creator` re-run, plus two fix-round items.
- A UI dispatch carried a hand-written "design value → our value" table instead of
  the exports. Tabs mode was reported to have no reference at all (the file is
  there, under a misleading name), and the category tag was removed from columns
  mode against `AC-63`, which requires it in so many words.

The fix costs one `Write` and one line per path.

### Make the artifact legible first

A raw export is often unreadable — a Claude Design canvas file inlines its fonts
as base64 and its computed styles on every element, so it is megabytes of noise
around a few hundred lines of markup. Render it and extract it once, and pass
those:

```sh
# a picture the agent can open
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --virtual-time-budget=4000 --window-size=1440,1400 \
  --screenshot="rendered/NAME.png" "file://$PWD/NAME.html"
```

The same binary renders the **running app**, which is how a UI change gets a
visual check at all: a `curl` of a client route proves nothing about a rendered
control, because the markup arrives after hydration (`client/INSIGHTS.md`,
2026-08-23).

```sh
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --virtual-time-budget=15000 --window-size=1440,1400 \
  --screenshot=after.png "http://localhost:3000/<route>"
```

## 2 — Say where the reference is WRONG, and who wins

A design is drawn against an idea of the product, not against its acceptance
criteria. Where the two disagree the agent cannot know which to follow, so the
brief must say it:

- name the parts of the reference that must **not** be copied, each with its
  reason — a control with no handler behind it, copy that describes a mechanism
  the product does not have;
- state the tie-break explicitly: **an approved `AC-nn` outranks the reference**,
  and a contradiction is reported, not silently resolved.

An agent told this reports the contradiction. An agent not told it picks one, and
the pick is invisible until a screen is wrong.

## 3 — Carry the constraint, not a pointer to it

A brief that cites a rule by path is a brief that will be followed only if the
agent opens the path. Quote the rule. In particular, spell out every time:

- the do-not-touch zones, and which shared primitives accept a `style` prop
  (`Badge`, `Button`, `Card`) versus which would need a `vendor/ui` edit;
- the token table, and that an **undeclared** custom property drops silently, so
  the only symptom of a typo is "it doesn't look like the mock";
- the gates to run, as commands, and that binaries are called directly because a
  `pnpm <script>` can die before the script runs.

**One thing a brief may not buy its way out of.** A dispatch cannot waive a rule
in `CLAUDE.md` — the repository's session protocol won that argument once already,
and an agent that lets a prompt override `CLAUDE.md` is a worse agent. If a
standing rule is wrong for a task, change the rule; do not instruct around it.

## 4 — Disjoint owned paths, and one owner for shared files

Give each agent an explicit list of paths it owns, and say that anything outside
the list is reported rather than reached for. A file two agents both need — a
message catalogue, a parent's `styles.ts` — is edited by the **parent** before the
dispatch goes out, so no agent has to wait on another or race it.
