import { stringify } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { CiAgentFacts } from './types.js';

/**
 * The agent manifest the export writes to `.devdigest/agents/<slug>.yaml` and the
 * runner reads back weeks later.
 *
 * **Serialised, not templated, and that is the opposite call from `workflow.ts`.**
 * `system_prompt` is arbitrary multi-line user text: hand-templating it into YAML
 * works until the first prompt containing a colon, a quote, a tab or a `---`, at
 * which point the export writes a file the runner cannot parse into a repository
 * whose owner has no idea why. Nothing about a manifest needs to be reviewed by
 * eye the way the workflow's `permissions:` block does, so nothing is lost.
 *
 * **The object is PARSED against the contract before it is serialised.** The
 * schema is the same one the runner validates with, so a manifest that would fail
 * there fails here instead — where there is somebody to tell.
 *
 * **`ci_fail_on` is always written.** `AgentManifest` defaults it to `critical`,
 * and relying on that default would mean an agent stored as `never` exports a
 * manifest that blocks on every critical finding — the setting silently inverted
 * by an omission. The value comes off the agent record at generation time.
 */

export interface ManifestInput {
  agent: CiAgentFacts;
  /** Slugs of the agent's enabled linked skills, in the order the files are written. */
  skillSlugs: readonly string[];
}

export function buildManifest(input: ManifestInput): string {
  const { agent, skillSlugs } = input;

  const parsed = AgentManifest.safeParse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: [...skillSlugs],
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  });

  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Agent cannot be exported as a manifest — ${where}`);
  }

  return stringify(
    {
      name: parsed.data.name,
      provider: parsed.data.provider,
      model: parsed.data.model,
      system_prompt: parsed.data.system_prompt,
      // An agent with no skills writes the KEY with no value, which reads back as
      // `null`. `AgentManifest.skills` is `.nullish().transform(v => v ?? [])`
      // precisely so that shape parses; `.default([])` would not catch it.
      skills: parsed.data.skills.length > 0 ? parsed.data.skills : null,
      strategy: parsed.data.strategy,
      ci_fail_on: parsed.data.ci_fail_on,
    },
    { nullStr: '' },
  );
}
