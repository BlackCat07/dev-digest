import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';

/**
 * Load an agent from the `.devdigest/` layout the studio exports: the manifest
 * YAML (validated against the SHARED AgentManifest schema, so studio↔runner can
 * never drift) plus its skill bodies resolved from `<skillsDir>/<slug>.md`.
 * Skill-slug resolution is the runner's I/O job; the engine takes resolved
 * bodies.
 *
 * Every body is wrapped as UNTRUSTED. The studio's own `SkillsService` exempts
 * skills whose `source` is `manual`, because there a human in this workspace
 * typed them; here there is no such column and no such claim — a skill body is
 * a markdown file in a repository DevDigest does not control, sitting next to
 * the pull request it is about to review. The exemption does not travel.
 */
export interface LoadedAgent {
  manifest: AgentManifest;
  /** Resolved, untrusted-wrapped skill bodies, in manifest order. */
  skillBodies: string[];
  /** Manifest slugs that resolved to no file — surfaced, never silently dropped. */
  missingSkills: string[];
}

/** A manifest that does not satisfy the shared contract, named down to the field. */
export class ManifestError extends Error {
  constructor(
    readonly file: string,
    readonly fields: string[],
    message: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

export async function loadAgent(agentYamlPath: string, skillsDir: string): Promise<LoadedAgent> {
  let raw: string;
  try {
    raw = await readFile(agentYamlPath, 'utf8');
  } catch {
    throw new ManifestError(agentYamlPath, [], `${agentYamlPath}: agent manifest not found`);
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ManifestError(agentYamlPath, [], `${agentYamlPath}: not valid YAML — ${detail}`);
  }

  // safeParse, not parse: an invalid manifest is a reported outcome of this run
  // (named file, named field, written result), not a stack trace.
  const parsed = AgentManifest.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      field: i.path.length > 0 ? i.path.join('.') : '(root)',
      message: i.message,
    }));
    const fields = issues.map((i) => i.field);
    const detail = issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    throw new ManifestError(
      agentYamlPath,
      fields,
      `${agentYamlPath}: invalid agent manifest — ${detail}`,
    );
  }
  const manifest = parsed.data;

  const skillBodies: string[] = [];
  const missingSkills: string[] = [];
  for (const slug of manifest.skills) {
    let body: string;
    try {
      body = await readFile(join(skillsDir, `${slug}.md`), 'utf8');
    } catch {
      missingSkills.push(slug); // surfaced by the caller — never silently dropped
      continue;
    }
    skillBodies.push(wrapUntrusted(`skill:${slug}`, `### ${slug}\n${body.trim()}`));
  }
  return { manifest, skillBodies, missingSkills };
}
