import type { SkillType } from "@devdigest/shared";

/** Constants for the create-skill modal. */

/** Starting type for a hand-written skill. */
export const DEFAULT_NEW_TYPE: SkillType = "custom";

/** Seed body, so a new skill opens on something rather than an empty editor. */
export const STARTER_BODY = "# Rule\n\nDescribe the rule…\n";
