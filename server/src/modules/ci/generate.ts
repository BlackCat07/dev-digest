import type { CiFile } from '@devdigest/shared';
import { CI_RUNNER_PATH, CI_WORKFLOW_PATH } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { MAX_BUNDLE_BYTES } from './constants.js';
import {
  byteLength,
  manifestPath,
  skillPath,
  slugify,
  resolveTriggerTypes,
} from './helpers.js';
import { buildManifest } from './manifest.js';
import { buildWorkflow } from './workflow.js';
import type { CiAgentFacts, CiLinkedSkill } from './types.js';

/**
 * The whole generated file set, assembled from facts alone.
 *
 * Pure: an agent, its linked skills, the runner bundle as a string and the two
 * request options in; a `CiFile[]` out. No container, no clock, no GitHub — which
 * is what lets AC-1 … AC-14 and AC-20 be tested with no fakes and what makes
 * AC-2 ("a preview performs no GitHub write") true by construction rather than by
 * discipline.
 *
 * The order is fixed — workflow, manifest, skills by slug, runner — because the
 * Preview step lists files in it and two previews of the same agent must not
 * reorder under the user.
 *
 * **`editable: false` on every file.** The preview shows what will be committed;
 * a field the client could flip to `true` would be an invitation to hand-edit a
 * `permissions:` block on its way into someone else's repository.
 *
 * **Skill bodies go out RAW.** They are the bodies of the skills their paths
 * name, not the wrapped form `SkillsService` produces for a prompt this server
 * assembles — see the note on `CiAgentSource` in `types.ts`.
 */

export interface GenerateInput {
  agent: CiAgentFacts;
  skills: readonly CiLinkedSkill[];
  runnerBundle: string;
  /** Raw request value; intersected with the supported set here. */
  triggers: readonly string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
}

export function generateBundle(input: GenerateInput): CiFile[] {
  const { agent, skills, runnerBundle, triggers, postAs } = input;
  const agentSlug = slugify(agent.name);

  // Disabled links are not part of the agent's behaviour and must not be part of
  // its export: shipping one would make the CI reviewer apply a skill the studio
  // shows as switched off.
  const enabled = skills.filter((s) => s.skill.enabled);
  const skillFiles = enabled
    .map((s) => ({ slug: slugify(s.skill.name), body: s.skill.body }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const files: CiFile[] = [
    {
      path: CI_WORKFLOW_PATH,
      contents: buildWorkflow({
        agentSlug,
        triggerTypes: resolveTriggerTypes(triggers),
        postAs,
      }),
      editable: false,
    },
    {
      path: manifestPath(agentSlug),
      contents: buildManifest({ agent, skillSlugs: skillFiles.map((s) => s.slug) }),
      editable: false,
    },
    ...skillFiles.map((s) => ({
      path: skillPath(s.slug),
      contents: s.body,
      editable: false,
    })),
    { path: CI_RUNNER_PATH, contents: runnerBundle, editable: false },
  ];

  const total = files.reduce((sum, f) => sum + byteLength(f.contents), 0);
  if (total > MAX_BUNDLE_BYTES) {
    throw new ValidationError(
      `Generated bundle is ${total} bytes, over the ${MAX_BUNDLE_BYTES}-byte limit for one export`,
    );
  }

  const empty = files.find((f) => f.contents.length === 0);
  if (empty) {
    // A zero-byte file is committable and useless, and the runner bundle is the
    // one that goes empty in practice — an unbuilt `agent-runner/dist`. Naming
    // the path here is the difference between a five-minute fix and a CI run
    // that dies with "cannot find module".
    throw new ValidationError(`Generated file "${empty.path}" is empty; nothing was exported`);
  }

  return files;
}
