import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { loadPromptTemplate } from '../../platform/prompts.js';
import type { IntentBlock } from './sources.js';

/**
 * Prompt assembly for the classification call.
 *
 * EVERY repository-derived block is wrapped. A PR description is written by
 * whoever opened the PR and is a prime indirect-injection vector (OWASP LLM01);
 * an issue body is someone else's text, and a checked-in `.md` is text this
 * server went and fetched on the strength of a link in that same description.
 * All three reach this model as DATA, delimiter-wrapped, and the system prompt
 * says so in its own words — the delimiters are what make the instruction
 * enforceable rather than aspirational.
 *
 * The counted facts are NOT wrapped, following `conventions/prompt.ts`: they are
 * numbers this server produced, and presenting them as untrusted data would
 * undercut the one part of the prompt the model is supposed to treat as settled.
 *
 * Reading the body is delegated to `platform/prompts.ts`, which already is this
 * server's prompt loader — same `src/prompts/` target, same per-process cache.
 * This module previously kept its own copy with its own `node:fs` import and its
 * own `Map`; a second loader is one more place for the dev-vs-`dist` path note
 * in that file to be got wrong, and reading a shipped prompt body is a
 * cross-cutting platform concern rather than an intent-specific one.
 */

/** The one template this module loads; the `.md` is `loadPromptTemplate`'s. */
const CLASSIFY_TEMPLATE = 'intent.classify.system.md';

/** Read the classifier's system prompt body, cached for the process. */
export async function loadTemplate(): Promise<string> {
  return loadPromptTemplate(CLASSIFY_TEMPLATE);
}

/**
 * One system message and one user message carrying every collected block, in
 * the order `collectSources` produced them.
 */
export function buildClassifyMessages(template: string, blocks: IntentBlock[]): ChatMessage[] {
  const user = blocks
    .map((block) => {
      const body = block.untrusted ? wrapUntrusted(block.label, block.text) : block.text;
      return `## ${block.heading}\n${body}`;
    })
    .join('\n\n');

  return [
    { role: 'system', content: template },
    { role: 'user', content: user },
  ];
}
