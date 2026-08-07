/**
 * Skill helpers shared by the Skills screens and the agent editor's Skills tab.
 *
 * Lives in `src/lib/` rather than beside a component because three route
 * subtrees need it: `skills/_components/*`, `skills/[id]/_components/*`, and
 * `agents/[id]/_components/AgentEditor/_components/SkillsTab`.
 *
 * These are RUNTIME values, deliberately not imported from `@devdigest/shared`.
 * A runtime import from that package breaks `next dev`/`next build` with
 * "Can't resolve './contracts/findings.js'" while `tsc` and vitest both pass —
 * see `INSIGHTS.md` (Recurring Errors, 2026-08-03). Client imports of the
 * contracts stay `import type`; this file is the runtime mirror, exactly as
 * `severity.ts` is for `Severity`.
 */
import type { SkillSource, SkillType, SkillWithUsage } from "@devdigest/shared";

/** Display order for the type filter and the type select. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/**
 * Type → accent colour. Values match the product design; `custom` is
 * deliberately grey so a typed skill stands out against an untyped one.
 *
 * Not in `@devdigest/ui` alongside `SEV`/`CAT` because those are vendored and
 * this palette belongs to one feature. If a second feature ever needs it, that
 * is the moment to promote it — not before.
 */
export const SKILL_TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#999999",
};

/** Source → icon name in `@devdigest/ui`'s registry. */
export const SKILL_SOURCE_ICON: Record<SkillSource, "Edit" | "Wrench" | "Globe" | "Link"> = {
  manual: "Edit",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
};

/**
 * A skill from any source but `manual` arrived from outside this workspace. Its
 * body is delimiter-wrapped as untrusted data before it reaches a prompt (the
 * server does that), and the UI marks it so a reader knows to vet it before
 * enabling it. Mirrors `TRUSTED_SKILL_SOURCES` in
 * `server/src/modules/skills/constants.ts` — change both together.
 */
export function needsVetting(source: SkillSource): boolean {
  return source !== "manual";
}

/**
 * Approximate token count for a block of prompt text.
 *
 * Deliberately the same `ceil(chars / 4)` heuristic the server's tokenizer
 * adapter falls back to (`server/src/adapters/tokenizer/index.ts`), so the
 * number here and any server-side figure move together. It is an ESTIMATE, not
 * a tiktoken count: shipping the BPE ranks to the browser to put a number next
 * to a textarea is not worth ~1MB of bundle, and the number exists to show that
 * a skill costs context — not to bill anyone.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** `0.74` → `74`. Null (no data) stays null so the caller can render "—". */
export function toPercent(rate: number | null | undefined): number | null {
  if (rate == null) return null;
  return Math.round(rate * 100);
}

/**
 * Case-insensitive filter over a skill's name, description and type.
 *
 * In `src/lib/` rather than a unit's `helpers.ts` because two units in different
 * folders need it — the grid on `/skills` and the rail on `/skills/:id`.
 */
export function filterSkills(skills: SkillWithUsage[], search: string): SkillWithUsage[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) =>
    `${sk.name} ${sk.description} ${sk.type}`.toLowerCase().includes(q),
  );
}
