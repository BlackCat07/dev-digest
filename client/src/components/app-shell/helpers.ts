/** Pure helpers for AppShell. */

import type { RepoSummary } from "@devdigest/ui";
import type { Repo } from "../../lib/types";

/** Map a lib `Repo` to the `RepoSummary` shape the AppFrame shell context expects. */
export function toShellRepo(r: Repo): RepoSummary {
  return {
    id: r.id,
    full_name: r.full_name,
    default_branch: r.default_branch,
    syncedLabel: r.last_polled_at ? "synced" : "not synced",
  };
}

/** Whether an event target is a text-entry element (guards typing-aware shortcuts). */
export function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return (
    !!node &&
    (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)
  );
}

/**
 * Repo-scoped Onboarding Tour route. Deliberately anchored rather than a
 * `includes("/onboarding")` test: `/onboarding` is the ADD-A-REPOSITORY screen
 * (`src/app/onboarding/page.tsx`), which is not a WORKSPACE screen and must not
 * light up the sidebar's Onboarding Tour entry. `/onboarding` falls through the
 * ladder to `""` — no entry active — which is correct for it.
 */
const ONBOARDING_TOUR_ROUTE = /^\/repos\/[^/]+\/onboarding/;

/** Derive the active sidebar key from the current pathname. */
export function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/multi-agent")) return "multi-agent";
  if (ONBOARDING_TOUR_ROUTE.test(pathname)) return "onboarding-tour";
  if (pathname.includes("/context")) return "context";
  if (pathname.includes("/conventions")) return "conventions";
  if (pathname.includes("/pulls")) return "pulls";
  if (pathname.startsWith("/skills")) return "skills";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/eval")) return "eval";
  if (pathname.startsWith("/memory")) return "memory";
  if (pathname.startsWith("/agent-performance")) return "agent-performance";
  if (pathname.startsWith("/ci-runs")) return "ci-runs";
  return "";
}
