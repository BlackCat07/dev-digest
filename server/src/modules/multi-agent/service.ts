import type { AgentColumn, MultiAgentRun } from '@devdigest/shared';

import { NotFoundError } from '../../platform/errors.js';
import { groupFindings, type GroupableColumn } from './grouping.js';
import { mergeSynthesis, toColumn, toMultiAgentRun } from './helpers.js';
import type { MultiAgentReview, MultiAgentStore, StoredMultiAgentFinding } from './types.js';

/**
 * The application ring of Multi-Agent Review: one use case, and everything the
 * results screen reads in a single request.
 *
 * What it does NOT contain is the point of the file. No query lives here (they
 * are all behind {@link MultiAgentStore}), no `db/schema` is imported, no SDK is
 * named, and **no provider is in reach** — there is no LLM port in this module's
 * dependency surface at all, so AC-23's "a read makes no model call" is not a
 * discipline anyone has to keep, it is a call this class has no way to make. The
 * synthesis that DOES cost a call is triggered from the executor's completion
 * and writes its output to storage; this read only ever merges what is already
 * there.
 *
 * **A workspace id is the first argument and it IS the authorization check.** No
 * multi-run is reachable by id alone: the parent lookup is scoped, and every
 * read that follows is scoped again, so a pull request outside the caller's
 * workspace answers with this module's own `not_found` (the SERVICE envelope,
 * which is the only thing that distinguishes a registered module from an
 * unregistered one — `server/INSIGHTS.md`, 2026-08-20) and never with another
 * tenant's data.
 *
 * **On transactions.** The service owns the transaction boundary in this module,
 * and the honest answer for the one use case below is that it needs none: it is
 * a sequence of reads, and a read sequence that raced a concurrent write would
 * at worst render a column one poll out of date — which the client re-reads
 * every 2 000 ms anyway. Stating it rather than assuming it, because a service
 * awaiting two repository calls in sequence has written a two-statement
 * transaction with no transaction, and that is only fine when it is deliberate.
 */
/**
 * Every run of one multi-run as its column, each carrying only its OWN findings
 * (AC-18, AC-24).
 *
 * A free function rather than a private method because it has a **second
 * caller**: the note synthesis (`notes.ts`) has to see the columns the read will
 * render, since the groups it labels are derived from exactly this array. Two
 * assemblies would be two chances for the synthesis to key its labels on a
 * `(file, line)` the read never produces — and that failure is silent, because a
 * label nothing matches is simply never shown.
 *
 * The port is narrowed to the two reads it makes, so a caller that has no
 * business writing notes cannot, and a test fake needs two methods rather than
 * six.
 */
export async function assembleColumns(
  store: Pick<MultiAgentStore, 'runsOf' | 'findingsOf'>,
  workspaceId: string,
  multiAgentRunId: string,
): Promise<AgentColumn[]> {
  const runs = await store.runsOf(workspaceId, multiAgentRunId);
  const reviewIds = runs.map((run) => run.reviewId).filter((id): id is string => id !== null);
  const findings = await store.findingsOf(reviewIds);

  // Keyed by review id, so a column can only ever be handed the findings of its
  // OWN review (AC-24). A run with no review takes the empty list.
  const byReview = new Map<string, StoredMultiAgentFinding[]>();
  for (const finding of findings) {
    const bucket = byReview.get(finding.reviewId);
    if (bucket) bucket.push(finding);
    else byReview.set(finding.reviewId, [finding]);
  }

  return runs.map((run) => toColumn(run, byReview));
}

export class MultiAgentService implements MultiAgentReview {
  private readonly store: MultiAgentStore;

  /**
   * One port, declared as the shape this service needs rather than as the
   * container.
   *
   * A service taking the whole `Container` puts every caller into an import
   * cycle with the DI root (`server/INSIGHTS.md`, 2026-08-10); a deps object
   * makes the dependency surface visible in the signature and is what a new
   * service in this repository takes.
   */
  constructor(deps: { store: MultiAgentStore }) {
    this.store = deps.store;
  }

  /**
   * The pull request's most recent multi-agent run, assembled (AC-16…AC-24).
   *
   * The shape of the method is the shape of the criteria: find the parent, read
   * its runs, read those runs' findings, build one column per run, group what
   * the agents disagreed on, merge whatever synthesis has been persisted, and
   * total the header. Every rule about `null` versus `0`, about which score is
   * the real one and about what a group falls back to lives in `helpers.ts` or
   * in `grouping.ts` — this method's job is the order, not the arithmetic.
   */
  async latest(workspaceId: string, prId: string): Promise<MultiAgentRun> {
    const parent = await this.store.latestForPull(workspaceId, prId);
    // AC-17. `NotFoundError` and not an empty payload: "this pull request has
    // never been fanned out" is a state the client renders as its own empty
    // screen with an action that starts one, and it must be distinguishable from
    // "a fan-out exists and produced nothing".
    if (!parent) throw new NotFoundError('No multi-agent run for this pull request');

    const columns = await assembleColumns(this.store, workspaceId, parent.id);

    // EVERY column is passed, including the failed, the cancelled and the still
    // running ones: the stance list is one per agent OF THE MULTI-RUN, not one
    // per flagging agent, and the entry condition counts silence — so a column
    // withheld here is an agent whose silence is invisible (EC-7). An
    // `AgentColumn` already satisfies `GroupableColumn` structurally; the
    // annotation is here to say that on purpose rather than by luck.
    const groupable: readonly GroupableColumn[] = columns;
    const conflicts = mergeSynthesis(
      groupFindings(groupable),
      await this.store.readNotes(workspaceId, parent.id),
    );

    return toMultiAgentRun(parent, columns, conflicts);
  }
}
