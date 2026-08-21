/* hooks/project-context.ts — React Query hooks for Project Context (L05).

     GET  /repos/:id/context           → every markdown document in the clone
     GET  /repos/:id/context/doc?path= → one document's text
     GET  /agents/:id/context          → that agent's attachments
     POST /agents/:id/context          → replace them, for one repository
     GET  /skills/:id/context          → that skill's attachments
     POST /skills/:id/context          → replace them, for one repository

   The shapes come from the contract in `@devdigest/shared`
   (`contracts/project-context.ts`), and every import of it here is
   `import type` — a runtime value import from that barrel resolves under `tsc`
   and under vitest and then 500s every route that transitively reaches it under
   `next build` (`INSIGHTS.md`, Recurring Errors, 2026-08-03). Runtime helpers
   for this feature live in `src/lib/context-docs.ts`. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextAttachment,
  ContextAttachmentInput,
  ProjectDocList,
  SpecFile,
} from "@devdigest/shared";

/**
 * Every markdown document the repository's clone carries.
 *
 * Derived per request: no row, no cache on the server, nothing enqueued. The
 * response is an ENVELOPE, and an empty `docs` is never self-explanatory — a
 * repository with no documents and a repository with no local clone both come
 * back empty, and only `status` / `reason` separate the two. Branch on
 * `status`, never on `docs.length`.
 *
 * `roots` is the roots that were actually searched, so an empty state can name
 * where it looked instead of asserting there is nothing to find; `total` counts
 * matches BEFORE the cap, so a full page is never read as the whole set.
 *
 * Keyed `["context", repoId]` — the key `useContextFiles` has always used, and
 * the one `useReindexContext` invalidates.
 */
export function useProjectDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ProjectDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/**
 * One document's full text, for the preview pane.
 *
 * The path travels as a QUERY PARAMETER, and `encodeURIComponent` here is what
 * makes that safe: a repo-relative path may hold a space, a `#` or non-ASCII,
 * and any of those unencoded either truncates the value at the fragment or
 * arrives as a different path than the one the reader clicked.
 *
 * A refusal — a document that vanished from the clone, or one the confinement
 * check rejected — comes back as a 200 carrying an empty `content`, not as a
 * throw, so this query resolves rather than erroring on the ordinary case of a
 * stale list.
 */
export function useProjectDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<SpecFile>(`/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
  });
}

/** The documents attached to one agent, across every repository it holds a set for. */
export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<ContextAttachment[]>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

/** The documents attached to one skill, across every repository it holds a set for. */
export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ContextAttachment[]>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

/** An owner id plus the complete replacement set for one of its repositories. */
export type SetAgentContextInput = { agentId: string } & ContextAttachmentInput;
export type SetSkillContextInput = { skillId: string } & ContextAttachmentInput;

/**
 * Replace an agent's attached documents for ONE repository.
 *
 * Attach, detach and reorder are all this one call, the shape
 * `useSetAgentSkills` already uses: the body carries the whole ordered array, so
 * the client never computes a diff and the server never reconciles a partial
 * update against a stale order. The corollary is the trap — toggling a single
 * document must send every path that is still attached. Sending only the toggled
 * one detaches everything else, and it does so with a 200 and a successful
 * invalidation, which is exactly the class of silent no-op
 * `src/lib/hooks/intent.test.tsx` exists to catch.
 *
 * `repo_id` is not optional and is not inferable server-side. The write is
 * scoped to it: rows this agent holds against its OTHER repositories are left
 * alone, because the tab that sends this is open on one repository and can
 * neither show nor intend the set a global replace would erase.
 *
 * Invalidated rather than written into the cache from the response: the list of
 * discovered documents carries `used_by_agents` per document, so an attachment
 * change moves a figure that is not in this response at all.
 */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...body }: SetAgentContextInput) =>
      api.post<ContextAttachment[]>(`/agents/${agentId}/context`, body),
    onSuccess: (_data, { agentId, repo_id }) => {
      qc.invalidateQueries({ queryKey: ["agent-context", agentId] });
      qc.invalidateQueries({ queryKey: ["context", repo_id] });
    },
  });
}

/**
 * Replace a skill's attached documents for ONE repository.
 *
 * Same replace-all contract as the agent write above, with one extra
 * consequence: a skill's documents reach every agent that links it, so this also
 * invalidates every agent's attachment query rather than one agent's. A skill is
 * edited from the Skills Lab, where the set of agents inheriting from it is not
 * on screen and cannot be enumerated cheaply.
 */
export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, ...body }: SetSkillContextInput) =>
      api.post<ContextAttachment[]>(`/skills/${skillId}/context`, body),
    onSuccess: (_data, { skillId, repo_id }) => {
      qc.invalidateQueries({ queryKey: ["skill-context", skillId] });
      qc.invalidateQueries({ queryKey: ["agent-context"] });
      qc.invalidateQueries({ queryKey: ["context", repo_id] });
    },
  });
}
