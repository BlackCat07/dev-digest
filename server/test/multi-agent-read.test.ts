import { describe, it, expect } from 'vitest';
import { MultiAgentRun } from '@devdigest/shared';
import { NotFoundError } from '../src/platform/errors.js';
import { MultiAgentService } from '../src/modules/multi-agent/service.js';
import type { MultiAgentNotes } from '../src/modules/multi-agent/schemas.js';
import type {
  MultiAgentStore,
  StoredMultiAgentColumn,
  StoredMultiAgentFinding,
  StoredMultiAgentRun,
} from '../src/modules/multi-agent/types.js';

/**
 * Reading one multi-agent run: which score is the real one, what `null` means
 * where `0` would be a lie, what a group falls back to before anything has been
 * synthesised, and what the read refuses to do.
 *
 * Hermetic, and it has to be — `DDG-TEST-001` reserves `*.it.test.ts` for
 * DB-backed files and nothing below is about storage. The service takes ONE port
 * and the fake here is that port: no Postgres, no container, no clock. There is
 * deliberately no provider anywhere in this file, because there is nowhere in
 * the service to put one.
 *
 * **Every fake method not named by a case throws with its own name.** That is
 * what turns "the service never read the findings" from an assertion about a
 * payload — which several wrong implementations also satisfy — into a failing
 * test that NAMES the call that should not have happened.
 *
 * What this file cannot prove, stated rather than implied: which of two
 * multi-runs is "most recent" is `ORDER BY ran_at DESC, id DESC` inside
 * `repository.ts`, and no fake can exercise a SQL ordering. The service is
 * tested for taking whatever `latestForPull` hands it; the tiebreaker itself is
 * carried by the query and its comment.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const PR = '22222222-2222-4222-8222-222222222222';
const MULTI_RUN = '33333333-3333-4333-8333-333333333333';

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

function store(over: Partial<MultiAgentStore>): MultiAgentStore {
  return {
    createIfIdle: unreachable('createIfIdle'),
    latestForPull: unreachable('latestForPull'),
    discard: unreachable('discard'),
    runsOf: unreachable('runsOf'),
    findingsOf: unreachable('findingsOf'),
    readNotes: unreachable('readNotes'),
    saveNotes: unreachable('saveNotes'),
    ...over,
  };
}

const parent: StoredMultiAgentRun = {
  id: MULTI_RUN,
  prId: PR,
  prNumber: 42,
  ranAt: new Date('2026-08-25T10:00:00.000Z'),
};

/** A run row with everything nulled, so each case states only what it is about. */
function run(over: Partial<StoredMultiAgentColumn>): StoredMultiAgentColumn {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
    provider: 'openrouter',
    model: 'gpt-4.1',
    status: 'done',
    error: null,
    durationMs: null,
    costUsd: null,
    reviewId: null,
    score: null,
    summary: null,
    verdict: null,
    ...over,
  };
}

function finding(over: Partial<StoredMultiAgentFinding>): StoredMultiAgentFinding {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    severity: 'WARNING',
    category: 'security',
    title: 'Magic number 3600',
    file: 'lib/rate-limit.ts',
    startLine: 28,
    endLine: 30,
    rationale: 'It is unexplained.',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    acceptedAt: null,
    dismissedAt: null,
    ...over,
  };
}

const service = (over: Partial<MultiAgentStore>) =>
  new MultiAgentService({ store: store({ latestForPull: async () => parent, ...over }) });

describe('multi-agent read', () => {
  it('builds one column per run, each field from that run’s own rows', async () => {
    // AC-18, AC-19, AC-20, AC-21, AC-24 in one flow, because they are one
    // mapping and splitting them would assert the same map five times.
    const svc = service({
      runsOf: async (workspaceId, id) => {
        expect(workspaceId).toBe(WS);
        expect(id).toBe(MULTI_RUN);
        return [
          run({
            runId: 'run-a',
            agentId: 'agent-a',
            agentName: 'Security Reviewer',
            status: 'done',
            durationMs: 8200,
            costUsd: 0.06,
            reviewId: 'review-a',
            // The REVIEW's score (AC-20). `agent_runs.score` is not even on the
            // view the service consumes, so the wrong one is unreachable.
            score: 75,
            summary: 'Two problems.',
            verdict: 'REQUEST_CHANGES',
          }),
          run({
            runId: 'run-b',
            agentId: 'agent-b',
            agentName: 'Style Reviewer',
            // `cancelled`, and it must NOT read as `failed` — reporting a
            // cancelled run as failed is untrue (AC-19).
            status: 'cancelled',
            error: 'Cancelled by the reviewer',
            durationMs: 6000,
            // A genuinely free model: `0`, never `null` (AC-21).
            costUsd: 0,
            reviewId: 'review-b',
            score: 90,
          }),
          run({
            runId: 'run-c',
            agentId: 'agent-c',
            agentName: 'Perf Reviewer',
            status: 'running',
            // Nothing recorded yet: `null`, never `0` (AC-21).
            costUsd: null,
          }),
        ];
      },
      // A run with no review contributes no review id, so the query is made for
      // the two that have one and never for a null.
      findingsOf: async (reviewIds) => {
        expect([...reviewIds]).toEqual(['review-a', 'review-b']);
        return [
          finding({ id: 'f-1', reviewId: 'review-a', title: 'Magic number 3600' }),
          finding({
            id: 'f-2',
            reviewId: 'review-a',
            title: 'Missing error handling',
            file: 'lib/fetch.ts',
            startLine: 10,
            endLine: 12,
            severity: 'CRITICAL',
            suggestion: 'Wrap it.',
            acceptedAt: new Date('2026-08-25T11:00:00.000Z'),
          }),
          finding({ id: 'f-3', reviewId: 'review-b', title: 'Prefer const' }),
        ];
      },
      readNotes: async () => null,
    });

    const payload = await svc.latest(WS, PR);

    // The whole payload is a wire shape, so it is parsed against the contract
    // rather than picked at field by field: a missing `end_line` or a stray
    // `undefined` fails here and not in the browser.
    const parsed = MultiAgentRun.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    expect(payload.id).toBe(MULTI_RUN);
    expect(payload.pr_id).toBe(PR);
    expect(payload.pr_number).toBe(42);
    expect(payload.ran_at).toBe('2026-08-25T10:00:00.000Z');
    // One column per run the multi-run created, and `agent_count` is the number
    // of columns rather than the length of the list the create path was given.
    expect(payload.agent_count).toBe(3);
    expect(payload.columns.map((c) => c.status)).toEqual(['done', 'cancelled', 'running']);
    expect(payload.columns.map((c) => c.score)).toEqual([75, 90, null]);
    expect(payload.columns.map((c) => c.cost_usd)).toEqual([0.06, 0, null]);

    // AC-24: each column carries the findings of its OWN review and no other's.
    expect(payload.columns.map((c) => c.findings.map((f) => f.id))).toEqual([
      ['f-1', 'f-2'],
      ['f-3'],
      [],
    ]);

    const accepted = payload.columns[0]!.findings[1]!;
    expect(accepted.accepted_at).toBe('2026-08-25T11:00:00.000Z');
    expect(accepted.dismissed_at).toBeNull();
    expect(accepted.suggestion).toBe('Wrap it.');
    expect(accepted.rationale).toBe('It is unexplained.');
    expect(accepted.confidence).toBe(0.8);
    expect(accepted.end_line).toBe(12);
  });

  it('totals the header: the longest terminal run, and the sum of the costs that exist', async () => {
    // AC-22. 8.2s / 6.0s / 7.1s is the criterion's own example, and the running
    // column's 99s is there to prove a non-terminal duration is excluded rather
    // than merely absent.
    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', status: 'done', durationMs: 8200, costUsd: 0.06 }),
        run({ runId: 'b', status: 'failed', durationMs: 6000, costUsd: null }),
        run({ runId: 'c', status: 'done', durationMs: 7100, costUsd: 0.08 }),
        run({ runId: 'd', status: 'running', durationMs: 99_000, costUsd: null }),
      ],
      findingsOf: async () => [],
      readNotes: async () => null,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.total_duration_ms).toBe(8200);
    expect(payload.total_cost_usd).toBeCloseTo(0.14, 10);
  });

  it('reports an unknown total cost as null, never as zero', async () => {
    // The one confusion `cost_usd`'s contract exists to prevent: a fan-out whose
    // price nobody recorded costs an unknown amount, not nothing.
    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', status: 'done', durationMs: 1000, costUsd: null }),
        run({ runId: 'b', status: 'done', durationMs: 2000, costUsd: null }),
      ],
      findingsOf: async () => [],
      readNotes: async () => null,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.total_cost_usd).toBeNull();
    expect(payload.total_duration_ms).toBe(2000);
  });

  it('renders groups with empty notes and the fallback title while nothing is synthesised', async () => {
    // AC-38's steady state, and the state the product is in until the synthesis
    // ships: `notes` is null, so every stance sentence is empty and every group
    // heading is the deterministic fallback — the highest-severity finding's
    // title.
    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', agentId: 'agent-a', agentName: 'Security', reviewId: 'rev-a' }),
        run({ runId: 'b', agentId: 'agent-b', agentName: 'Style', reviewId: 'rev-b' }),
        run({ runId: 'c', agentId: 'agent-c', agentName: 'Perf', reviewId: 'rev-c' }),
      ],
      findingsOf: async () => [
        finding({ id: 'f-1', reviewId: 'rev-a', severity: 'WARNING', title: 'Magic number 3600' }),
      ],
      readNotes: async () => null,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.conflicts).toHaveLength(1);
    const group = payload.conflicts[0]!;
    expect(group.file).toBe('lib/rate-limit.ts');
    expect(group.line).toBe(28);
    expect(group.title).toBe('Magic number 3600');
    // One stance per agent OF THE MULTI-RUN, including the two that said nothing.
    expect(group.takes.map((t) => [t.agent_id, t.persona, t.verdict, t.note])).toEqual([
      ['agent-a', 'Security', 'WARNING', ''],
      ['agent-b', 'Style', 'ignored', ''],
      ['agent-c', 'Perf', 'ignored', ''],
    ]);
  });

  it('merges a persisted label and note, and discards what belongs to no group or agent', async () => {
    // AC-31/AC-101: the label overrides the fallback title. AC-38: a group with
    // no label keeps the fallback and a stance with no note stays empty. And
    // anything addressed to a location or an agent this multi-run does not have
    // is dropped rather than rendered somewhere approximate.
    const notes: MultiAgentNotes = {
      notes: [
        { file: 'lib/rate-limit.ts', line: 28, agent_id: 'agent-a', note: 'Called it a warning.' },
        { file: 'lib/rate-limit.ts', line: 28, agent_id: 'ghost', note: 'Not in this multi-run.' },
        { file: 'nowhere.ts', line: 1, agent_id: 'agent-a', note: 'No such group.' },
      ],
      labels: [
        { file: 'lib/rate-limit.ts', line: 28, label: 'Unexplained 3600-second window' },
        { file: 'nowhere.ts', line: 1, label: 'No such group either' },
      ],
    };

    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', agentId: 'agent-a', agentName: 'Security', reviewId: 'rev-a' }),
        run({ runId: 'b', agentId: 'agent-b', agentName: 'Style', reviewId: 'rev-b' }),
      ],
      findingsOf: async () => [
        finding({ id: 'f-1', reviewId: 'rev-a', severity: 'WARNING', title: 'Magic number 3600' }),
      ],
      readNotes: async () => notes,
    });

    const payload = await svc.latest(WS, PR);
    // The group COUNT does not move when a synthesis lands: it decorates groups,
    // it does not create or remove them.
    expect(payload.conflicts).toHaveLength(1);
    const group = payload.conflicts[0]!;
    expect(group.title).toBe('Unexplained 3600-second window');
    expect(group.takes.map((t) => [t.agent_id, t.note])).toEqual([
      ['agent-a', 'Called it a warning.'],
      // No note was returned for the silent agent: empty, not the ghost's note.
      ['agent-b', ''],
    ]);
  });

  it('gives each of two groups at ONE file and line its own label and notes', async () => {
    // The bug this exists for: a record used to be keyed by (file, line) alone,
    // so where EC-9 puts two groups on one line the last label written won and
    // BOTH groups rendered the same heading — while the other synthesised label
    // sat unused in the blob. Two findings from one agent, at one location, with
    // titles too dissimilar to merge (AC-26), is exactly that shape.
    const notes: MultiAgentNotes = {
      notes: [
        {
          file: 'lib/rate-limit.ts',
          line: 28,
          title: 'Magic number 3600',
          agent_id: 'agent-a',
          note: 'About the constant.',
        },
        {
          file: 'lib/rate-limit.ts',
          line: 28,
          title: 'Retry-After header omitted',
          agent_id: 'agent-a',
          note: 'About the header.',
        },
      ],
      labels: [
        { file: 'lib/rate-limit.ts', line: 28, title: 'Magic number 3600', label: 'the window' },
        {
          file: 'lib/rate-limit.ts',
          line: 28,
          title: 'Retry-After header omitted',
          label: 'the header',
        },
      ],
    };

    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', agentId: 'agent-a', agentName: 'Security', reviewId: 'rev-a' }),
        run({ runId: 'b', agentId: 'agent-b', agentName: 'Style', reviewId: 'rev-b' }),
      ],
      findingsOf: async () => [
        finding({ id: 'f-1', reviewId: 'rev-a', severity: 'WARNING', title: 'Magic number 3600' }),
        finding({
          id: 'f-2',
          reviewId: 'rev-a',
          severity: 'WARNING',
          title: 'Retry-After header omitted',
        }),
      ],
      readNotes: async () => notes,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.conflicts).toHaveLength(2);
    // Each group takes ITS OWN label — not the same one twice, which is what a
    // location-keyed lookup produced.
    expect(new Set(payload.conflicts.map((c) => c.title))).toEqual(
      new Set(['the window', 'the header']),
    );
    // And its own sentence, for the same reason.
    const noteFor = (title: string) =>
      payload.conflicts.find((c) => c.title === title)?.takes.find((t) => t.agent_id === 'agent-a')
        ?.note;
    expect(noteFor('the window')).toBe('About the constant.');
    expect(noteFor('the header')).toBe('About the header.');
  });

  it('ignores a legacy record with no title where two groups share the location', async () => {
    // A blob written before the discriminator existed carries only (file, line).
    // Where one group sits there it is still used — the case above proves that,
    // since its records carry no title either. Where TWO do, it could belong to
    // either, and a heading on the wrong group is worse than no heading: both
    // groups keep their deterministic fallback (AC-31).
    const notes: MultiAgentNotes = {
      notes: [],
      labels: [{ file: 'lib/rate-limit.ts', line: 28, label: 'ambiguous' }],
    };

    const svc = service({
      runsOf: async () => [
        run({ runId: 'a', agentId: 'agent-a', agentName: 'Security', reviewId: 'rev-a' }),
        run({ runId: 'b', agentId: 'agent-b', agentName: 'Style', reviewId: 'rev-b' }),
      ],
      findingsOf: async () => [
        finding({ id: 'f-1', reviewId: 'rev-a', severity: 'WARNING', title: 'Magic number 3600' }),
        finding({
          id: 'f-2',
          reviewId: 'rev-a',
          severity: 'WARNING',
          title: 'Retry-After header omitted',
        }),
      ],
      readNotes: async () => notes,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.conflicts).toHaveLength(2);
    expect(payload.conflicts.map((c) => c.title)).not.toContain('ambiguous');
  });

  it('keys a deleted agent’s column and its stances on the same prefixed run id', async () => {
    // EC-2. `agent_runs.agent_id` is ON DELETE SET NULL, so the run outlives its
    // agent. An unprefixed key would let a run id collide with an agent id, and
    // a column keyed differently from its own stance is a stance that renders
    // against nobody.
    const svc = service({
      runsOf: async () => [
        run({ runId: 'run-gone', agentId: null, agentName: null, reviewId: 'rev-a' }),
        run({ runId: 'run-b', agentId: 'agent-b', agentName: 'Style', reviewId: 'rev-b' }),
      ],
      findingsOf: async () => [finding({ id: 'f-1', reviewId: 'rev-a' })],
      readNotes: async () => null,
    });

    const payload = await svc.latest(WS, PR);
    expect(payload.columns[0]!.agent_id).toBe('run:run-gone');
    // It still names something in TEXT: colour is never the only carrier of an
    // agent's identity (AC-88).
    expect(payload.columns[0]!.agent_name).toBe('Deleted agent');
    expect(payload.conflicts[0]!.takes[0]!.agent_id).toBe('run:run-gone');
  });

  it('answers a pull request with no multi-run by throwing, and reads nothing else', async () => {
    // AC-17. Every other store method throws its own name, so this also proves
    // the service stops at the parent lookup rather than querying on and
    // assembling an empty payload.
    const svc = new MultiAgentService({ store: store({ latestForPull: async () => undefined }) });
    await expect(svc.latest(WS, PR)).rejects.toBeInstanceOf(NotFoundError);
  });
});
