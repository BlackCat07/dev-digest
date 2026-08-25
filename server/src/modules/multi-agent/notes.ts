/**
 * The ONE model call this feature makes: the stance sentences and the group
 * labels, produced together, once, after every run of a fan-out is terminal.
 *
 * **It is a separate class from `MultiAgentService` on purpose.** The read has
 * no provider anywhere in its dependency surface — that is how AC-23's "a read
 * makes no model call" is expressed here, as a call the read has no way to make
 * rather than as a rule somebody keeps — and giving that class an LLM port to
 * satisfy this task would have thrown the property away. So the provider lives
 * here, behind its own container binding, reached only from the executor's
 * completion.
 *
 * **One call, never two** (AC-102). The label and the sentences come back from
 * the same request: a second call for the headings is the exact failure that
 * criterion exists to prevent, and it is also how the labels would stop agreeing
 * with the notes they head.
 *
 * **Nothing here can fail anything.** Every exit is a `return`: a failed call, an
 * overrun deadline, an answer the schema rejects, a provider that is not
 * configured, a template that will not load. The multi-run then renders exactly
 * as it does before this task ever runs — the same groups, the same count, every
 * stance present with an empty note, every title falling back to the grouping's
 * deterministic rule (AC-38). That is the steady state this whole cluster is
 * droppable against, and it is why `synthesise` returns `void` and never throws:
 * the caller is a settled background promise, and a rejection reaching it is how
 * this API has died twice (`server/INSIGHTS.md`, 2026-08-06 and 2026-08-07).
 *
 * **Nothing branches on what comes back.** A note is rendered as a sentence and a
 * label as a heading; no code here or on the client decides anything from either,
 * so a response carrying an instruction is data and stays data. The two length
 * caps applied before storage are hygiene, not a defence.
 */
import type { FeatureModelChoice, FeatureModelId, LLMProvider } from '@devdigest/shared';
import { z } from 'zod';

import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  NOTES_CALL_DEADLINE_MS,
  NOTES_MAX_RETRIES,
  NOTES_SCHEMA_NAME,
} from './constants.js';
import { groupFindings } from './grouping.js';
import type { MultiAgentNotes } from './schemas.js';
import { assembleColumns } from './service.js';
import type { MultiAgentStore } from './types.js';
import {
  buildNotesMessages,
  loadTemplate,
  selectMaterial,
  type MaterialLocation,
} from './prompt.js';

/**
 * The workspace model choice this call resolves against — the `FEATURE_MODELS`
 * entry the contract carries for it, defaulting to a flash-class OpenRouter
 * model.
 */
const NOTES_FEATURE_MODEL: FeatureModelId = 'multi_agent_notes';

/* ─── what the model returns ──────────────────────────────────────────────── */

/**
 * The answer's shape: one entry per contended location, each carrying its
 * heading and one sentence per agent.
 *
 * Keyed on the integer `id` this server put in the location's heading, never on
 * a file path: a path retyped by a model is a key that silently matches nothing,
 * where an id is one the caller can check against the locations it actually
 * sent. An id that matches none of them is discarded, which is what makes "a
 * label for a group the multi-run does not have is discarded" a lookup miss
 * rather than a rule anybody enforces.
 *
 * Every field is required. Structured-output providers do best with a closed
 * shape, and an answer that omits one is a failed parse, which is a state this
 * module already renders (nothing is written, everything falls back).
 */
export const MultiAgentNotesDraft = z.object({
  locations: z.array(
    z.object({
      id: z.number().int(),
      label: z.string(),
      notes: z.array(z.object({ agent_id: z.string(), note: z.string() })),
    }),
  ),
});
export type MultiAgentNotesDraft = z.infer<typeof MultiAgentNotesDraft>;

/* ─── the ports ───────────────────────────────────────────────────────────── */

/**
 * The workspace's model choice for one feature.
 *
 * A call signature declared by its consumer rather than a call into the settings
 * module: importing that sibling crosses a module boundary, and the helper that
 * once took the whole container closed a cycle through the DI root
 * (`server/INSIGHTS.md`, 2026-08-10). The composition root already exposes an
 * arrow property of exactly this shape.
 */
export interface FeatureModelResolver {
  (workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice>;
}

/**
 * The two log levels this task uses, declared here rather than imported.
 *
 * Fastify's `app.log` and the reviews module's own `Logger` both satisfy it
 * structurally; importing either type would be a cross-module or a transport
 * edge for two method signatures.
 */
export interface SynthesisLogger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Everything this task needs, and nothing else. */
export interface NotesDeps {
  /** The same store the read holds: it groups what the read will group. */
  readonly store: Pick<MultiAgentStore, 'runsOf' | 'findingsOf' | 'saveNotes'>;
  readonly featureModel: FeatureModelResolver;
  llm(id: LLMProvider['id']): Promise<LLMProvider>;
}

/**
 * The public face of this task: synthesise the notes for one finished multi-run.
 *
 * Exposed as the INTERFACE from the container so `ContainerOverrides` can carry
 * a fake — and so the REVIEWS module, which triggers it, satisfies the call
 * signature through the composition root and imports nothing from here.
 */
export interface MultiAgentSynthesis {
  /**
   * Write the stance notes and the group labels for a multi-run whose runs have
   * all reached a terminal status.
   *
   * Never throws and never rejects: every failure is a `return` that leaves the
   * multi-run in its pre-synthesis state.
   */
  synthesise(workspaceId: string, multiAgentRunId: string, logger?: SynthesisLogger): Promise<void>;
}

/* ─── the task ────────────────────────────────────────────────────────────── */

export class MultiAgentNotesService implements MultiAgentSynthesis {
  constructor(private readonly deps: NotesDeps) {}

  async synthesise(
    workspaceId: string,
    multiAgentRunId: string,
    logger?: SynthesisLogger,
  ): Promise<void> {
    try {
      // The groups are computed from the SAME assembly the read uses, so the
      // `(file, line)` keys written below are the keys the read will look up.
      // Nothing is persisted about the groups themselves (N-5) — only what cost
      // a model call.
      const columns = await assembleColumns(this.deps.store, workspaceId, multiAgentRunId);
      const locations = selectMaterial(groupFindings(columns), columns);
      // No contended location means nothing to phrase and no call to make. Not
      // an error: a fan-out whose agents all agreed is the ordinary case for a
      // small pull request.
      if (locations.length === 0) return;

      const template = await loadTemplate();
      const choice = await this.deps.featureModel(workspaceId, NOTES_FEATURE_MODEL);
      const llm = await this.deps.llm(choice.provider);

      // The call is bounded HERE and only here, by two different quantities.
      // `maxRetries` caps the provider's round-trips and the race caps
      // wall-clock; `StructuredRequest.timeoutMs` is silently ignored, so
      // neither alone bounds anything (`server/INSIGHTS.md`, 2026-08-06). The
      // rejection is folded into the resolved value so the loser of the race can
      // never become an unhandled rejection.
      const pending = llm
        .completeStructured({
          model: choice.model,
          schema: MultiAgentNotesDraft,
          schemaName: NOTES_SCHEMA_NAME,
          messages: buildNotesMessages(template, locations),
          temperature: 0,
          maxRetries: NOTES_MAX_RETRIES,
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: Error) => ({ ok: false as const, error }),
        );

      const raced = await Promise.race([pending, deadline(NOTES_CALL_DEADLINE_MS)]);
      if (raced === null) {
        logger?.warn(
          { multiAgentRunId, deadlineMs: NOTES_CALL_DEADLINE_MS },
          'multi-agent: the note synthesis did not answer within its deadline',
        );
        return;
      }
      if (!raced.ok) {
        logger?.warn(
          { multiAgentRunId, err: raced.error.message },
          'multi-agent: the note synthesis call failed',
        );
        return;
      }

      await this.deps.store.saveNotes(
        workspaceId,
        multiAgentRunId,
        toStoredNotes(raced.value.data, locations),
      );
    } catch (error) {
      // A missing API key (`ConfigError`), an unknown provider id, a template
      // that will not load, a write that failed. None of them is a reason to
      // fail the multi-run or any of its runs: the read already has a rendering
      // for "not synthesised" and this is it.
      logger?.error(
        { multiAgentRunId, err: (error as Error).message },
        'multi-agent: note synthesis failed',
      );
    }
  }
}

/* ─── the answer, as the column stores it ─────────────────────────────────── */

/**
 * The draft folded into the two flat arrays `multi_agent_runs.notes` holds
 * (AC-36, AC-37).
 *
 * The lookup runs from what was SENT outward, which is what discards everything
 * the multi-run does not have: a location id nobody was asked about matches no
 * entry, and a note naming an agent that is not in that location's stance list
 * matches no id. Neither is an error — a model naming an agent that does not
 * exist is exactly as expected as one obeying the prompt.
 *
 * An empty label or an empty note is dropped rather than stored: both render
 * identically to having none (the fallback title, the empty sentence), and the
 * smaller blob is the honest one. First answer wins on a duplicate key.
 */
export function toStoredNotes(
  draft: MultiAgentNotesDraft,
  sent: readonly MaterialLocation[],
): MultiAgentNotes {
  const byId = new Map(sent.map((location) => [location.id, location]));
  const labels: MultiAgentNotes['labels'] = [];
  const notes: MultiAgentNotes['notes'] = [];
  const seenLabel = new Set<number>();
  const seenNote = new Set<string>();

  for (const answer of draft.locations) {
    const location = byId.get(answer.id);
    if (!location) continue;

    const label = answer.label.trim().slice(0, MAX_LABEL_CHARS);
    if (label.length > 0 && !seenLabel.has(location.id)) {
      seenLabel.add(location.id);
      labels.push({ file: location.file, line: location.line, label });
    }

    const agents = new Set(location.agents.map((agent) => agent.agent_id));
    for (const entry of answer.notes) {
      if (!agents.has(entry.agent_id)) continue;
      const key = `${location.id} ${entry.agent_id}`;
      if (seenNote.has(key)) continue;
      const note = entry.note.trim().slice(0, MAX_NOTE_CHARS);
      if (note.length === 0) continue;
      seenNote.add(key);
      notes.push({
        file: location.file,
        line: location.line,
        agent_id: entry.agent_id,
        note,
      });
    }
  }

  return { notes, labels };
}

/**
 * Resolves to `null` after `ms`, to be raced against work that must not overrun.
 *
 * The timer is `unref`'d so a pending deadline can never hold the process open
 * after the synthesis has moved on — the loser of the race is abandoned, not
 * cancelled, and Node would otherwise wait for it at shutdown. The same shape
 * `modules/brief/service.ts`, `modules/onboarding/service.ts` and
 * `modules/intent/service.ts` already carry.
 */
function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
}
