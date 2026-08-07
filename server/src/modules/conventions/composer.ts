import type { ExtractedConvention } from '@devdigest/shared';

/**
 * Accepted candidates → the text of a skill.
 *
 * A skill body is configuration TEXT injected into a reviewing agent's prompt.
 * It is never executed and grants no capability, so the only thing that matters
 * here is whether a model reading it can act on it — which means checkable
 * statements, real citations, and no invented authority.
 *
 * Three things this deliberately does NOT write, following
 * `docs/agent-prompts/README.md`:
 *
 *  - **No severity mapping.** The agent's own rubric owns severity. An extractor
 *    guessing that "naming" is a WARNING would quietly override the rubric of
 *    every agent the skill is attached to.
 *  - **No output-shape or JSON instructions.** The response schema is enforced
 *    out of band; prose about it only ever contradicts the schema.
 *  - **No finding quota.** "Flag up to 3 of these" reads as a target and gets
 *    padded to three.
 *
 * What it does write, and why: the ADHERENCE line. "Followed in 312 of 316
 * places" tells the reviewing model the rule is near-absolute; "in 41 of 55"
 * tells it exceptions are normal here and a single deviation is not news. That
 * distinction is the difference between a useful house rule and a nag.
 *
 * Pure — takes candidates, returns text.
 */

export interface ComposedSkill {
  name: string;
  description: string;
  body: string;
  /** Distinct files cited, stored on `skills.evidence_files`. */
  evidenceFiles: string[];
  /** Which candidates went in, so they can be linked back to the new skill. */
  candidateIds: string[];
}

/** `acme/payments-api` → `payments-api`. */
export function repoSlug(fullName: string): string {
  const last = fullName.split('/').pop() ?? fullName;
  return slugify(last) || 'repo';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A stable, readable heading id for one rule. */
export function ruleSlug(rule: string, maxLength = 48): string {
  const slug = slugify(rule);
  if (slug.length <= maxLength) return slug || 'rule';
  // Cut on a word boundary so the heading does not end mid-word.
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 12 ? cut.slice(0, lastDash) : cut) || 'rule';
}

/** Fence language from a path, for the evidence block. */
export function fenceLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'jsx') return 'jsx';
  return '';
}

/**
 * A fence long enough to contain `code`.
 *
 * Real source contains backtick runs — a template literal, a markdown example, a
 * JSDoc block. A fixed three-backtick fence would be closed early by the snippet
 * and the rest of the skill body would render as prose inside the reviewer's
 * prompt.
 */
export function fenceFor(code: string): string {
  const longestRun = [...code.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  );
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** One rule as a `##` section with its evidence. */
export function renderRule(candidate: ExtractedConvention): string {
  const parts = [`## ${ruleSlug(candidate.rule)}`, '', candidate.rule];

  if (candidate.rationale.trim()) parts.push('', candidate.rationale.trim());

  if (candidate.adherence) {
    const total = candidate.adherence.conforming + candidate.adherence.violating;
    parts.push(
      '',
      `Followed in ${candidate.adherence.conforming} of ${total} places in this repository.`,
    );
  }

  const evidence = candidate.evidence[0];
  if (evidence) {
    const fence = fenceFor(evidence.snippet);
    const range =
      evidence.start_line === evidence.end_line
        ? `${evidence.start_line}`
        : `${evidence.start_line}-${evidence.end_line}`;
    parts.push(
      '',
      `Detected in \`${evidence.path}:${range}\`:`,
      '',
      `${fence}${fenceLang(evidence.path)}`,
      evidence.snippet,
      fence,
    );
  }

  return parts.join('\n');
}

/** The paragraph under the H1. */
function intro(repoFullName: string): string {
  return (
    `House conventions for \`${repoFullName}\`, extracted from its code and verified against it. ` +
    'Flag a change that violates a rule below and cite the offending `file:line`. ' +
    'A rule that is followed in most but not all places has exceptions here — say so ' +
    'rather than treating a single deviation as a defect.'
  );
}

function renderBody(title: string, repoFullName: string, rules: ExtractedConvention[]): string {
  return [`# ${title}`, '', intro(repoFullName), '', ...rules.map(renderRule)].join('\n');
}

function distinctFiles(candidates: ExtractedConvention[]): string[] {
  const files = new Set<string>();
  for (const candidate of candidates) {
    for (const evidence of candidate.evidence) files.add(evidence.path);
  }
  return [...files];
}

/**
 * Compose ONE skill from every accepted candidate.
 *
 * There used to be a second shape here — one skill per category, chosen by a
 * `mode` on the request. It was removed: which rules belong together is the
 * user's call, made by accepting candidates and running this once per group they
 * want, and a machine split on `category` cut across that. Nothing derives a
 * skill boundary from the taxonomy any more.
 *
 * The caller has already filtered to ACCEPTED candidates — this function is
 * given what to write, not what to include. Keeping the filter out here means a
 * test of the filter is a test of the rule ("a rejected candidate never reaches
 * a skill") rather than a test of string assembly.
 *
 * Returns `null` when there is nothing to write, so the caller can report
 * "nothing accepted" instead of creating an empty skill.
 */
export function composeSkill(
  repoFullName: string,
  candidates: ExtractedConvention[],
  overrides: { name?: string; description?: string } = {},
): ComposedSkill | null {
  if (candidates.length === 0) return null;

  const slug = repoSlug(repoFullName);
  const name = overrides.name?.trim() || `${slug}-conventions`;

  return {
    name,
    description:
      overrides.description?.trim() ||
      `${candidates.length} house ${plural(candidates.length, 'convention')} extracted from ${slug}`,
    body: renderBody(name, repoFullName, candidates),
    evidenceFiles: distinctFiles(candidates),
    candidateIds: candidates.map((c) => c.id),
  };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
