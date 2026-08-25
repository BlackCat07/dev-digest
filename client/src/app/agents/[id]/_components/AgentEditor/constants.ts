import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. L02 adds Skills, L05 adds Context, L06 adds Evals and CI; Stats
 * arrives with a later lesson.
 *
 * `Context` carries the same `FileText` icon the sidebar's Project Context
 * entry uses, because it edits the set of documents that screen lists.
 *
 * `CI` sits LAST, after `Evals`: the strip reads Config, Skills, Context, Evals,
 * CI. `Stats` stays absent — `messages/en/agents.json` holds
 * `editor.tabs.stats` already, but a tab whose panel does not exist is a control
 * that lies about what the screen can do, so it is not listed until its panel is
 * built. `FlaskConical` is the icon the sidebar's Eval Dashboard entry uses, for
 * the same reason `Context` reuses `FileText`; `GitBranch` is the branch the CI
 * export commits onto.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "GitBranch" },
];

/**
 * Tab keys accepted from `?tab=`. Derived from TABS so adding a tab cannot leave
 * the URL gate behind — the two used to be hand-synced in different files.
 */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);

export const DEFAULT_TAB = "config";
