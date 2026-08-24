import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs. L02 adds Skills, L05 adds Context; Evals/Stats/CI arrive with
 * later lessons.
 *
 * `Context` carries the same `FileText` icon the sidebar's Project Context
 * entry uses, because it edits the set of documents that screen lists.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
];

/**
 * Tab keys accepted from `?tab=`. Derived from TABS so adding a tab cannot leave
 * the URL gate behind — the two used to be hand-synced in different files.
 */
export const VALID_TABS: readonly string[] = TABS.map((t) => t.key);

export const DEFAULT_TAB = "config";
