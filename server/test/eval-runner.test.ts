import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { EvalRunner, BATCH_DEADLINE_ERROR } from '../src/modules/eval/runner.js';
import type {
  EvalBatchRunInput,
  EvalProgressBus,
  EvalRunnerDeps,
  ReviewEngine,
} from '../src/modules/eval/runner.js';
import type {
  EvalBatchPatch,
  EvalRunInsert,
  EvalSkillSource,
  EvalStore,
} from '../src/modules/eval/types.js';
import type { ReviewInput, ReviewOutcome } from '@devdigest/reviewer-core';
import type { EvalAgentCase, EvalBatch, Finding, LLMProvider } from '@devdigest/shared';

/**
 * Batch execution: the bounds, the three `not_run` reasons, the metrics, and the
 * negatives.
 *
 * **Most of this file proves absences,** and an assertion over the result cannot
 * see one. So every fake here is built the way
 * `test/project-context-effective.test.ts` builds its document reader: each
 * method the case under test is not supposed to touch throws with its OWN NAME.
 * A runner that wrote a case row through the wrong method, resolved a provider it
 * should not have needed, or read the eval set when it was handed one case fails
 * with the name of the call it made, rather than passing because the returned
 * numbers happened to look right.
 *
 * The structural half of R7 is stronger than any fake, and worth stating because
 * a reader will look for the test: `EvalRunnerDeps` has exactly five ports —
 * a store, a diff parser, an LLM factory, an event bus and a skills source. There is no
 * repository of reviews, findings, pull requests or agent runs in the runner's
 * dependency list and no git client anywhere near it, so no batch can write
 * those rows or resolve a clone. What the fakes below add is the narrower claim
 * that even the store it DOES hold is used for exactly two writes:
 * `insertRun` and `updateBatch`.
 */

const WS = 'ws-1';

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

/**
 * The store, with `insertRun` and `updateBatch` as the ONLY reachable methods —
 * the two writes a batch is allowed to make.
 */
function store(over: Partial<EvalStore> = {}): EvalStore {
  return {
    listCases: unreachable('listCases'),
    getCase: unreachable('getCase'),
    countCases: unreachable('countCases'),
    countCasesByOwner: unreachable('countCasesByOwner'),
    findCaseBySourceFinding: unreachable('findCaseBySourceFinding'),
    listCaseAnchors: unreachable('listCaseAnchors'),
    insertCase: unreachable('insertCase'),
    updateCase: unreachable('updateCase'),
    deleteCase: unreachable('deleteCase'),
    insertBatch: unreachable('insertBatch'),
    getBatch: unreachable('getBatch'),
    updateBatch: unreachable('updateBatch'),
    listAgentBatches: unreachable('listAgentBatches'),
    listRunningBatches: unreachable('listRunningBatches'),
    listWorkspaceBatches: unreachable('listWorkspaceBatches'),
    listBatchCaseResults: unreachable('listBatchCaseResults'),
    insertRun: unreachable('insertRun'),
    pruneAgentBatches: unreachable('pruneAgentBatches'),
    ...over,
  };
}

/**
 * A provider that answers nothing.
 *
 * The engine is what talks to a model, and the engine is substituted in these
 * tests, so every method here must stay unreached. A runner that assembled its
 * own prompt or called `completeStructured` itself — the one thing
 * `DDG-SEC-002` forbids, because the injection guard lives inside the engine's
 * `assemblePrompt` and nowhere else — fails by name here.
 */
function silentProvider(): LLMProvider {
  return {
    id: 'openai',
    listModels: unreachable('provider.listModels'),
    complete: unreachable('provider.complete'),
    completeStructured: unreachable('provider.completeStructured'),
    embed: unreachable('provider.embed'),
  };
}

interface RecordedBus extends EvalProgressBus {
  events: { kind: string; msg: string; data?: unknown }[];
  completed: string[];
}

function bus(): RecordedBus {
  const events: RecordedBus['events'] = [];
  const completed: string[] = [];
  return {
    events,
    completed,
    publish(_streamId, kind, msg, data) {
      events.push({ kind, msg, data });
      return undefined;
    },
    complete(streamId) {
      completed.push(streamId);
    },
  };
}

/**
 * The skills source, recording every agent id it was asked about.
 *
 * The call LIST rather than a counter: "once per batch" is a claim about how many
 * reads happened, and a counter cannot tell one read of the right agent from one
 * read of the wrong one.
 */
interface RecordedSkills extends EvalSkillSource {
  calls: string[];
}

function skillSource(bodies: string[] = []): RecordedSkills {
  const calls: string[] = [];
  return {
    calls,
    async resolveBodiesForAgent(agentId) {
      calls.push(agentId);
      return { bodies };
    },
  };
}

/* ─── fixtures ────────────────────────────────────────────────────────────── */

function diffFor(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,8 @@',
    ' context',
    '+added one',
    '+added two',
  ].join('\n');
}

function evalCase(id: string, over: Partial<EvalAgentCase> = {}): EvalAgentCase {
  const file = `src/${id}.ts`;
  return {
    id,
    owner_kind: 'agent',
    owner_id: 'agent-1',
    name: `${file}:2-8`,
    input_diff: diffFor(file),
    input_files: [{ path: file }],
    input_meta: {},
    expected_output: {},
    notes: null,
    expectation: 'must_find',
    expected_anchors: [{ file, low_line: 2, high_line: 8 }],
    source_finding_id: null,
    source_severity: null,
    source_category: null,
    edited: false,
    last_execution: null,
    ...over,
  };
}

function finding(file: string, startLine = 4, endLine = 6): Finding {
  return {
    id: `f-${file}-${startLine}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'Something is off',
    file,
    start_line: startLine,
    end_line: endLine,
    rationale: 'because',
    confidence: 0.9,
  };
}

const RUNNING: EvalBatch = {
  id: 'batch-1',
  workspace_id: WS,
  agent_id: 'agent-1',
  agent_name: 'General Reviewer',
  agent_version: 7,
  system_prompt_snapshot: 'the v7 prompt',
  model_snapshot: 'gpt-5-mini',
  status: 'running',
  label: null,
  started_at: '2026-08-20T12:00:00.000Z',
  finished_at: null,
  cases_covered: null,
  cases_passed: null,
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  error: null,
};

function input(cases: EvalAgentCase[], provider = 'openai'): EvalBatchRunInput {
  return { workspaceId: WS, batch: RUNNING, provider, cases };
}

/** A `ReviewOutcome` carrying exactly the four fields the runner reads. */
function outcome(
  findings: Finding[],
  dropped: number,
  costUsd: number | null,
): ReviewOutcome {
  return {
    review: { verdict: 'comment', summary: 'ok', score: 70, findings },
    grounding: `${findings.length}/${findings.length + dropped} passed`,
    dropped: Array.from({ length: dropped }, (_v, i) => ({
      finding: finding('src/dropped.ts', i + 1, i + 1),
      reason: 'not on the diff',
    })),
    mode: 'single-pass',
    assembly: { system: 'the v7 prompt', user: 'the diff' },
    chunks: [{ label: 'all files' }],
    tokensIn: 10,
    tokensOut: 20,
    costUsd,
    raw: '{}',
  };
}

/** An engine that records every call and answers from a per-case table. */
function engineOver(
  answers: Record<string, () => Promise<ReviewOutcome>>,
): { engine: ReviewEngine; calls: ReviewInput[] } {
  const calls: ReviewInput[] = [];
  const engine: ReviewEngine = async (req) => {
    calls.push(req);
    const key = req.diff.files[0]?.path ?? '';
    const answer = answers[key];
    if (!answer) throw new Error(`no scripted answer for '${key}'`);
    return answer();
  };
  return { engine, calls };
}

interface Recorded {
  runs: EvalRunInsert[];
  patches: EvalBatchPatch[];
  /** Engine calls seen at the moment each batch patch was written (AC-35). */
  callsAtPatch: number[];
}

/**
 * `store` is a PARTIAL here while `EvalRunnerDeps.store` is not: the two writes a
 * batch may make are supplied by default and everything else throws by name, so
 * a case overrides one method rather than restating eighteen.
 */
type RunnerOver = Partial<Omit<EvalRunnerDeps, 'store'>> & { store?: Partial<EvalStore> };

function runnerFor(
  over: RunnerOver,
  callCount: () => number = () => 0,
): {
  runner: EvalRunner;
  recorded: Recorded;
  progress: RecordedBus;
  skills: RecordedSkills;
} {
  const recorded: Recorded = { runs: [], patches: [], callsAtPatch: [] };
  const progress = over.bus ? (over.bus as RecordedBus) : bus();
  // An agent with no enabled skills is the DEFAULT here, so every case above
  // asserts the pre-skills prompt shape unless it says otherwise.
  const skills = over.skills ? (over.skills as RecordedSkills) : skillSource();
  const runner = new EvalRunner({
    parseDiff: parseUnifiedDiff,
    llm: async () => silentProvider(),
    bus: progress,
    skills,
    ...over,
    store: store({
      insertRun: async (values) => {
        recorded.runs.push(values);
      },
      updateBatch: async (_ws, _id, patch) => {
        recorded.patches.push(patch);
        recorded.callsAtPatch.push(callCount());
        return { ...RUNNING, status: patch.status ?? 'running' };
      },
      ...(over.store ?? {}),
    }),
  });
  return { runner, recorded, progress, skills };
}

/* ─── the bounds ──────────────────────────────────────────────────────────── */

describe('EvalRunner — bounds', () => {
  it('never has a fourth case in flight, and keeps every answer', async () => {
    // AC-25. Concurrency is FIXED, not tuned: 4 and 5 each both fit and overran
    // on different runs of the same repository and model, and a wave-level
    // deadline made it worse by throwing away answers that had arrived.
    const cases = Array.from({ length: 9 }, (_v, i) => evalCase(`c${i}`));
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];

    const engine: ReviewEngine = async (req) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
      return outcome([finding(req.diff.files[0]?.path ?? '')], 0, 0.001);
    };

    const { runner, recorded } = runnerFor({ review: engine });
    const running = runner.execute(input(cases));

    // Release the parked calls ONE at a time, flushing the task queue between
    // each: every observation of `peak` is taken with the pool as full as the
    // runner will let it be, which is the only moment a fourth call could show.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    for (let released = 0; released < cases.length; released += 1) {
      await flush();
      expect(peak).toBeLessThanOrEqual(3);
      const next = release.shift();
      expect(next).toBeDefined();
      next?.();
    }
    await running;

    expect(peak).toBe(3);
    expect(recorded.runs).toHaveLength(9);
    expect(recorded.patches[0]?.casesCovered).toBe(9);
  });

  it('carries a zero retry budget and the BATCH snapshot on every call', async () => {
    // AC-26. The request's own timeout field is silently ignored — the timeout is
    // fixed when the client is constructed — so the deadline is raced by the
    // caller, and the provider must not multiply the work behind it.
    const cases = [evalCase('a'), evalCase('b')];
    const { engine, calls } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
      'src/b.ts': async () => outcome([finding('src/b.ts')], 0, 0.001),
    });

    const { runner } = runnerFor({ review: engine });
    await runner.execute(input(cases));

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.maxRetries).toBe(0);
      // The batch's snapshot, never today's agent config.
      expect(call.systemPrompt).toBe('the v7 prompt');
      expect(call.model).toBe('gpt-5-mini');
    }
  });

  it('stops starting cases past the batch deadline and records the batch as error', async () => {
    // AC-30/31: a batch past its deadline becomes `error` with a reason and
    // starts nothing further — and the cases it never reached stay in the
    // covered total, because a harness that drops what it missed reports 1/3 for
    // a set of three and looks like it improved.
    const cases = [evalCase('a'), evalCase('b'), evalCase('c')];
    let clock = 0;
    const { engine, calls } = engineOver({
      'src/a.ts': async () => {
        clock += 1000; // the first case burns the whole batch window
        return outcome([finding('src/a.ts')], 0, 0.002);
      },
    });

    const { runner, recorded } = runnerFor({
      review: engine,
      now: () => clock,
      batchDeadlineMs: 500,
      concurrency: 1,
    });
    await runner.execute(input(cases));

    expect(calls).toHaveLength(1);
    expect(recorded.runs.map((r) => r.notRunReason)).toEqual([null, 'cancelled', 'cancelled']);
    const patch = recorded.patches[0];
    expect(patch?.status).toBe('error');
    expect(patch?.error).toBe(BATCH_DEADLINE_ERROR);
    expect(patch?.casesCovered).toBe(3);
    expect(patch?.casesPassed).toBe(1);
  });
});

/* ─── the three not_run reasons ───────────────────────────────────────────── */

describe('EvalRunner — not_run', () => {
  it('records diff_unparseable without resolving a provider or calling the engine', async () => {
    // Zero model calls, and the cheapest proof is that the FACTORY is never
    // reached either: `''` is what a pre-feature row's null `input_diff` maps to.
    const cases = [evalCase('a', { input_diff: '' }), evalCase('b', { input_diff: 'not a diff' })];
    const { runner, recorded, progress } = runnerFor({
      review: unreachable('reviewPullRequest'),
      llm: unreachable('llm'),
    });

    await runner.execute(input(cases));

    expect(recorded.runs.map((r) => [r.outcome, r.notRunReason])).toEqual([
      ['not_run', 'diff_unparseable'],
      ['not_run', 'diff_unparseable'],
    ]);
    expect(recorded.runs.every((r) => r.costUsd === null && r.actualCount === null)).toBe(true);
    // Nothing was measured, so no metric is: three nulls, not three zeroes.
    expect(recorded.patches[0]).toMatchObject({
      status: 'complete',
      casesCovered: 2,
      casesPassed: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      costUsd: null,
    });
    expect(progress.completed).toEqual(['batch-1']);
  });

  it('records deadline for a case the engine never answers, and keeps going', async () => {
    const cases = [evalCase('slow'), evalCase('quick')];
    const { engine, calls } = engineOver({
      'src/slow.ts': () => new Promise<ReviewOutcome>(() => undefined),
      'src/quick.ts': async () => outcome([finding('src/quick.ts')], 0, 0.001),
    });

    const { runner, recorded } = runnerFor({ review: engine, caseDeadlineMs: 5 });
    await runner.execute(input(cases));

    expect(calls).toHaveLength(2);
    const byCase = new Map(recorded.runs.map((r) => [r.caseId, r]));
    expect(byCase.get('slow')?.notRunReason).toBe('deadline');
    // A case that missed its deadline does not end the batch.
    expect(byCase.get('quick')?.outcome).toBe('passed');
    expect(recorded.patches[0]?.status).toBe('complete');
  });

  it('records provider_error for a rejecting call and for an unreadable provider id', async () => {
    const rejecting = engineOver({
      'src/a.ts': () => Promise.reject(new Error('402 insufficient credit')),
    });
    const first = runnerFor({ review: rejecting.engine });
    await first.runner.execute(input([evalCase('a')]));
    expect(first.recorded.runs[0]?.notRunReason).toBe('provider_error');

    // An unknown stored provider id is parsed, never cast — and the failure is
    // the case's, not the batch's.
    const second = runnerFor({ review: unreachable('reviewPullRequest'), llm: unreachable('llm') });
    await second.runner.execute(input([evalCase('a')], 'not-a-provider'));
    expect(second.recorded.runs[0]?.notRunReason).toBe('provider_error');
    expect(second.recorded.patches[0]?.status).toBe('complete');
  });
});

/* ─── metrics and cost ────────────────────────────────────────────────────── */

describe('EvalRunner — what the batch records', () => {
  it('reads 2 of 4 covered, never 2 of 3, and publishes one event per outcome', async () => {
    const cases = [
      evalCase('hit'),
      evalCase('miss'),
      evalCase('clean', {
        expectation: 'must_not_flag',
        expected_anchors: [{ file: 'src/clean.ts', low_line: 2, high_line: 8 }],
      }),
      evalCase('broken', { input_diff: '' }),
    ];
    const { engine } = engineOver({
      'src/hit.ts': async () => outcome([finding('src/hit.ts', 4, 6)], 1, 0.001),
      // A finding well outside the anchor: the anchor is missed AND the finding
      // is noise, which is both a false negative and a false positive.
      'src/miss.ts': async () => outcome([finding('src/miss.ts', 900, 902)], 0, 0.002),
      // The forbidden anchor is untouched, and an unrelated real finding in the
      // same diff does not make the case fail.
      'src/clean.ts': async () => outcome([finding('src/clean.ts', 500, 501)], 0, 0.003),
    });

    const { runner, recorded, progress } = runnerFor({ review: engine, concurrency: 1 });
    await runner.execute(input(cases));

    const patch = recorded.patches[0];
    expect(patch).toMatchObject({
      status: 'complete',
      casesCovered: 4,
      casesPassed: 2,
      truePositives: 1,
      falseNegatives: 1,
      // ONE false positive, not two: only the `miss` case's stray finding is
      // noise. The `must_not_flag` case's unrelated finding is not counted at
      // all — a negative case asserts its forbidden anchor and nothing else, so
      // an agent that is right about something else is not punished for it.
      falsePositives: 1,
    });
    expect(patch?.recall).toBeCloseTo(0.5, 10);
    expect(patch?.precision).toBeCloseTo(0.5, 10);
    // 3 kept over 3 kept + 1 dropped, aggregated over the EXECUTED cases only —
    // the `not_run` case produced no output, so it cannot move this metric.
    expect(patch?.citationAccuracy).toBeCloseTo(3 / 4, 10);
    expect(patch?.costUsd).toBeCloseTo(0.006, 10);

    // One event per outcome, and a `not_run` reads distinctly from a failure.
    const outcomes = progress.events
      .filter((e) => e.kind !== 'info')
      .map((e) => (e.data as { outcome: string; not_run_reason: string | null }));
    expect(outcomes.map((o) => o.outcome)).toEqual(['passed', 'failed', 'passed', 'not_run']);
    expect(outcomes[3]?.not_run_reason).toBe('diff_unparseable');
    expect(progress.events.filter((e) => e.kind === 'error')).toHaveLength(1);
  });

  it('leaves total cost null when one executed case has no cost, never a smaller sum', async () => {
    // This exact shape once had a PR list reporting $0.00064 of a real $0.0051.
    const cases = [evalCase('a'), evalCase('b')];
    const { engine } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.005),
      'src/b.ts': async () => outcome([finding('src/b.ts')], 0, null),
    });

    const { runner, recorded } = runnerFor({ review: engine, concurrency: 1 });
    await runner.execute(input(cases));

    expect(recorded.patches[0]?.costUsd).toBeNull();
    expect(recorded.patches[0]?.casesPassed).toBe(2);
  });

  it('issues no model request between the last case answering and the batch completing', async () => {
    // AC-35, asserted where it happens: the engine call count is captured AT the
    // moment the batch row is written, so a scorer that reached for a model, or
    // any "one more pass" before completion, moves this number.
    const cases = [evalCase('a'), evalCase('b')];
    const { engine, calls } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
      'src/b.ts': async () => outcome([finding('src/b.ts')], 0, 0.001),
    });

    const { runner, recorded } = runnerFor({ review: engine }, () => calls.length);
    await runner.execute(input(cases));

    expect(calls).toHaveLength(2);
    expect(recorded.callsAtPatch).toEqual([2]);
  });
});

/* ─── the third lever: the agent's linked skills ───────────────────────────── */

describe('EvalRunner — linked skills', () => {
  it('passes every enabled body, in link order, on every case call', async () => {
    // The feature exists to answer "changed a prompt, a model OR a linked skill →
    // did the agent get better or worse". The prompt and the model come off the
    // batch snapshot; the bodies come off the agent's CURRENT links, through the
    // same service the real review path uses. Without them a skill edit cannot
    // move recall, precision or citation accuracy at all.
    const cases = [evalCase('a'), evalCase('b')];
    const { engine, calls } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
      'src/b.ts': async () => outcome([finding('src/b.ts')], 0, 0.001),
    });

    const { runner, skills } = runnerFor({
      review: engine,
      skills: skillSource(['first body', 'second body']),
    });
    await runner.execute(input(cases));

    expect(skills.calls).toEqual(['agent-1']);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      // LINK ORDER, not sorted and not deduplicated: the service already ordered
      // them and already wrapped whichever came from an untrusted source.
      expect(call.skills).toEqual(['first body', 'second body']);
    }
  });

  it('passes no skills KEY at all for an agent with none', async () => {
    // `skills: []` would pass a `toEqual([])` assertion and still be the bug:
    // `assemblePrompt` drops the whole "## Skills / rules" section only when the
    // field is ABSENT, so an empty array changes the prompt by a heading and
    // makes every batch recorded before this fix incomparable to every batch
    // after it. The absence of the key is the assertion.
    const cases = [evalCase('a')];
    const { engine, calls } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
    });

    const { runner } = runnerFor({ review: engine, skills: skillSource([]) });
    await runner.execute(input(cases));

    const call = calls[0];
    expect(call).toBeDefined();
    expect(call && 'skills' in call).toBe(false);
  });

  it('resolves the bodies once per batch, not once per case', async () => {
    // Four cases, one agent, one config: a per-case resolution would issue four
    // identical reads and the call count is the only thing that says which
    // happened.
    const cases = [evalCase('a'), evalCase('b'), evalCase('c'), evalCase('d')];
    const { engine, calls } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
      'src/b.ts': async () => outcome([finding('src/b.ts')], 0, 0.001),
      'src/c.ts': async () => outcome([finding('src/c.ts')], 0, 0.001),
      'src/d.ts': async () => outcome([finding('src/d.ts')], 0, 0.001),
    });

    const { runner, skills } = runnerFor({
      review: engine,
      skills: skillSource(['one body']),
    });
    await runner.execute(input(cases));

    expect(calls).toHaveLength(4);
    expect(skills.calls).toHaveLength(1);
  });
});

/* ─── failing, and never leaving the stream open ──────────────────────────── */

describe('EvalRunner — failure', () => {
  it('records the failure on the batch row and closes the stream', async () => {
    // A batch that fails needs its own row updated, not merely to survive: a
    // `running` row nobody closes blocks the agent until the staleness window.
    const cases = [evalCase('a')];
    const { engine } = engineOver({
      'src/a.ts': async () => outcome([finding('src/a.ts')], 0, 0.001),
    });
    const { runner, recorded, progress } = runnerFor({
      review: engine,
      store: {
        insertRun: () => Promise.reject(new Error('eval_runs write failed')),
      },
    });

    await expect(runner.execute(input(cases))).resolves.toBeUndefined();

    expect(recorded.patches).toEqual([
      {
        status: 'error',
        error: 'eval_runs write failed',
        finishedAt: expect.any(Date),
      },
    ]);
    // No metric is invented on the failure path: a zero on a dashboard that
    // nothing measured is worse than an absence.
    expect(progress.completed).toEqual(['batch-1']);
    expect(progress.events.some((e) => e.kind === 'error')).toBe(true);
  });

  /* ─── the trial run of an unsaved draft ─────────────────────────────────── */

  /* `runTrial` exists so a reader can press `Run case` repeatedly and watch
     whether a finding reproduces BEFORE the case joins the set. The whole value
     of that depends on an absence — no batch row, no run row, no event — which
     an assertion over the returned outcome cannot see. Every store method is
     `unreachable` by construction in this file, so a write of any kind fails
     with the name of the call it made. */
  describe('runTrial', () => {
    const draft = {
      id: 'trial',
      name: 'src/a.ts:2-8',
      input_diff: diffFor('src/a.ts'),
      expectation: 'must_find' as const,
      expected_anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }],
    };

    const trialInput = {
      agentId: 'agent-1',
      systemPrompt: 'the CURRENT prompt',
      model: 'gpt-5-mini',
      provider: 'openai',
      evalCase: draft,
    };

    it('scores one draft and writes NOTHING — no batch row, no run row, no event', async () => {
      const { engine } = engineOver({
        'src/a.ts': async () => outcome([finding('src/a.ts', 4, 6)], 1, 0.02),
      });
      const { runner, recorded, progress } = runnerFor({
        review: engine,
        // Both writes are removed, so the defaults in `store()` apply and each
        // throws with its own name. A trial that recorded anything fails here.
        store: { insertRun: unreachable('insertRun'), updateBatch: unreachable('updateBatch') },
      });

      const result = await runner.runTrial(trialInput);

      expect(result.outcome).toBe('passed');
      expect(result.expected_count).toBe(1);
      expect(result.actual_count).toBe(1);
      expect(result.kept_count).toBe(1);
      expect(result.dropped_count).toBe(1);
      expect(result.cost_usd).toBe(0.02);
      expect(result.actual_output).toEqual({ findings: [finding('src/a.ts', 4, 6)] });
      // The absences, stated rather than implied by the greens above.
      expect(recorded.runs).toEqual([]);
      expect(recorded.patches).toEqual([]);
      expect(progress.events).toEqual([]);
      expect(progress.completed).toEqual([]);
    });

    it('replays against the prompt it was handed, with the agent’s current skills', async () => {
      const { engine, calls } = engineOver({
        'src/a.ts': async () => outcome([], 0, null),
      });
      const skills = skillSource(['## skill\nprefer env vars']);
      const { runner } = runnerFor({
        review: engine,
        skills,
        store: { insertRun: unreachable('insertRun'), updateBatch: unreachable('updateBatch') },
      });

      const result = await runner.runTrial(trialInput);

      // A `must_find` case whose run produced no finding FAILS — it did not
      // reproduce, which is exactly what a reader presses the button to learn.
      expect(result.outcome).toBe('failed');
      expect(result.actual_count).toBe(0);
      expect(calls[0]!.systemPrompt).toBe('the CURRENT prompt');
      expect(calls[0]!.skills).toEqual(['## skill\nprefer env vars']);
      expect(calls[0]!.maxRetries).toBe(0);
      // Its own session namespace: a trial is not a batch and must not collide
      // with one in anything keyed on the session id.
      expect(calls[0]!.sessionId).toBe('eval-trial:agent-1:trial');
      expect(skills.calls).toEqual(['agent-1']);
    });

    it('records an unparseable draft diff as not_run with zero model calls', async () => {
      const { runner } = runnerFor({
        review: unreachable('reviewPullRequest'),
        llm: unreachable('llm'),
        store: { insertRun: unreachable('insertRun'), updateBatch: unreachable('updateBatch') },
      });

      const result = await runner.runTrial({
        ...trialInput,
        evalCase: { ...draft, input_diff: '' },
      });

      expect(result.outcome).toBe('not_run');
      expect(result.not_run_reason).toBe('diff_unparseable');
      expect(result.actual_output).toBeNull();
      expect(result.cost_usd).toBeNull();
    });
  });

  it('start() detaches and never rejects, even when recording the failure fails too', async () => {
    const { runner } = runnerFor({
      review: unreachable('reviewPullRequest'),
      llm: unreachable('llm'),
      store: {
        insertRun: () => Promise.reject(new Error('first write failed')),
        updateBatch: () => Promise.reject(new Error('and so did the failure record')),
      },
    });

    expect(runner.start(input([evalCase('a', { input_diff: '' })]))).toBeUndefined();
    // Let the detached work settle: an unhandled rejection here has taken this
    // API process down before.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
