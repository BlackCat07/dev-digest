import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import { loadPromptTemplate, renderTemplate } from '../../platform/prompts.js';
import type { BriefBlock } from './assemble.js';
import {
  CORE_SOURCES,
  MAX_FOCUS_REASON_CHARS,
  MAX_PROMPT_TOKENS,
  MAX_REVIEW_FOCUS,
  MAX_RISKS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_TITLE_CHARS,
  MAX_WHAT_CHARS,
  MAX_WHY_CHARS,
} from './constants.js';
import { BriefRiskKind } from './schemas.js';

/**
 * Prompt assembly for the one structured call.
 *
 * Three rules govern this file. They are separate criteria because they fail
 * separately, and the third is the one no wrapping check can see:
 *
 *  - **Every one of the eight source blocks is wrapped as untrusted data,
 *    exactly once** (AC-54, AC-56). Titles, descriptions, paths, symbol and
 *    endpoint names, issue bodies, prior pull-request titles and whole repository
 *    documents are all text somebody else wrote, on a repository that may be
 *    public, and a comment in a source file is a direct channel to this model.
 *  - **None of it goes in the SYSTEM message** (AC-55). The system message is the
 *    rendered template and nothing else. A correctly wrapped block placed there
 *    would satisfy AC-54 and still be exactly the failure AC-55 exists to
 *    prevent, because a system message is the one part of the conversation a
 *    model is built to treat as its own instructions.
 *  - **The template carries its own untrusted-data clause**, and that clause is
 *    load-bearing rather than decorative. See the paragraph below.
 *
 * **WHY THE TEMPLATE MUST STATE THE RULE ITSELF.** `INJECTION_GUARD` — the shared
 * paragraph that tells a model what the delimiters mean — is a module-private,
 * non-exported constant in `reviewer-core`'s own prompt assembler, appended only
 * inside `assemblePrompt`, and that package's barrel never exports it. This module
 * does not call `assemblePrompt`: it assembles its own prompt, and the system
 * message here is `platform/prompts.ts` rendering `brief.system.md`. So nothing
 * appends a guard to this prompt and THERE IS NO GUARD TO DUPLICATE. Do not
 * append one yourself — the mistake recorded for the `skills` slot is real
 * (`server/INSIGHTS.md`, 2026-08-05: a second copy makes the first read as data)
 * — but do not read that rule as "the guard is already handled" either: read that
 * way, this feature hands a model eight foreign inputs with no rule saying what
 * the delimiters mean, while every check below, which tests wrapping MECHANICS,
 * stays green. `onboarding.system.md` and `intent.classify.system.md` both carry
 * their own clause for exactly this reason, and `brief.system.md` does too. The
 * assertion in `test/brief-prompt.test.ts` is on the RENDERED TEXT, not on the
 * file's existence.
 *
 * No pattern matching for hostile phrasing is added anywhere here. Matching one
 * phrasing only ever catches one phrasing, and `wrapUntrusted` already escapes an
 * attempt to close its own delimiter, so an input containing `</untrusted>` cannot
 * break out of its own block (EC-30). An input containing the OPENING delimiter
 * needs no escaping: an opening tag cannot end a block.
 *
 * **WHICH LOADER THIS IS.** `platform/prompts.ts`, which is this server's prompt
 * loader — same `src/prompts/` target, same per-process cache. This server has TWO
 * template renderers and they disagree about a missing variable: the one in
 * `modules/conventions/prompt.ts` replaces an unmatched `{{name}}` with the empty
 * string, and this one replaces nothing and leaves the literal `{{name}}` in the
 * prompt (`server/INSIGHTS.md`, 2026-08-19). The module-local shape is not
 * available to a feature module anyway — it reads the disk with Node's own
 * filesystem module — so this file supplies EVERY variable the template names and
 * a test asserts that no `{{` survives rendering.
 */

/** The one template this module loads; the `.md` is `loadPromptTemplate`'s. */
const BRIEF_TEMPLATE = 'brief.system.md';

/** Read the brief's system prompt body, cached for the process. */
export async function loadTemplate(): Promise<string> {
  return loadPromptTemplate(BRIEF_TEMPLATE);
}

/**
 * The language every field is written in (N12).
 *
 * A constant rather than a setting: every generated artefact in this product is
 * English, and the brief is stored once and read by the whole workspace.
 */
const BRIEF_LANGUAGE = 'English';

/**
 * The system message: the rendered template, and nothing else (AC-55).
 *
 * Every variable is ours — the caps the schema cannot express and the closed set
 * of risk kinds the model must echo back — which is exactly why they are allowed
 * here. Not one of them is repository-derived, so there is nothing to wrap and
 * nothing foreign in the result.
 *
 * The caps are stated to the model AND enforced in `grounding.ts`. Neither alone
 * is enough: a bound in a `json_schema` is either inexpressible (an array length)
 * or rejected outright by Anthropic-via-OpenRouter (a numeric range), so the
 * prompt is the only place the model hears the limit — and a model is not a
 * validator, so the code is the only place it holds.
 */
export function buildSystemMessage(template: string): string {
  return renderTemplate(template, {
    language: BRIEF_LANGUAGE,
    risk_kinds: BriefRiskKind.options.map((kind) => `\`${kind}\``).join(', '),
    max_risks: String(MAX_RISKS),
    max_review_focus: String(MAX_REVIEW_FOCUS),
    max_risk_file_refs: String(MAX_RISK_FILE_REFS),
    max_risk_title_chars: String(MAX_RISK_TITLE_CHARS),
    max_risk_explanation_chars: String(MAX_RISK_EXPLANATION_CHARS),
    max_what_chars: String(MAX_WHAT_CHARS),
    max_why_chars: String(MAX_WHY_CHARS),
    max_focus_reason_chars: String(MAX_FOCUS_REASON_CHARS),
  });
}

/**
 * The two messages, or the reason there is no call to make.
 *
 * A discriminated result rather than a throw, because the two failures below mean
 * completely different things to the caller and only one of them is a state the
 * brief can describe.
 */
export type BriefMessages =
  | {
      ok: true;
      messages: ChatMessage[];
      /** AC-12's figure: the system and user messages exactly as sent. */
      tokens: number;
    }
  | {
      ok: false;
      /**
       * `core_over_budget` — the core alone does not fit (AC-16). No call is
       * made, and the brief is stored `degraded` with reason `inputs_too_large`:
       * nothing is charged for an answer that could not have been grounded.
       *
       * `shed_incomplete` — over budget with an optional block still present.
       * That is a DEFECT, not a degradation: the shed loop was handed a stale
       * figure, so the caller should log it as such rather than presenting it to
       * the reader as a size limit. No call is made either way — the budget is a
       * ceiling, not a preference.
       */
      kind: 'core_over_budget' | 'shed_incomplete';
      tokens: number;
      budget: number;
      /** The kinds still present when the measurement failed, for the log line. */
      present: BriefBlock['kind'][];
    };

/**
 * Build the two messages and measure them as they will be sent.
 *
 * **THIS FILE OWNS THE FINAL SIZE CHECK, and it is not the measurement
 * `assemble.ts` made.** That one sheds sources by sizing the RAW block text;
 * AC-12 defines the budget over the system and user messages EXACTLY AS SENT,
 * which is after `wrapUntrusted` has added an opener and a closer per block and
 * after the template has been rendered. On a margin case — a core the assembly
 * judged to just fit — the delimiter overhead across three or more blocks can
 * carry the sent messages over the ceiling while `test/brief-assemble.test.ts`,
 * scoped to the pre-wrap figure, stays green. So the measurement is repeated here,
 * on the strings that actually leave the process.
 *
 * The two over-budget outcomes are told apart by what is still present. Only core
 * blocks left means the core alone overruns, which is AC-16's honest refusal; any
 * optional block still present means the shedding did not finish, which is a bug
 * in the arithmetic rather than a fact about this pull request.
 *
 * `budget` is a parameter so the whole ladder is testable at a hundred tokens,
 * exactly as it is in `assemble.ts`.
 */
export function buildBriefMessages(
  template: string,
  blocks: readonly BriefBlock[],
  budget: number = MAX_PROMPT_TOKENS,
): BriefMessages {
  const system = buildSystemMessage(template);
  const user = renderUserMessage(blocks);
  const tokens = approxTokens(system) + approxTokens(user);

  if (tokens > budget) {
    const present = blocks.map((block) => block.kind);
    const core: ReadonlySet<BriefBlock['kind']> = new Set(CORE_SOURCES);
    return {
      ok: false,
      kind: present.every((kind) => core.has(kind)) ? 'core_over_budget' : 'shed_incomplete',
      tokens,
      budget,
      present,
    };
  }

  return {
    ok: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tokens,
  };
}

/**
 * Every block, each wrapped exactly once, under a heading this server wrote.
 *
 * The headings and the opening instruction are ours and stay OUTSIDE the
 * delimiters — the same split `modules/intent/prompt.ts` and
 * `modules/onboarding/prompt.ts` make, and the reason the changed-file heading can
 * say "200 of 400 files" as a statement the model may rely on rather than as data
 * it may discount.
 *
 * Wrapping happens HERE and only here. `assemble.ts` produces raw block text
 * precisely so there is one place that decides, which is what makes "exactly once"
 * checkable: double-wrapping is reachable in this codebase because a producer may
 * wrap its own output — `ProjectContext.resolveForRun` returns document text raw
 * and unwrapped on purpose and this module wraps it, while `SkillsService` wraps
 * before handing bodies over — and where that decision lives is a layering choice
 * whose answer here is the service (`server/INSIGHTS.md`, 2026-08-05).
 */
function renderUserMessage(blocks: readonly BriefBlock[]): string {
  return [
    'Write the brief for this pull request from the material below, and from nothing else.',
    ...blocks.map((block) => `## ${block.heading}\n${wrapUntrusted(block.label, block.text)}`),
  ].join('\n\n');
}
