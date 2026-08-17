/**
 * tools/list-agents.ts — `devdigest_list_agents`.
 *
 * The entry point of every other tool that needs an agent: `run_agent_on_pr`
 * takes an agent ID, ids are not guessable, and `agents.name` carries no unique
 * constraint, so a name is not an address either. This tool exists so the model
 * never has to invent one.
 *
 * Three decisions worth stating:
 *
 *  1. **It calls `ApiClient.listAgents()` directly, NOT `Resolver.agents()`.**
 *     The resolver memoises that list for the life of the process, which is right
 *     for enriching an error message and wrong here: this tool's whole contract is
 *     "the agents that exist now". An agent added or disabled in the studio while
 *     the session is open has to show up.
 *  2. **It is the only tool with an `outputSchema`.** Its result is the one a
 *     model consumes PROGRAMMATICALLY — it picks an `id` out of it and passes
 *     that to another tool — so a client that can validate structured output
 *     should validate this one. The other four answer prose-shaped results whose
 *     key set depends on the outcome.
 *  3. **`system_prompt` never leaves this process.** A single agent's prompt runs
 *     to thousands of tokens and the model has no use for it; the projection is
 *     an allowlist of five fields, and `description` is capped.
 */
import { z } from 'zod';
import type { Agent } from '@devdigest/shared';
import { instructionFor } from '../errors.js';
import { toolFailure, type ToolHandler, type ToolPayload } from './schemas.js';

/** Longest agent `description` the projection carries, in characters. */
export const MAX_AGENT_DESCRIPTION_CHARS = 200;

/**
 * The shape `structuredContent` is validated against, and the only `outputSchema`
 * in this package. Kept next to the projection that produces it so the two
 * cannot drift.
 */
export const LIST_AGENTS_OUTPUT_SHAPE = {
  count: z.number().int().describe('How many reviewer agents DevDigest has configured.'),
  agents: z
    .array(
      z.object({
        id: z.string().describe('Pass this as `agent_id` to devdigest_run_agent_on_pr.'),
        name: z.string().describe('Human name. NOT unique - never address an agent by it.'),
        description: z.string().describe('What this agent reviews for.'),
        model: z.string().describe('The model this agent runs on.'),
        enabled: z
          .boolean()
          .describe('False = disabled in the studio, but still runnable when named by id.'),
      }),
    )
    .describe('Every configured agent, ordered by name.'),
  next_step: z
    .string()
    .optional()
    .describe('Present only when no agents exist at all: what to do about that.'),
} as const;

interface ShapedAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly enabled: boolean;
}

function projectAgent(agent: Agent): ShapedAgent {
  const description = agent.description.trim();
  return {
    id: agent.id,
    name: agent.name,
    description:
      description.length > MAX_AGENT_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_AGENT_DESCRIPTION_CHARS - 3).trimEnd()}...`
        : description,
    model: agent.model,
    enabled: agent.enabled,
  };
}

/**
 * Ordered by name, then by id.
 *
 * The id tiebreaker is not defensive: two agents may legally share a name, which
 * is the same fact that makes a name unusable as an address. Without it the list
 * order would depend on the physical row order the API happened to read.
 */
function compareAgents(a: ShapedAgent, b: ShapedAgent): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The message for a workspace with no agents. An empty list is not an error, but
 * answering `{count:0}` and nothing else would leave the model to conclude that
 * reviews are impossible here rather than that one setup step is missing.
 */
function noAgentsNextStep(): string {
  return (
    'DevDigest has no reviewer agents configured, so devdigest_run_agent_on_pr has nothing ' +
    'to run. Create one on the Agents screen in the DevDigest studio (./scripts/dev.sh in ' +
    'the DevDigest repository starts it), then call this tool again. If the studio does show ' +
    'agents, the API is scoping its queries to a workspace it memoised at startup: restart ' +
    'it and retry.'
  );
}

export const listAgents: ToolHandler = async (_rawArgs, deps) => {
  const fetched = await deps.client.listAgents();
  if (!fetched.ok) return toolFailure(instructionFor(fetched.failure));

  const agents = fetched.data.map(projectAgent).sort(compareAgents);
  const payload: ToolPayload = {
    count: agents.length,
    agents,
    ...(agents.length === 0 ? { next_step: noAgentsNextStep() } : {}),
  };
  return { ok: true, payload };
};
