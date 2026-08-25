/**
 * The two messages of the one synthesis call, and the material they are built
 * from. Pure: no database, no container, no clock, no provider and no `node:`
 * specifier — the template arrives as a string, and `notes.ts` is what loaded it.
 *
 * Two rules govern this file, and they are separate criteria because they fail
 * separately (AC-39):
 *
 *  - **Every foreign text section is wrapped as untrusted data, exactly once.**
 *    The finding titles, the rationales, the agent names and the code location
 *    are all text that came out of somebody's repository or out of another
 *    model, and a rationale is a direct channel to this one.
 *  - **None of it goes in the SYSTEM message.** The system message is the
 *    rendered template and nothing else. A wrapped block placed there would
 *    satisfy the first rule and still be the failure the second exists to
 *    prevent, because a system message is the one part of the conversation a
 *    model is built to treat as its own instructions.
 *
 * `INJECTION_GUARD` is deliberately NOT appended, and there is nothing here to
 * duplicate: it is a module-private, non-exported constant inside
 * `reviewer-core`'s assembler and it is concatenated only inside
 * `assemblePrompt`, which this module never calls. So the clause lives in
 * `src/prompts/multi-agent-notes.system.md` — the shape `onboarding.system.md`,
 * `intent.classify.system.md` and `brief.system.md` all already use — and
 * `test/multi-agent-notes-prompt.test.ts` asserts it against the RENDERED system
 * message, because a suite that checks wrapping mechanics is not evidence of a
 * defence: measured on an equivalent prompt, 9 of 10 tests passed with the
 * clause deleted (`server/INSIGHTS.md`, 2026-08-20).
 *
 * The template is loaded through `platform/prompts.ts`, which is this server's
 * prompt loader. Required rather than merely tidy: the module-local renderer in
 * `modules/conventions/prompt.ts` imports Node's own filesystem module and a
 * feature module may not (`server/INSIGHTS.md`, 2026-08-20). The two renderers
 * also disagree about a missing variable — this one leaves the literal
 * `{{name}}` in the prompt (2026-08-19) — so {@link buildSystemMessage} supplies
 * EVERY variable the template names, and a test asserts no `{{` survives.
 *
 * **The model echoes a NUMBER, never a path.** Each location is introduced by a
 * heading this server wrote, carrying an `id`, and the returned label and notes
 * are keyed on that id. A file path retyped by a model is a key that silently
 * matches nothing; an integer is one the caller can check against the groups it
 * actually has, which is what makes "a label for a group the multi-run does not
 * have is discarded" a lookup miss rather than a rule anybody has to enforce.
 */
import type { ChatMessage, Conflict, Severity } from '@devdigest/shared';

import { wrapUntrusted } from '../../platform/prompt.js';
import { loadPromptTemplate, renderTemplate } from '../../platform/prompts.js';
import {
  MAX_LABEL_CHARS,
  MAX_MATERIAL_FINDINGS_PER_AGENT,
  MAX_MATERIAL_RATIONALE_CHARS,
  MAX_NOTE_CHARS,
  MAX_SYNTHESIS_GROUPS,
  NOTES_LANGUAGE,
} from './constants.js';
import { titlesSimilar } from './grouping.js';

/** The one template this module loads; the `.md` is `loadPromptTemplate`'s. */
const NOTES_TEMPLATE = 'multi-agent-notes.system.md';

/** Read the synthesis system prompt body, cached for the process. */
export async function loadTemplate(): Promise<string> {
  return loadPromptTemplate(NOTES_TEMPLATE);
}

/* ─── what one location offers the model ──────────────────────────────────── */

/**
 * A column of the multi-run, reduced to what the material rule reads.
 *
 * A structural subset of `AgentColumn` — the service passes the columns it
 * already built without mapping them, and a test builds a three-field literal
 * instead of a twelve-field one. `agent_id` is already the grouping's prefixed
 * key here (`helpers.ts` computes it), so it joins straight onto a stance.
 */
export interface MaterialColumn {
  readonly agent_id: string;
  readonly agent_name: string;
  readonly findings: readonly {
    readonly title: string;
    readonly file: string;
    readonly rationale: string;
  }[];
}

/** One agent's position at one location, as the prompt states it. */
export interface MaterialAgent {
  readonly agent_id: string;
  readonly name: string;
  readonly verdict: Severity | 'ignored';
  /** What this agent reported there; empty for an agent that flagged nothing. */
  readonly findings: readonly { readonly title: string; readonly rationale: string }[];
}

/**
 * One contended location as the call carries it, with the id the model echoes.
 *
 * `id` is the 1-based position in the list SENT, not an index into the read's
 * groups: the caller keeps this array and resolves an answer back through it, so
 * the two can never drift and an id outside the array is simply discarded.
 */
export interface MaterialLocation {
  readonly id: number;
  readonly file: string;
  readonly line: number;
  /** The deterministic title the group currently shows (AC-31). */
  readonly title: string;
  readonly agents: readonly MaterialAgent[];
}

/**
 * The groups the call will carry, in the read's own order, capped at
 * {@link MAX_SYNTHESIS_GROUPS}.
 *
 * **The findings offered for a group are a best-effort selection, and they are
 * material only.** The grouping rule itself is `grouping.ts`'s and this file
 * neither re-implements nor changes it: a `Conflict` names its file, its lowest
 * line and one stance per agent, but not which findings clustered into it. What
 * is offered here is each flagging agent's findings in the same FILE whose title
 * is similar to the group's — `titlesSimilar` being the grouping rule's own
 * predicate, imported rather than re-derived. Two consequences, both benign and
 * both worth stating: a group member whose title matched only a neighbour's
 * (grouping is transitive, this is not) may be left out, and one file holding
 * two same-titled problems at disjoint line ranges offers each group both sets.
 * Either way the model is writing prose about a location whose file, line,
 * agents and verdicts are exact, and nothing downstream branches on what it
 * writes.
 */
export function selectMaterial(
  conflicts: readonly Conflict[],
  columns: readonly MaterialColumn[],
): MaterialLocation[] {
  const byAgent = new Map(columns.map((column) => [column.agent_id, column]));

  return conflicts.slice(0, MAX_SYNTHESIS_GROUPS).map((conflict, index) => ({
    id: index + 1,
    file: conflict.file,
    line: conflict.line,
    title: conflict.title,
    agents: conflict.takes.map((take) => ({
      agent_id: take.agent_id,
      name: take.persona,
      verdict: take.verdict,
      findings:
        take.verdict === 'ignored'
          ? []
          : (byAgent.get(take.agent_id)?.findings ?? [])
              .filter(
                (finding) =>
                  finding.file === conflict.file && titlesSimilar(finding.title, conflict.title),
              )
              .slice(0, MAX_MATERIAL_FINDINGS_PER_AGENT)
              .map((finding) => ({
                title: finding.title,
                rationale: finding.rationale.slice(0, MAX_MATERIAL_RATIONALE_CHARS),
              })),
    })),
  }));
}

/* ─── the two messages ────────────────────────────────────────────────────── */

/**
 * The system message: the rendered template, and nothing else.
 *
 * Every variable the template names is supplied — this loader leaves an
 * unmatched `{{name}}` in the prompt verbatim rather than blanking it, so a
 * forgotten one is shipped to the model as a literal (`server/INSIGHTS.md`,
 * 2026-08-19).
 */
export function buildSystemMessage(template: string): string {
  return renderTemplate(template, {
    language: NOTES_LANGUAGE,
    max_label_chars: String(MAX_LABEL_CHARS),
    max_note_chars: String(MAX_NOTE_CHARS),
  });
}

/**
 * One system message and one user message carrying every contended location.
 *
 * The user message is our headings — `### Location N`, with the id the answer is
 * keyed on — and one wrapped block per location holding everything foreign. One
 * `wrapUntrusted` call per block, so each foreign section is delimited exactly
 * once; an empty selection produces no block, and the caller does not make a
 * call at all when there is nothing to synthesise.
 */
export function buildNotesMessages(
  template: string,
  locations: readonly MaterialLocation[],
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemMessage(template) },
    { role: 'user', content: renderUserMessage(locations) },
  ];
}

/** The instruction line, then one heading + wrapped block per location. */
function renderUserMessage(locations: readonly MaterialLocation[]): string {
  return [
    `Label each of the ${locations.length} location(s) below and write one note per agent listed in it.`,
    ...locations.map(
      (location) =>
        `### Location ${location.id}\n${wrapUntrusted(`conflict:${location.id}`, renderLocation(location))}`,
    ),
  ].join('\n\n');
}

/**
 * One location's facts, as plain lines inside the wrapper.
 *
 * The agent ids are in here too. They are this server's own values rather than
 * foreign text, but they belong to the block they key, and wrapping them costs
 * nothing: the delimiters say "do not take instructions from this", not "do not
 * read this".
 */
function renderLocation(location: MaterialLocation): string {
  const lines = [
    `file: ${location.file}`,
    `line: ${location.line}`,
    `current title: ${location.title}`,
    'agents:',
  ];
  for (const agent of location.agents) {
    lines.push(`- agent_id: ${agent.agent_id}`);
    lines.push(`  name: ${agent.name}`);
    lines.push(
      `  verdict: ${agent.verdict === 'ignored' ? 'ignored (reviewed this location and flagged nothing)' : agent.verdict}`,
    );
    for (const finding of agent.findings) {
      lines.push(`  reported: ${finding.title}`);
      lines.push(`  rationale: ${finding.rationale.replaceAll('\n', ' ')}`);
    }
  }
  return lines.join('\n');
}
