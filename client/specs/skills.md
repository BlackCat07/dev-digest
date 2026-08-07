# Skills — the Skills Lab screen and the agent's Skills tab

A user can write, import, edit and version a skill in the browser, and choose which skills
each agent sends with its prompt and in what order.

Server half of this feature: [`../../server/specs/skills.md`](../../server/specs/skills.md).

## Behaviour

### Skills Lab (`/skills`, `/skills/:id`)

1. `/skills` is a full-width **grid** of skill cards — the same page shape as the Agents
   list, so the two Skills Lab screens read as one product. Opening a skill switches to
   `/skills/:id`, where the same cards become a left **rail** beside the editor.
2. A card carries: type-coloured icon, mono name, an enable toggle, the description, a type
   badge, a source label, and a footer reading `N agents · P% pull · A% accept`.
3. A card for a disabled skill is dimmed. A card whose source is not `manual` also shows a
   `needs vetting` marker.
4. Toggling a card's switch enables/disables that skill and does **not** navigate to it.
5. Clicking a card opens it at `/skills/:id?tab=config`.
6. Searching filters the list on name, description and type. It never reorders it.
7. **Add Skill** offers *Create from scratch* (a modal: name, description, type) and
   *Import from file*.
8. An id that is not in the rail renders "Skill not found" with a way back. There is no
   "nothing selected" state — that route is the grid.

### Skill editor

9. Four tabs — Config, Preview, Stats, Versions — with the active one in `?tab=`. An
   unknown `?tab=` value falls back to Config.
10. **Config** edits name, description, type and the markdown body, and Save writes all four
    at once. The body is a line-numbered editor in a **single frame** — a filename bar
    (`<name>.md`, an `unsaved` marker, a live token estimate), a gutter, and markdown
    headings/bullets coloured as you type. It is not a form field: nesting the vendored
    `<Textarea>` inside a frame draws a visible box inside a box.
11. Save and Cancel are disabled until something changed. While the body differs the footer
    names the version a save would create (`Saving snapshots the body as v{n}`); Cancel
    restores every field to the stored skill.
12. Delete lives in its own section below a rule, with its consequence spelled out — it
    unlinks the skill from every agent, so it must not sit beside the button a user presses
    repeatedly.
13. The **Enabled** toggle writes immediately and on its own — it is not part of Save, so
    enabling a vetted import never carries half-written body text with it.
14. **Preview** renders the body as markdown, labelled "Rendered as the reviewing agent
    receives it". For a non-`manual` source it shows the untrusted-source notice above it.
15. **Stats** shows four tiles (used by, pull frequency, accept rate, findings 30d), the
    agents using the skill, and findings by category. A rate the server sent as `null`
    renders as `—`, never as `0%`.
16. **Versions** lists the body snapshots newest-first, marks the current one, and offers
    Restore on the others. Restore saves the old body as a **new** version on top rather
    than rewinding.

### Import from file

17. The drawer takes a `.md` file, reads it **in the browser**, and shows the parsed body in
    a markdown preview with its token count before anything is sent.
18. The name field prefills from the filename only when the user has not typed one.
19. On success the new skill opens on its Preview tab. It arrives disabled, so it reaches no
    prompt until the user enables it.

### Agent editor → Skills tab

20. The tab lists **every** workspace skill: linked ones first in prompt order, then the
    rest alphabetically and dimmed.
21. A checkbox attaches/detaches. The header badge reads `{linked} of {total} enabled`.
22. A linked row can be dragged by its handle to change prompt order. An unlinked row is not
    draggable — dragging one would have to attach it as a side effect.
23. Every attach, detach and reorder posts the whole ordered `skill_ids` array.
24. A row that is linked but disabled is labelled as such, because it contributes nothing to
    the prompt.
25. Filtering the list is a view only; the order sent to the server is always derived from
    the full list.

### Run trace

26. Every block in the run trace's Prompt assembly section shows a token estimate next to
    its label, including the Skills block, which appears only when the run carried skills.

## Data

| Screen | Reads |
|---|---|
| Grid (`/skills`) and rail (`/skills/:id`) | `GET /skills` → `SkillWithUsage[]` |
| Config / Preview | the same list entry (no second fetch) |
| Stats | `GET /skills/:id/stats` |
| Versions | `GET /skills/:id/versions` |
| Agent Skills tab | `GET /skills` + `GET /agents/:id/skills` |
| Save / toggle | `PUT /skills/:id` · create `POST /skills` · import `POST /skills/import` |
| Attach / reorder | `POST /agents/:id/skills` with `{ skill_ids }` |

Token counts are a client-side `ceil(chars / 4)` estimate — the same heuristic the server's
tokenizer adapter falls back to. Shipping BPE ranks to the browser to label a textarea is
not worth the bundle.

## States

| Case | Renders |
|---|---|
| Loading | three card skeletons in the grid / rail; skeletons in Stats and Versions |
| Load error | `ErrorState` with retry, on whichever surface is showing |
| No skills at all | `EmptyState` with a create CTA |
| Search matches nothing | the same empty state |
| `pull_rate` / `accept_rate` null | `—` on the card and `—` on the Stats tile |
| Skill has no runs | Stats shows the tiles at 0/`—` and "No run has carried this skill yet." |
| Skill linked to no agent | Stats shows "No agent uses this skill yet." |
| Agent has no skills | the tab still lists every workspace skill, all unchecked |
| Empty body | Preview shows "This skill has no body yet." |

## Non-goals

- **No URL or community import.** Their i18n keys (`url.*`, `community.*`, `drawer.tabs`)
  stay in `messages/en/skills.json` unused, for the lesson that builds them — the same
  convention the other unbuilt namespaces follow.
- **No Evals tab.** L06. It is absent rather than mounted empty; a tab that does nothing
  reads as broken.
- **No drag-to-reorder in the Skills Lab grid or rail.** Their order is alphabetical; only
  *prompt* order is user-controlled, and that lives per-agent.
- **No rich-text or CodeMirror editor.** The body editor is a highlighted `<pre>` under a
  transparent `<textarea>` — enough for headings and bullets, with no editor dependency and
  no bundle cost. It does not fold, autocomplete, or wrap: `white-space: pre` is what keeps
  the gutter numbering one physical line each.
- **No client-side Zod validation.** Consistent with the rest of the app: the server's 422
  is the validation, surfaced by the global mutation error toast.
- **No optimistic reordering.** The drop posts and waits; the list is short and a wrong
  order that silently reverts is worse than a beat of latency.

## Implementation

| File | Role |
|---|---|
| `src/app/skills/page.tsx` | thin route entry → the grid |
| `src/app/skills/[id]/page.tsx` | thin route entry → the rail + editor workbench |
| `src/app/skills/_components/SkillsListView/` | the landing grid: header, search, add menu, four load states |
| `src/app/skills/_components/SkillsWorkbench/` | rail + editor for one skill; same four load states |
| `src/app/skills/_components/SkillCard/` | one card, incl. the toggle's `stopPropagation` |
| `src/app/skills/_components/SkillEditor/` | header, tab bar, `?tab=` gate |
| `.../SkillEditor/_components/{ConfigTab,PreviewTab,StatsTab,VersionsTab}/` | the four tabs |
| `.../ConfigTab/_components/SkillBodyEditor/` | the line-numbered, highlighted body editor (two stacked layers; every glyph metric shared from its `styles.ts`) |
| `src/app/skills/_components/ImportSkillDrawer/` | `FileReader` → preview → `POST /skills/import` |
| `src/app/skills/_components/CreateSkillModal/` | name/description/type, then open the editor |
| `src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/` | attach, detach, HTML5 drag reorder |
| `.../SkillsTab/helpers.ts` | `move`, `orderForAgent`, `linkedIdsInOrder` — the reorder arithmetic |
| `src/lib/skill.ts` | runtime constants, `estimateTokens`, `needsVetting`, `toPercent`, `filterSkills` (shared by the grid and the rail, so not a unit's private helper) |
| `src/lib/hooks/skills.ts` | the queries and mutations, and what each invalidates |
| `src/vendor/ui/nav.ts` | the `SKILLS LAB` group (a recorded do-not-touch exception) |
| `.../RunTraceDrawer/_components/PromptBlock/` | the per-slot token count |

`src/lib/skill.ts` exists because runtime values cannot be imported from
`@devdigest/shared` — that breaks `next build` while typecheck and vitest stay green
(`INSIGHTS.md`, 2026-08-03). Contract imports here are `import type` only.

## History

- **2026-08-05** — Added with the L02 Skills feature.
