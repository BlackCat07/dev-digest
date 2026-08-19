import type { ChatMessage, OnboardingCommand } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { loadPromptTemplate, renderTemplate } from '../../platform/prompts.js';
import { MAX_PROMPT_TOKENS, SECTION_KINDS, SECTION_TITLES, TOUR_LANGUAGE } from './constants.js';
import type { OnboardingFacts } from './types.js';

/**
 * Prompt assembly for the one structured call.
 *
 * Two rules govern this file, and they are separate criteria because they fail
 * separately:
 *
 *  - **Every repository-derived fact is wrapped as untrusted data** (AC-23).
 *    Paths, dependency chains, endpoint names, the repo map and the declared
 *    commands are all text that came out of somebody's repository, and a comment
 *    in a source file is a direct channel to this model.
 *  - **None of it goes in the SYSTEM message** (AC-24). The system message is
 *    the rendered template and nothing else. A wrapped block placed there would
 *    satisfy AC-23 and still be exactly the failure AC-24 exists to prevent,
 *    because a system message is the one part of the conversation a model is
 *    built to treat as its own instructions.
 *
 * `INJECTION_GUARD` is deliberately NOT appended. That paragraph belongs to
 * `reviewer-core`'s review path; `onboarding.system.md` carries its own
 * untrusted-data clause, and duplicating a guard is the mistake recorded for the
 * `skills` slot (`server/INSIGHTS.md`, 2026-08-05) — a second copy makes the
 * first read as data. Nor is there any pattern matching for hostile phrasing:
 * matching one phrasing only ever catches one phrasing, and `wrapUntrusted`
 * already escapes an attempt to close its own delimiter, so a file whose
 * contents include `</untrusted>` cannot break out (EC-9).
 *
 * The template itself is loaded through `platform/prompts.ts`, which already IS
 * this server's prompt loader — same `src/prompts/` target, same per-process
 * cache. The intent module made the same move away from a module-local copy
 * (`modules/intent/prompt.ts`), and here it is required rather than merely tidy:
 * a second loader would mean this feature module importing Node's own
 * filesystem module, which `.dependency-cruiser.cjs` cannot see
 * (`server/INSIGHTS.md`, 2026-08-10) and which one of this task's own gates
 * greps for — so the name is not spelled out anywhere in this directory.
 */

/** The one template this module loads; the `.md` is `loadPromptTemplate`'s. */
const TOUR_TEMPLATE = 'onboarding.system.md';

/** Counting tokens, as a call signature, so nothing here imports the adapter. */
export interface TokenCounter {
  count(text: string): number;
}

/** Read the tour's system prompt body, cached for the process. */
export async function loadTemplate(): Promise<string> {
  return loadPromptTemplate(TOUR_TEMPLATE);
}

/**
 * The `{{sections}}` list: the five kinds and their titles, in contract order.
 *
 * Ours, not the repository's — which is why it is allowed in the system message.
 * The model is told the kind strings verbatim because they are what it must echo
 * back in `kind`; a section it returns under any other name is discarded.
 */
export function renderSectionList(): string {
  return SECTION_KINDS.map((kind) => `- \`${kind}\` — ${SECTION_TITLES[kind]}`).join('\n');
}

/** The system message: the rendered template, and nothing else (AC-24). */
export function buildSystemMessage(template: string): string {
  return renderTemplate(template, {
    sections: renderSectionList(),
    language: TOUR_LANGUAGE,
  });
}

/**
 * One system message and one user message carrying every collected fact.
 *
 * The user message is measured and, if it is over {@link MAX_PROMPT_TOKENS},
 * the RANKED PATH block is trimmed from its tail — lowest rank first — until it
 * fits. Only that block is trimmable: the commands are the only source the
 * run-locally section has, the chains are the only source the critical-paths
 * section has, and the repo map is already budgeted by the indexer. The ranked
 * list is the one input where the tail is genuinely the least valuable part of
 * it, because it is sorted by the index's own measure of centrality.
 *
 * Trimming shrinks geometrically rather than one path at a time, so the counter
 * runs a couple of dozen times at worst instead of two hundred.
 */
export function buildTourMessages(
  template: string,
  facts: OnboardingFacts,
  commands: readonly OnboardingCommand[],
  tokenizer: TokenCounter,
): ChatMessage[] {
  let paths = facts.rankedPaths;
  let user = renderUserMessage(facts, paths, commands);
  while (paths.length > 1 && tokenizer.count(user) > MAX_PROMPT_TOKENS) {
    paths = paths.slice(0, Math.max(1, Math.floor(paths.length * 0.75)));
    user = renderUserMessage(facts, paths, commands);
  }

  return [
    { role: 'system', content: buildSystemMessage(template) },
    { role: 'user', content: user },
  ];
}

/**
 * Every fact block, each wrapped, under a heading this server wrote.
 *
 * The headings and the closing instruction are ours and stay outside the
 * delimiters — the same split `conventions/prompt.ts` and `intent/prompt.ts`
 * make. A block with no content is omitted entirely rather than sent empty: an
 * empty `<untrusted>` block reads to a model as "this repository has none",
 * which for a degraded index would be a claim nobody measured.
 */
function renderUserMessage(
  facts: OnboardingFacts,
  rankedPaths: readonly string[],
  commands: readonly OnboardingCommand[],
): string {
  const blocks: string[] = [
    section(
      'Repository map (symbols by centrality)',
      wrapBlock('repo:map', facts.repoMap),
    ),
    section(
      'Files, most central first',
      wrapBlock('repo:paths', rankedPaths.join('\n')),
    ),
    section(
      'Dependency chains from the highest-ranked files',
      wrapBlock('repo:chains', facts.criticalChains.map((chain) => chain.join(' -> ')).join('\n')),
    ),
    section(
      'Endpoints and scheduled jobs the indexer found, by file',
      wrapBlock('repo:endpoints', renderEndpointFacts(facts)),
    ),
    section(
      'Commands this repository declares, with the file each was read from',
      wrapBlock('repo:commands', renderCommands(commands)),
    ),
  ];

  return [
    'Write the onboarding tour for this repository from the facts below, and from nothing else.',
    ...blocks.filter((block) => block.length > 0),
  ].join('\n\n');
}

/** `## Heading` plus its block, or the empty string when there is no block. */
function section(heading: string, block: string): string {
  return block.length === 0 ? '' : `## ${heading}\n${block}`;
}

/** Wrap, unless there is nothing to wrap. */
function wrapBlock(label: string, text: string): string {
  const trimmed = text.trim();
  return trimmed.length === 0 ? '' : wrapUntrusted(label, trimmed);
}

/** One line per file that declares an endpoint or a cron. */
function renderEndpointFacts(facts: OnboardingFacts): string {
  return facts.endpointFacts
    .map((row) => {
      const parts = [...row.endpoints, ...row.crons.map((cron) => `cron ${cron}`)];
      return `${row.filePath}: ${parts.join(', ')}`;
    })
    .join('\n');
}

/**
 * One line per declared command, carrying its declaring file.
 *
 * The model is shown the commands so the run-locally BODY can describe them in
 * prose. It does not supply them and it cannot add to them: the stored section's
 * command list is this same array, assembled in code (AC-20, AC-21).
 */
function renderCommands(commands: readonly OnboardingCommand[]): string {
  return commands.map((row) => `${row.command}  (declared in ${row.file})`).join('\n');
}
