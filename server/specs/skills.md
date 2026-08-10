# Skills — reusable prompt blocks, and the runs that carried them

Named, typed, versioned blocks of markdown that can be attached to any number of agents and
are injected into a review prompt in a chosen order.

Client half of this feature: [`../../client/specs/skills.md`](../../client/specs/skills.md).
Engine half: [`../../reviewer-core/specs/skills-in-prompt.md`](../../reviewer-core/specs/skills-in-prompt.md).

## Behaviour

1. `GET /skills` returns every skill in the workspace, name-ascending, each with a `usage`
   object (`used_by`, `pull_rate`, `accept_rate`, `findings_30d`).
2. `POST /skills` creates a skill with `source: "manual"`, `version: 1`, and writes a
   matching `skill_versions` row. It responds `201`.
3. `PUT /skills/:id` updates name, description, type, body or `enabled`. **Only a changed
   `body` bumps `version` and appends a `skill_versions` row.** A rename, a retype, an
   enable-toggle, and re-submitting a byte-identical body all leave the version alone.
4. `POST /skills/import` creates a skill from a markdown body. Three things are
   server-decided and not caller-controllable: `source` is `imported_url`, `enabled` is
   `false`, and `name` falls back to a slug of the body's first ATX heading when the caller
   sends none (`imported-skill` when there is no heading either).
5. `DELETE /skills/:id` removes the skill; its versions and its `agent_skills` links cascade.
   The agents themselves are untouched.
6. `GET /skills/:id/versions` returns the body snapshots newest-first;
   `GET /skills/:id/versions/:version` returns one.
7. `GET /skills/:id/stats` returns `usage` plus the agents that link the skill and its
   findings grouped by category.
8. Every route is workspace-scoped. An id belonging to another workspace is a `404`, not a
   `403` — the response does not disclose that the row exists.
9. `POST /agents/:id/skills` (agents module) rejects a `skill_id` that is not in the
   caller's workspace with a **422**, and the rejected call changes no existing link.
10. A review run injects the agent's **enabled** linked skills, in `agent_skills.order`, and
    records one `run_skills` row per skill it carried. A linked-but-disabled skill is absent
    from both.
11. A skill whose `source` is anything but `manual` has its body delimiter-wrapped as
    untrusted data before it reaches the prompt. A `manual` body is passed through bare.
12. An agent with no enabled skills produces a byte-identical prompt to the pre-L02 one.

## Data

| Field | Computed from |
|---|---|
| `usage.used_by` | `agent_skills` joined to `agents`, count for this skill in this workspace |
| `usage.pull_rate` | runs in `run_skills` for this skill ÷ completed runs by the agents that link it; **null** when the denominator is 0 |
| `usage.accept_rate` | `findings.accepted_at` ÷ (`accepted_at` + `dismissed_at`) over findings from runs that carried this skill; **null** when nothing is triaged |
| `usage.findings_30d` | those same findings, where `agent_runs.ran_at` is within 30 days |
| `stats.findings_by_category` | the same finding set, `GROUP BY findings.category` |

Findings are reached the only way the schema allows —
`run_skills.run_id → reviews.run_id → findings.review_id`; `findings` carries neither a run
nor a PR id.

Both sides of `pull_rate` count **only `status = 'done'` runs**. They have to agree, or one
skill shows a rate above 100%.

`run_skills` exists because `agent_skills` records what an agent is configured with *today*,
which is not what a past run carried: a skill can be linked but disabled, toggled off
mid-week, or attached after the run. Deriving statistics from the current link set would
retroactively credit a skill with findings it had no part in.

## Contract changes

This feature **extended `src/vendor/shared/`**, a do-not-touch path
([`../CLAUDE.md`](../CLAUDE.md)). Recorded here so the coordination is on the record:

| File | Change |
|---|---|
| `contracts/skills.ts` | **new file** — `SkillVersion`, `SkillUsage`, `SkillWithUsage` (`Skill.extend`), `SkillStats`, `SkillImportPayload` |
| `index.ts` | one added re-export line |

`Skill`, `SkillType`, `SkillSource` and `AgentSkillLink` in `contracts/knowledge.ts` were
**not touched** — the new file only adds. `SkillWithUsage` uses `Skill.extend(...)`, which
produces a new schema and leaves `Skill` itself unchanged.

The identical file and barrel line were applied by hand to `client/src/vendor/shared/`; that
copy is a manual mirror with no sync script and no CI check, so the two move together or the
types drift.

## States

| Case | Response |
|---|---|
| Skill never carried by a run | `pull_rate: null`, `accept_rate: null` — **not** `0`; the client renders `—` |
| Skill linked to no agent | `used_by: 0`, `stats.agents: []` |
| Findings exist but none triaged | `accept_rate: null`, `findings_30d` still counted |
| Runs exist but all failed | `pull_rate` counts neither side; a workspace with only failed runs reports `null` |
| Agent deleted after its runs | `agent_runs.agent_id` goes null, its `run_skills` rows survive; `pull_rate` is clamped to 1 so a stale numerator cannot exceed the denominator |
| Import with no heading and no name | named `imported-skill`, still `enabled: false` |
| Malformed `:id` or `:version` | `422` at the edge, before the handler |

## Non-goals

- **No import from a URL and no community catalog.** Only a body posted as JSON. A
  server-side fetcher would need a new port, an adapter, and an SSRF story; the i18n keys
  for both already exist for the lesson that builds them.
- **No sanitising of an imported body.** The text is stored verbatim. What protects a run is
  that the skill lands disabled and, once enabled, is delimiter-wrapped — not text matching,
  which only ever catches one phrasing.
- **No per-finding attribution.** `run_skills` attributes a finding to every skill the run
  carried, not to the one that caused it. Nothing in the pipeline knows which rule fired.
- **No change note on a version.** `skill_versions` stores only the body; there is no field
  to author one, so the history labels each entry with its first line.
- **No eval surface.** The Evals tab in the design is L06.

## Implementation

| File | Role |
|---|---|
| `src/db/schema/runs.ts` | `runSkills` — what a run actually carried |
| `src/db/migrations/0012_broken_rick_jones.sql` | generated DDL for it |
| `src/modules/skills/routes.ts` | the nine endpoints and their Zod schemas |
| `src/modules/skills/service.ts` | version rule, import policy, `resolveBodiesForAgent` (enabled filter + untrusted wrap) |
| `src/modules/skills/repository.ts` | `skills` / `skill_versions` / `run_skills`; the usage aggregates |
| `src/modules/skills/helpers.ts` | `isBodyChange`, `deriveSkillName`, `isTrustedSource`, `rate` |
| `src/modules/index.ts` | module registration |
| `src/modules/reviews/run-executor.ts` | `resolveSkills` + the `skills` prompt slot + the `run_skills` write |
| `src/modules/agents/{service,repository}.ts` | workspace check and the transaction on link/reorder |
| `src/platform/container.ts` | `container.skills` binding |
| `src/db/seed-skills.ts`, `src/db/seed.ts` | the ten built-in skills and their agent links |
| `test/skills-helpers.test.ts` | hermetic coverage of the pure rules |
| `test/skills.it.test.ts` | DB-backed coverage (needs Docker) |

## History

- **2026-08-05** — Added with the L02 Skills feature.
