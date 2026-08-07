/**
 * Skills — the contracts L02 adds on top of `Skill` in ./knowledge.ts.
 *
 * `Skill` itself already matches the `skills` row and is NOT touched here; this
 * file only adds the shapes that had no home before: version history, the usage
 * figures shown on a skill card, the Stats tab payload, and the import request.
 *
 * Rates are NULLABLE on purpose. A skill that has never been carried by a run has
 * no pull rate and no accept rate — that is not the same as 0%, exactly as
 * `RunStats.cost_usd` distinguishes "no data" from "free". Render null as "—".
 */
import { z } from 'zod';
import { Skill, SkillType } from './knowledge.js';

/** One immutable snapshot from `skill_versions`. */
export const SkillVersion = z.object({
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * The compact figures on a skill card, all derived from `run_skills` except
 * `used_by`, which is the current `agent_skills` link count.
 */
export const SkillUsage = z.object({
  /** Agents this skill is linked to right now. */
  used_by: z.number().int(),
  /**
   * Share of runs by linked agents that actually carried this skill, 0..1.
   * null when those agents have no completed runs at all.
   */
  pull_rate: z.number().min(0).max(1).nullable(),
  /**
   * accepted / (accepted + dismissed) over findings from runs that carried this
   * skill, 0..1. null when nothing has been triaged yet.
   */
  accept_rate: z.number().min(0).max(1).nullable(),
  /** Findings produced by runs that carried this skill, last 30 days. */
  findings_30d: z.number().int(),
});
export type SkillUsage = z.infer<typeof SkillUsage>;

/** A skill as the list screen needs it: the row plus its card figures. */
export const SkillWithUsage = Skill.extend({ usage: SkillUsage });
export type SkillWithUsage = z.infer<typeof SkillWithUsage>;

/** The Stats tab payload: the card figures plus their two breakdowns. */
export const SkillStats = z.object({
  usage: SkillUsage,
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  findings_by_category: z.array(
    z.object({ category: z.string(), count: z.number().int() }),
  ),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * Body of `POST /skills/import`. The client reads a `.md` file locally and posts
 * its text — there is no multipart upload anywhere in this app.
 *
 * `name` is optional because the server derives it from the body's first heading
 * when blank. An imported skill is always stored disabled and from an external
 * source; the caller cannot override either.
 */
export const SkillImportPayload = z.object({
  body: z.string().min(1),
  name: z.string().optional(),
  type: SkillType.optional(),
});
export type SkillImportPayload = z.infer<typeof SkillImportPayload>;
