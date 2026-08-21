/* What this agent's ENABLED skills contribute to its effective document set.

   A colocated hook rather than component-body fetching, and colocated rather
   than shared because this tab is its only consumer — the skill editor's own
   Context tab reads one skill through `useSkillContextDocs` and needs none of
   this.

   The N-at-once shape is why it cannot be `useSkillContextDocs` in a loop:
   hooks may not be called from one. `useQueries` is the single-hook form of the
   same read, and it deliberately reuses the `["skill-context", <id>]` key that
   `useSkillContextDocs` and `useSetSkillContextDocs` already use, so these rows
   share that cache entry and are invalidated by a write from the skill editor
   rather than going stale behind it. */
"use client";

import React from "react";
import { useQueries } from "@tanstack/react-query";
import type { ContextAttachment, SkillWithUsage } from "@devdigest/shared";
import { api } from "@/lib/api";
import { useAgentSkills, useSkills } from "@/lib/hooks/skills";
import { attachedPathsFor, type ContextSkillContribution } from "@/lib/context-docs";

export interface SkillContributions {
  /** In skill-link order — the order a run merges them in. */
  contributions: ContextSkillContribution[];
  isLoading: boolean;
}

/**
 * The linked, ENABLED skills' attachments for one repository, in link order.
 *
 * Disabled skills are dropped here rather than in the renderer because a
 * disabled skill contributes nothing to a run: showing its documents as
 * inherited would make the tab claim a prompt the engine will not assemble.
 */
export function useSkillContributions(
  agentId: string,
  repoId: string | null | undefined,
): SkillContributions {
  const skills = useSkills();
  const links = useAgentSkills(agentId);

  // `?? []` inside the memo, never outside: a fresh array on every render
  // changes the dependency identity and defeats the memo it is passed to.
  const linked = React.useMemo(() => {
    const byId = new Map((skills.data ?? []).map((skill) => [skill.id, skill]));
    return (links.data ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((link) => byId.get(link.skill_id))
      .filter((skill): skill is SkillWithUsage => !!skill && skill.enabled);
  }, [skills.data, links.data]);

  const results = useQueries({
    queries: linked.map((skill) => ({
      queryKey: ["skill-context", skill.id],
      queryFn: () => api.get<ContextAttachment[]>(`/skills/${skill.id}/context`),
    })),
  });

  const contributions = linked.map((skill, i) => ({
    skill_id: skill.id,
    skill_name: skill.name,
    paths: attachedPathsFor(results[i]?.data ?? [], repoId),
  }));

  return {
    contributions,
    isLoading: skills.isLoading || links.isLoading || results.some((r) => r.isLoading),
  };
}
