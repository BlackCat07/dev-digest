import type { IconName } from "@devdigest/ui";

/** Constants for the skill editor. */

export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. L05 adds Context.
 *
 * The product design also shows an "Evals" tab; it belongs to L06 and is
 * deliberately absent rather than mounted empty — a tab that does nothing reads
 * as broken, not as forthcoming.
 *
 * `Context` carries the same `FileText` icon the sidebar's Project Context
 * entry and the agent editor's Context tab use, because all three name the same
 * set of documents.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "tabs.preview", icon: "Eye" },
  { key: "context", labelKey: "tabs.context", icon: "FileText" },
  { key: "stats", labelKey: "tabs.stats", icon: "Gauge" },
  { key: "versions", labelKey: "tabs.versions", icon: "GitBranch" },
];

/** Tab keys accepted from `?tab=`; anything else falls back to the first. */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);

export const DEFAULT_TAB = "config";
