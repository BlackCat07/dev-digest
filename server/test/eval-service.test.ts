import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { EvalRefusal, EvalService } from '../src/modules/eval/service.js';
import { BATCH_DEADLINE_ERROR } from '../src/modules/eval/runner.js';
import { BATCH_DEADLINE_MS, CASE_LIMIT, DIFF_MAX_BYTES } from '../src/modules/eval/constants.js';
import type { EvalBatchRunInput, EvalBatchRunner } from '../src/modules/eval/runner.js';
import type {
  EvalAgentFacts,
  EvalAgentSource,
  EvalBatchPatch,
  EvalCaseInsert,
  EvalFindingSource,
  EvalSourceFinding,
  EvalStore,
} from '../src/modules/eval/types.js';
import type { EvalAgentCase, EvalBatch } from '@devdigest/shared';
import { AppError } from '../src/platform/errors.js';

/**
 * The Eval Pipeline's application ring: every refusal, the staleness window, the
 * comparison rules, `Run all agents`, and the dashboard's per-agent grouping.
 *
 * Hermetic, and it has to be — `DDG-TEST-001` reserves `*.it.test.ts` for the
 * DB-backed file, and none of the rules below is about storage. The service is
 * constructed with the consumer-declared ports from `modules/eval/types.ts`, so
 * these tests also stand as the proof that those ports are satisfiable by
 * something that is not a database.
 *
 * **Every fake method not named by a case throws with its own name.** That turns
 * "nothing was written" from an assertion about a returned value — which can
 * only ever say the answer looked right — into a failing test that NAMES the
 * call that should not have happened. `test/project-context-effective.test.ts`
 * pinned "this path reads no bytes and resolves no clone" the same way. A
 * refusal case therefore leaves `insertCase` unreachable rather than counting
 * calls on a spy: an insert that happened at all is the failure.
 */

const WS = 'ws-1';
const AGENT = 'agent-1';
const DECIDED_AT = new Date('2026-08-01T00:00:00.000Z');

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

function store(over: Partial<EvalStore>): EvalStore {
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

function findings(over: Partial<EvalFindingSource>): EvalFindingSource {
  return {
    findingContext: unreachable('findingContext'),
    getPull: unreachable('getPull'),
    getRepo: unreachable('getRepo'),
    getPrFiles: unreachable('getPrFiles'),
    ...over,
  };
}

function agents(over: Partial<EvalAgentSource>): EvalAgentSource {
  return {
    list: unreachable('list'),
    getById: unreachable('getById'),
    getVersion: unreachable('getVersion'),
    ...over,
  };
}

/** A runner that records what it was handed and executes nothing. */
function recordingRunner(): EvalBatchRunner & { started: EvalBatchRunInput[] } {
  const started: EvalBatchRunInput[] = [];
  return {
    started,
    start(input) {
      started.push(input);
    },
    runTrial: unreachable('runner.runTrial'),
  };
}

const NEVER_RUNS: EvalBatchRunner = {
  start: unreachable('runner.start'),
  runTrial: unreachable('runner.runTrial'),
};

function agentFacts(over: Partial<EvalAgentFacts> = {}): EvalAgentFacts {
  return {
    id: AGENT,
    name: 'General Reviewer',
    provider: 'openai',
    model: 'gpt-5-mini',
    systemPrompt: 'You review pull requests.',
    version: 7,
    enabled: true,
    ...over,
  };
}

/**
 * A finding with an INVERTED line range on purpose: `Finding` does not promise
 * `start_line <= end_line` and the live table holds rows where it does not, so
 * the derived anchor must read 2–8 and not 8–2.
 */
function sourceFinding(over: Partial<EvalSourceFinding> = {}): EvalSourceFinding {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    title: 'Untrusted input reaches an outbound request',
    file: 'src/adapters/webhooks.ts',
    startLine: 8,
    endLine: 2,
    acceptedAt: DECIDED_AT,
    dismissedAt: null,
    severity: 'critical',
    category: 'security',
    ...over,
  };
}

const PULL = { id: 'pr-1', repoId: 'repo-1', number: 482, title: 'Add webhooks' };
const REPO = { id: 'repo-1', owner: 'acme', name: 'api', fullName: 'acme/api' };
const PATCH = '@@ -1,2 +1,8 @@\n context\n+added one\n+added two';

function context(finding = sourceFinding(), agentId: string | null = AGENT) {
  return {
    finding,
    review: { id: finding.reviewId, prId: PULL.id, agentId },
    pull: PULL,
  };
}

/** The finding source of the happy path: the four reads the derivation makes. */
function derivationSource(
  finding = sourceFinding(),
  agentId: string | null = AGENT,
  patch: string | null = PATCH,
): EvalFindingSource {
  return findings({
    findingContext: async () => context(finding, agentId),
    getPull: async () => PULL,
    getRepo: async () => REPO,
    getPrFiles: async () => [{ path: finding.file, patch }],
  });
}

function evalCase(over: Partial<EvalAgentCase> = {}): EvalAgentCase {
  return {
    id: 'case-1',
    owner_kind: 'agent',
    owner_id: AGENT,
    name: 'src/a.ts:2-8',
    input_diff: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}`,
    input_files: [{ path: 'src/a.ts' }],
    input_meta: {},
    expected_output: {},
    notes: null,
    expectation: 'must_find',
    expected_anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }],
    source_finding_id: 'finding-1',
    source_severity: 'CRITICAL',
    source_category: 'security',
    edited: false,
    last_execution: null,
    ...over,
  };
}

function batch(over: Partial<EvalBatch> = {}): EvalBatch {
  return {
    id: 'batch-1',
    workspace_id: WS,
    agent_id: AGENT,
    agent_name: 'General Reviewer',
    agent_version: 7,
    system_prompt_snapshot: 'v7 prompt',
    model_snapshot: 'gpt-5-mini',
    status: 'complete',
    label: null,
    started_at: '2026-08-20T10:00:00.000Z',
    finished_at: '2026-08-20T10:05:00.000Z',
    cases_covered: 4,
    cases_passed: 2,
    recall: 0.5,
    precision: 0.4,
    citation_accuracy: 0.75,
    cost_usd: 0.0051,
    error: null,
    ...over,
  };
}

/** The clock every case here reads, so a staleness boundary is exact. */
const NOW = new Date('2026-08-20T12:00:00.000Z');

function service(over: {
  store?: Partial<EvalStore>;
  findings?: EvalFindingSource;
  agents?: Partial<EvalAgentSource>;
  runner?: EvalBatchRunner;
}): EvalService {
  return new EvalService({
    store: store(over.store ?? {}),
    findings: over.findings ?? findings({}),
    /* The agent source defaults to ONE working read rather than to all-unreachable:
       deriving a case now resolves the agent the case would land on, because
       `reviews.agent_id` carries no foreign key and an id pointing at a deleted
       agent must not become a case nobody can list or run. `list` and
       `getVersion` stay unreachable, so a path that reaches either still names
       itself. */
    agents: agents(over.agents ?? { getById: async () => agentFacts() }),
    parseDiff: parseUnifiedDiff,
    runner: over.runner ?? NEVER_RUNS,
    now: () => NOW,
  });
}

/** The refusal a call produced, or a failure naming what it produced instead. */
async function refusalOf(work: Promise<unknown>): Promise<EvalRefusal> {
  try {
    const value = await work;
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  } catch (err) {
    if (err instanceof EvalRefusal) return err;
    throw err;
  }
}

/* ─── the draft behind `Turn into eval case` ──────────────────────────────── */

/* Pressing the button must not add anything to an agent's eval set. It derives a
   proposal a human reads, edits and runs; `Save` is what writes. Every store
   method except the three reads the derivation makes is `unreachable`, so a
   draft that filed a row fails with the name of the call it made rather than
   passing because the returned shape looked right. */
describe('draftCaseFromFinding', () => {
  const readsOnly = {
    findCaseBySourceFinding: async () => undefined,
    countCases: async () => 3,
    listCaseAnchors: async () => [],
  };

  it('derives the whole case and writes NOTHING', async () => {
    const svc = service({ findings: derivationSource(), store: readsOnly });

    const draft = await svc.draftCaseFromFinding(WS, 'finding-1');

    expect(draft.agent_id).toBe(AGENT);
    expect(draft.agent_name).toBe('General Reviewer');
    // Anchors arrive inverted from the table (8→2) and are normalised, exactly
    // as the saved case's are — the draft is what the save will re-derive.
    expect(draft.expectation).toBe('must_find');
    expect(draft.expected_anchors).toEqual([
      { file: 'src/adapters/webhooks.ts', low_line: 2, high_line: 8 },
    ]);
    expect(draft.name).toBe('src/adapters/webhooks.ts:2-8');
    expect(draft.input_diff).toContain('+++ b/src/adapters/webhooks.ts');
    expect(draft.input_files).toEqual([{ path: 'src/adapters/webhooks.ts' }]);
    // No id anywhere: an id would be the one field a client could mistake for
    // "this already exists".
    expect(draft).not.toHaveProperty('id');
  });

  it('seeds a finding-shaped expected output, and an empty one for a negative case', async () => {
    const positive = await service({
      findings: derivationSource(),
      store: readsOnly,
    }).draftCaseFromFinding(WS, 'finding-1');

    expect(positive.expected_output).toEqual([
      {
        severity: 'critical',
        category: 'security',
        title: 'Untrusted input reaches an outbound request',
        file: 'src/adapters/webhooks.ts',
        start_line: 2,
        end_line: 8,
      },
    ]);
    expect(positive.source).toMatchObject({ finding_id: 'finding-1', decision: 'accepted' });

    // A dismissed finding asserts the ABSENCE of a finding, and the empty list
    // IS that assertion — a skeleton here would state the opposite.
    const negative = await service({
      findings: derivationSource(sourceFinding({ acceptedAt: null, dismissedAt: DECIDED_AT })),
      store: readsOnly,
    }).draftCaseFromFinding(WS, 'finding-1');

    expect(negative.expectation).toBe('must_not_flag');
    expect(negative.expected_output).toEqual([]);
    expect(negative.source.decision).toBe('dismissed');
  });

  it('refuses an undecided finding before a modal can open on it', async () => {
    // The same refusal the save answers with, applied at the same point: a modal
    // that opened on a finding the save would reject wastes a human's editing.
    const svc = service({
      findings: derivationSource(sourceFinding({ acceptedAt: null, dismissedAt: null })),
      store: {},
    });
    const err = await refusalOf(svc.draftCaseFromFinding(WS, 'finding-1'));
    expect(err.reason).toBe('finding_has_no_decision');
  });

  it('refuses a finding whose agent has since been deleted', async () => {
    // `reviews.agent_id` carries no foreign key, so the id can outlive the row.
    // A case filed under one would be invisible in every list and unrunnable.
    const svc = service({
      findings: derivationSource(),
      store: readsOnly,
      agents: { getById: async () => undefined },
    });
    await expect(svc.draftCaseFromFinding(WS, 'finding-1')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

/* ─── running a draft without saving it ───────────────────────────────────── */

describe('trialRunCase', () => {
  const DRAFT = {
    name: 'src/a.ts:2-8',
    input_diff: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}`,
    expectation: 'must_find' as const,
    expected_anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }],
  };

  const PASSED = {
    outcome: 'passed' as const,
    not_run_reason: null,
    expected_count: 1,
    actual_count: 1,
    kept_count: 1,
    dropped_count: 0,
    duration_ms: 1840,
    cost_usd: 0.02,
    actual_output: { findings: [] },
  };

  function trialRunner(): EvalBatchRunner & { seen: unknown[] } {
    const seen: unknown[] = [];
    return {
      // A trial must never open a batch — `start` is the only way it could.
      start: unreachable('runner.start'),
      seen,
      runTrial: async (input) => {
        seen.push(input);
        return PASSED;
      },
    };
  }

  it('runs against the agent’s CURRENT config and stores nothing', async () => {
    const runner = trialRunner();
    // Every store method throws: a trial that recorded a case, a batch or a run
    // fails by the name of the call it made.
    const svc = service({ store: {}, agents: { getById: async () => agentFacts() }, runner });

    const result = await svc.trialRunCase(WS, AGENT, DRAFT);

    expect(result).toEqual(PASSED);
    expect(runner.seen).toEqual([
      {
        agentId: AGENT,
        systemPrompt: 'You review pull requests.',
        model: 'gpt-5-mini',
        provider: 'openai',
        evalCase: { id: 'trial', ...DRAFT },
      },
    ]);
  });

  it('is scoped by workspace like every other read', async () => {
    const svc = service({
      store: {},
      agents: { getById: async () => undefined },
      runner: { start: unreachable('runner.start'), runTrial: unreachable('runner.runTrial') },
    });
    await expect(svc.trialRunCase(WS, AGENT, DRAFT)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a forbidden anchor naming a file the draft diff does not contain', async () => {
    // Borrowed from `saveCase` on purpose: a trial that ran green on a case the
    // save would refuse is worse than no trial at all.
    const svc = service({
      store: {},
      agents: { getById: async () => agentFacts() },
      runner: { start: unreachable('runner.start'), runTrial: unreachable('runner.runTrial') },
    });
    const err = await refusalOf(
      svc.trialRunCase(WS, AGENT, {
        ...DRAFT,
        expectation: 'must_not_flag',
        expected_anchors: [{ file: 'src/elsewhere.ts', low_line: 1, high_line: 1 }],
      }),
    );
    expect(err.reason).toBe('anchor_not_in_diff');
  });
});

/* ─── creating a case from a decided finding ───────────────────────────────── */

describe('createCaseFromFinding', () => {
  it('derives a must_find case with a normalised anchor and a one-file diff', async () => {
    let inserted: EvalCaseInsert | undefined;
    const svc = service({
      findings: derivationSource(),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 3,
        listCaseAnchors: async () => [],
        insertCase: async (values) => {
          inserted = values;
          return evalCase({ name: values.name, input_diff: values.inputDiff });
        },
      },
    });

    await svc.createCaseFromFinding(WS, { finding_id: 'finding-1' });

    expect(inserted?.expectation).toBe('must_find');
    expect(inserted?.ownerKind).toBe('agent');
    expect(inserted?.ownerId).toBe(AGENT);
    expect(inserted?.sourceFindingId).toBe('finding-1');
    // Snapshotted from the finding, because `source_finding_id` carries no
    // foreign key: this insert is the last moment the two values are reachable,
    // so a case whose review is deleted later still renders its own chip.
    expect(inserted?.sourceSeverity).toBe('critical');
    expect(inserted?.sourceCategory).toBe('security');
    // 8→2 arrived inverted; the stored anchor is low-first, and the name reads
    // the same way round.
    expect(inserted?.expectedAnchors).toEqual([
      { file: 'src/adapters/webhooks.ts', low_line: 2, high_line: 8 },
    ]);
    expect(inserted?.name).toBe('src/adapters/webhooks.ts:2-8');

    // A standalone one-file unified diff, in the shape the same parser reads
    // back — so the stored case's new-side line numbers match the review that
    // produced the finding.
    const parsed = parseUnifiedDiff(inserted?.inputDiff ?? '');
    expect(parsed.files.map((f) => f.path)).toEqual(['src/adapters/webhooks.ts']);
    expect(inserted?.inputDiff.startsWith('diff --git a/src/adapters/webhooks.ts')).toBe(true);
  });

  it('takes the reader’s edited name, diff and expected output — and re-derives the expectation', async () => {
    let inserted: EvalCaseInsert | undefined;
    const svc = service({
      findings: derivationSource(),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 0,
        listCaseAnchors: async () => [],
        insertCase: async (values) => {
          inserted = values;
          return evalCase();
        },
      },
    });

    await svc.createCaseFromFinding(WS, {
      finding_id: 'finding-1',
      name: '  stripe-key-leak  ',
      input_diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n+edited',
      expected_output: [{ severity: 'CRITICAL', title: 'reworded by hand' }],
    });

    expect(inserted?.name).toBe('stripe-key-leak');
    expect(inserted?.inputDiff).toContain('+edited');
    expect(inserted?.expectedOutput).toEqual([{ severity: 'CRITICAL', title: 'reworded by hand' }]);
    // The two fields a client may NOT send still come from the finding's own
    // decision: an editable expectation could file a case contradicting the
    // human decision it claims to come from.
    expect(inserted?.expectation).toBe('must_find');
    expect(inserted?.expectedAnchors).toEqual([
      { file: 'src/adapters/webhooks.ts', low_line: 2, high_line: 8 },
    ]);
  });

  it('re-applies the byte budget to an EDITED diff', async () => {
    // The server's own fragment was measured during the derivation; a bound that
    // only held there is not a bound once a text area is in the path.
    const svc = service({
      findings: derivationSource(),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 0,
        listCaseAnchors: async () => [],
        insertCase: unreachable('insertCase'),
      },
    });

    const err = await refusalOf(
      svc.createCaseFromFinding(WS, {
        finding_id: 'finding-1',
        input_diff: 'x'.repeat(DIFF_MAX_BYTES + 1),
      }),
    );
    expect(err.reason).toBe('diff_too_large');
  });

  it('derives must_not_flag from a dismissed finding', async () => {
    let inserted: EvalCaseInsert | undefined;
    const svc = service({
      findings: derivationSource(sourceFinding({ acceptedAt: null, dismissedAt: DECIDED_AT })),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 0,
        listCaseAnchors: async () => [],
        insertCase: async (values) => {
          inserted = values;
          return evalCase();
        },
      },
    });

    await svc.createCaseFromFinding(WS, { finding_id: 'finding-1' });
    expect(inserted?.expectation).toBe('must_not_flag');
  });

  it('refuses review_has_no_agent, and writes nothing', async () => {
    // The seeded review really carries agent_id: null — 40 reviews, 39 with an
    // agent — so this is the shape of a real row, not a hypothetical.
    const svc = service({
      findings: derivationSource(sourceFinding(), null),
      store: {},
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('review_has_no_agent');
    expect(err.code).toBe('review_has_no_agent');
    expect(err.statusCode).toBe(422);
    // `insertCase` is unreachable in this fake: had a row been written, the test
    // would have failed naming it.
  });

  it('refuses finding_has_no_decision on an undecided finding', async () => {
    const svc = service({
      findings: derivationSource(sourceFinding({ acceptedAt: null, dismissedAt: null })),
      store: {},
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('finding_has_no_decision');
    expect(err.statusCode).toBe(422);
  });

  it('answers 409 with the existing case id for a duplicate source finding', async () => {
    const svc = service({
      findings: derivationSource(),
      store: {
        findCaseBySourceFinding: async () => ({ id: 'case-7', name: 'src/a.ts:2-8' }),
      },
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('duplicate_source_finding');
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ case_id: 'case-7', case_name: 'src/a.ts:2-8' });
  });

  it('refuses case_limit_reached AT the limit, not one past it', async () => {
    const svc = service({
      findings: derivationSource(),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => CASE_LIMIT,
      },
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('case_limit_reached');
    expect(err.statusCode).toBe(422);
  });

  it('refuses conflicting_anchor and names the case it conflicts with', async () => {
    // AC-10's own examples, on the finding's file: :72-75 and :70-73 conflict
    // with a derived :72-75, and :80-84 in the same file does not.
    const overlapping = service({
      findings: derivationSource(sourceFinding({ startLine: 72, endLine: 75 })),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 1,
        listCaseAnchors: async () => [
          {
            caseId: 'case-9',
            caseName: 'do not flag the logger',
            expectation: 'must_not_flag',
            anchors: [{ file: 'src/adapters/webhooks.ts', low_line: 70, high_line: 73 }],
          },
        ],
      },
    });

    const err = await refusalOf(overlapping.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('conflicting_anchor');
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('do not flag the logger');
    expect(err.details).toEqual({ case_id: 'case-9', case_name: 'do not flag the logger' });
  });

  it('allows a non-overlapping anchor on the same file, and an overlap of the SAME expectation', async () => {
    const inserts: EvalCaseInsert[] = [];
    const shared = {
      findCaseBySourceFinding: async () => undefined,
      countCases: async () => 1,
      insertCase: async (values: EvalCaseInsert) => {
        inserts.push(values);
        return evalCase();
      },
    };

    // :80-84 does not overlap :72-75 — a different place in the same file.
    await service({
      findings: derivationSource(sourceFinding({ startLine: 72, endLine: 75 })),
      store: {
        ...shared,
        listCaseAnchors: async () => [
          {
            caseId: 'case-9',
            caseName: 'elsewhere',
            expectation: 'must_not_flag',
            anchors: [{ file: 'src/adapters/webhooks.ts', low_line: 80, high_line: 84 }],
          },
        ],
      },
    }).createCaseFromFinding(WS, { finding_id: 'finding-1' });

    // The SAME expectation overlapping is redundant, not contradictory.
    await service({
      findings: derivationSource(sourceFinding({ startLine: 72, endLine: 75 })),
      store: {
        ...shared,
        listCaseAnchors: async () => [
          {
            caseId: 'case-9',
            caseName: 'same claim',
            expectation: 'must_find',
            anchors: [{ file: 'src/adapters/webhooks.ts', low_line: 70, high_line: 73 }],
          },
        ],
      },
    }).createCaseFromFinding(WS, { finding_id: 'finding-1' });

    expect(inserts).toHaveLength(2);
  });

  it('refuses diff_too_large above the byte budget', async () => {
    const svc = service({
      findings: derivationSource(sourceFinding(), AGENT, 'x'.repeat(DIFF_MAX_BYTES + 1)),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 1,
        listCaseAnchors: async () => [],
      },
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('diff_too_large');
    expect(err.statusCode).toBe(422);
  });

  it('refuses anchor_not_in_diff when the PR carries no patch for that file', async () => {
    const svc = service({
      findings: derivationSource(sourceFinding(), AGENT, null),
      store: {
        findCaseBySourceFinding: async () => undefined,
        countCases: async () => 1,
        listCaseAnchors: async () => [],
      },
    });

    const err = await refusalOf(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' }));
    expect(err.reason).toBe('anchor_not_in_diff');
  });

  it('answers 404 with the service envelope for a finding outside the workspace', async () => {
    // AC-18's observable. `findingContext` is by id alone; the workspace-scoped
    // `getPull` is the authorization check, and a miss must look like "no such
    // finding" rather than like a permission error naming someone else's data.
    const svc = service({
      findings: findings({
        findingContext: async () => context(),
        getPull: async () => undefined,
      }),
      store: {},
    });

    await expect(svc.createCaseFromFinding(WS, { finding_id: 'finding-1' })).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
    });
  });
});

/* ─── saving and deleting ─────────────────────────────────────────────────── */

describe('saveCase', () => {
  const body = {
    name: 'renamed',
    input_diff: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}`,
    expectation: 'must_not_flag' as const,
    expected_anchors: [{ file: 'src/a.ts', low_line: 2, high_line: 8 }],
    expected_output: { note: 'kept' },
  };

  it('persists a must_not_flag case whose anchor names a file in its own diff', async () => {
    let saved: unknown;
    const svc = service({
      store: {
        getCase: async () => evalCase(),
        updateCase: async (_ws, _id, patch) => {
          saved = patch;
          return evalCase({ name: patch.name });
        },
      },
    });

    await svc.saveCase(WS, 'case-1', body);
    expect(saved).toMatchObject({
      name: 'renamed',
      expectation: 'must_not_flag',
      expectedOutput: { note: 'kept' },
    });
  });

  it('refuses anchor_not_in_diff for a must_not_flag anchor off the case diff', async () => {
    // A forbidden anchor on a file the diff does not contain forbids nothing:
    // the case would pass for free in every batch and raise the pass count.
    const svc = service({
      store: { getCase: async () => evalCase() },
    });

    const err = await refusalOf(
      svc.saveCase(WS, 'case-1', {
        ...body,
        expected_anchors: [{ file: 'src/elsewhere.ts', low_line: 1, high_line: 4 }],
      }),
    );
    expect(err.reason).toBe('anchor_not_in_diff');
    expect(err.details).toEqual({ file: 'src/elsewhere.ts' });
  });

  it('saves a must_find anchor off the diff, because that case FAILS rather than lying', async () => {
    let saved: { expectation: string } | undefined;
    const svc = service({
      store: {
        getCase: async () => evalCase(),
        updateCase: async (_ws, _id, patch) => {
          saved = patch;
          return evalCase();
        },
      },
    });

    await svc.saveCase(WS, 'case-1', {
      ...body,
      expectation: 'must_find',
      expected_anchors: [{ file: 'src/elsewhere.ts', low_line: 1, high_line: 4 }],
    });
    expect(saved?.expectation).toBe('must_find');
  });

  it('answers 404 for a case outside the workspace, and writes nothing', async () => {
    const svc = service({ store: { getCase: async () => undefined } });
    await expect(svc.saveCase(WS, 'case-1', body)).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
    });
  });
});

describe('deleteCase', () => {
  it('answers 404 when the delete matched nothing', async () => {
    const svc = service({ store: { deleteCase: async () => false } });
    await expect(svc.deleteCase(WS, 'case-1')).rejects.toBeInstanceOf(AppError);
  });

  it('deletes without touching a single batch row', async () => {
    // AC-17: every stored batch's metrics and counts are unchanged, and the
    // cheapest proof is that no batch method is reachable on this path at all.
    const svc = service({ store: { deleteCase: async () => true } });
    await expect(svc.deleteCase(WS, 'case-1')).resolves.toBeUndefined();
  });
});

/* ─── starting a batch ────────────────────────────────────────────────────── */

describe('startBatch', () => {
  it('snapshots the version, prompt and model once and hands the set to the runner', async () => {
    const runner = recordingRunner();
    const cases = [evalCase(), evalCase({ id: 'case-2' })];
    let pruned: number | undefined;
    const svc = service({
      agents: { getById: async () => agentFacts() },
      runner,
      store: {
        listRunningBatches: async () => [],
        listCases: async () => cases,
        insertBatch: async (values) =>
          batch({
            status: 'running',
            agent_version: values.agentVersion,
            system_prompt_snapshot: values.systemPromptSnapshot,
            model_snapshot: values.modelSnapshot,
          }),
        pruneAgentBatches: async (_ws, _agent, keep) => {
          pruned = keep;
          return 0;
        },
      },
    });

    const started = await svc.startBatch(WS, AGENT);

    // Acknowledged as `running` BEFORE any case executes.
    expect(started.status).toBe('running');
    expect(started.agent_version).toBe(7);
    expect(started.system_prompt_snapshot).toBe('You review pull requests.');
    expect(started.model_snapshot).toBe('gpt-5-mini');
    expect(pruned).toBe(50);
    expect(runner.started).toHaveLength(1);
    expect(runner.started[0]?.cases).toEqual(cases);
    expect(runner.started[0]?.provider).toBe('openai');
  });

  it('refuses batch_already_running while one is genuinely in flight', async () => {
    // One millisecond inside the window: still running, and the runner must not
    // be handed a second batch.
    const fresh = batch({
      id: 'batch-live',
      status: 'running',
      started_at: new Date(NOW.getTime() - BATCH_DEADLINE_MS + 1).toISOString(),
    });
    const svc = service({
      agents: { getById: async () => agentFacts() },
      store: { listRunningBatches: async () => [fresh] },
    });

    const err = await refusalOf(svc.startBatch(WS, AGENT));
    expect(err.reason).toBe('batch_already_running');
  });

  it('closes an orphaned running batch as error and starts the next one', async () => {
    // Exactly ON the deadline: an orphan from a dead process must not block the
    // agent for ever, and it is recorded rather than silently reused.
    const stale = batch({
      id: 'batch-orphan',
      status: 'running',
      started_at: new Date(NOW.getTime() - BATCH_DEADLINE_MS).toISOString(),
    });
    const patches: { id: string; patch: EvalBatchPatch }[] = [];
    const runner = recordingRunner();
    const svc = service({
      agents: { getById: async () => agentFacts() },
      runner,
      store: {
        listRunningBatches: async () => [stale],
        updateBatch: async (_ws, id, patch) => {
          patches.push({ id, patch });
          return stale;
        },
        listCases: async () => [evalCase()],
        insertBatch: async () => batch({ id: 'batch-new', status: 'running' }),
        pruneAgentBatches: async () => 0,
      },
    });

    const started = await svc.startBatch(WS, AGENT);

    expect(started.id).toBe('batch-new');
    expect(patches).toEqual([
      {
        id: 'batch-orphan',
        patch: { status: 'error', error: BATCH_DEADLINE_ERROR, finishedAt: NOW },
      },
    ]);
    expect(runner.started).toHaveLength(1);
  });

  it('runs one named case, and refuses a case id belonging to another agent', async () => {
    const runner = recordingRunner();
    const mine = evalCase({ id: 'case-mine' });
    const svc = service({
      agents: { getById: async () => agentFacts() },
      runner,
      store: {
        listRunningBatches: async () => [],
        // `listCases` stays unreachable: a single-case run must not read the set.
        getCase: async (_ws, id) =>
          id === 'case-mine' ? mine : evalCase({ id, owner_id: 'agent-other' }),
        insertBatch: async () => batch({ status: 'running' }),
        pruneAgentBatches: async () => 0,
      },
    });

    await svc.startBatch(WS, AGENT, { caseId: 'case-mine' });
    expect(runner.started[0]?.cases).toEqual([mine]);

    await expect(svc.startBatch(WS, AGENT, { caseId: 'case-theirs' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('answers 404 for an agent outside the workspace, before reading anything else', async () => {
    const svc = service({ agents: { getById: async () => undefined }, store: {} });
    await expect(svc.startBatch(WS, AGENT)).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
    });
    await expect(svc.listCases(WS, AGENT)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.listBatches(WS, AGENT, '30d')).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.agentDashboard(WS, AGENT, '30d')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

/* ─── comparing two batches ───────────────────────────────────────────────── */

describe('compare', () => {
  function comparing(a: EvalBatch, b: EvalBatch): EvalService {
    return service({
      store: { getBatch: async (_ws, id) => (id === a.id ? a : b) },
    });
  }

  it('reads earlier → later → signed change, whichever order the ids arrive in', async () => {
    const earlier = batch({ id: 'b-old', started_at: '2026-08-01T00:00:00.000Z', recall: 0.4 });
    const later = batch({ id: 'b-new', started_at: '2026-08-10T00:00:00.000Z', recall: 0.6 });

    for (const [first, second] of [
      ['b-old', 'b-new'],
      ['b-new', 'b-old'],
    ] as const) {
      const result = await comparing(earlier, later).compare(WS, first, second);
      expect(result.earlier_batch_id).toBe('b-old');
      expect(result.later_batch_id).toBe('b-new');
      expect(result.recall.earlier).toBe(0.4);
      expect(result.recall.later).toBe(0.6);
      expect(result.recall.change).toBeCloseTo(0.2, 10);
    }
  });

  it('leaves a change null when either side was not measured', async () => {
    const earlier = batch({ id: 'b-old', started_at: '2026-08-01T00:00:00.000Z', recall: null });
    const later = batch({ id: 'b-new', started_at: '2026-08-10T00:00:00.000Z', recall: 0.6 });

    const result = await comparing(earlier, later).compare(WS, 'b-old', 'b-new');
    // Not a change of +0.6 and not a change of 0: nothing was measured to move.
    expect(result.recall).toEqual({ earlier: null, later: 0.6, change: null });
  });

  it('flags two batches of one agent version as the same configuration', async () => {
    const earlier = batch({ id: 'b-old', started_at: '2026-08-01T00:00:00.000Z' });
    const later = batch({ id: 'b-new', started_at: '2026-08-10T00:00:00.000Z' });
    const same = await comparing(earlier, later).compare(WS, 'b-old', 'b-new');
    expect(same.same_config).toBe(true);
    expect(same.earlier_system_prompt).toBe('v7 prompt');

    const bumped = batch({ id: 'b-new', started_at: '2026-08-10T00:00:00.000Z', agent_version: 8 });
    const differing = await comparing(earlier, bumped).compare(WS, 'b-old', 'b-new');
    expect(differing.same_config).toBe(false);
  });

  it('refuses cross_agent_compare, including two batches whose agents are both gone', async () => {
    const mine = batch({ id: 'b-mine', agent_id: 'agent-a' });
    const theirs = batch({ id: 'b-theirs', agent_id: 'agent-b' });
    expect((await refusalOf(comparing(mine, theirs).compare(WS, 'b-mine', 'b-theirs'))).reason).toBe(
      'cross_agent_compare',
    );

    // Both agents deleted: nothing left in either row proves they were the same
    // agent's, so the comparison is a claim the data cannot support.
    const orphanA = batch({ id: 'b-mine', agent_id: null });
    const orphanB = batch({ id: 'b-theirs', agent_id: null });
    expect(
      (await refusalOf(comparing(orphanA, orphanB).compare(WS, 'b-mine', 'b-theirs'))).reason,
    ).toBe('cross_agent_compare');
  });

  it('answers 404 for a batch outside the workspace', async () => {
    const svc = service({ store: { getBatch: async () => undefined } });
    await expect(svc.compare(WS, 'a', 'b')).rejects.toMatchObject({ code: 'not_found' });
  });
});

/* ─── dashboards ──────────────────────────────────────────────────────────── */

describe('agentDashboard', () => {
  it('reads the most recent COMPLETED batch, a chronological trend and the regression alert', async () => {
    const older = batch({
      id: 'b-1',
      started_at: '2026-08-01T00:00:00.000Z',
      recall: 0.8,
      precision: 0.6,
      citation_accuracy: 0.9,
    });
    const newer = batch({
      id: 'b-2',
      started_at: '2026-08-10T00:00:00.000Z',
      recall: 0.5,
      precision: 0.7,
      citation_accuracy: 0.9,
    });
    const inFlight = batch({
      id: 'b-3',
      status: 'running',
      started_at: '2026-08-11T00:00:00.000Z',
      recall: null,
      cases_covered: null,
      cases_passed: null,
    });

    const svc = service({
      agents: { getById: async () => agentFacts() },
      store: {
        // newest first, as the repository returns it
        listAgentBatches: async () => [inFlight, newer, older],
        countCases: async () => 6,
      },
    });

    const row = await svc.agentDashboard(WS, AGENT, '30d');

    expect(row.agent_name).toBe('General Reviewer');
    expect(row.model).toBe('gpt-5-mini');
    expect(row.cases_total).toBe(6);
    // The running batch carries no numbers, so it is not the "last batch" and
    // draws no hole in the trend.
    expect(row.last_batch?.batch_id).toBe('b-2');
    expect(row.trend.map((p) => p.batch_id)).toEqual(['b-1', 'b-2']);
    expect(row.trend[0]?.pass_rate).toBe(0.5);
    // Recall fell 0.3 and precision rose 0.1 — the alert names the fall, and the
    // client owns the unit it renders the change in.
    expect(row.alert?.metric).toBe('recall');
    expect(row.alert?.change).toBeCloseTo(-0.3, 10);
  });

  it('reports an agent with no completed batch as null metrics and an empty trend', async () => {
    const svc = service({
      agents: { getById: async () => agentFacts() },
      store: { listAgentBatches: async () => [], countCases: async () => 0 },
    });

    const row = await svc.agentDashboard(WS, AGENT, '30d');
    expect(row.last_batch).toBeNull();
    expect(row.trend).toEqual([]);
    expect(row.alert).toBeNull();
  });
});

describe('workspaceDashboard', () => {
  it('keeps two agent-deleted batches as two rows, not one collapsed bucket', async () => {
    // `eval_batches.agent_id` is nullable with ON DELETE SET NULL. A map keyed on
    // the raw value puts every agent-deleted row in ONE bucket, and anything
    // summed per bucket then drops all but one of them with no error at all.
    const orphanOne = batch({
      id: 'b-orphan-1',
      agent_id: null,
      agent_name: null,
      model_snapshot: 'gpt-4o',
      cost_usd: 0.001,
      started_at: '2026-08-05T00:00:00.000Z',
    });
    const orphanTwo = batch({
      id: 'b-orphan-2',
      agent_id: null,
      agent_name: null,
      model_snapshot: 'claude-sonnet',
      cost_usd: 0.002,
      started_at: '2026-08-06T00:00:00.000Z',
    });
    const mine = batch({ id: 'b-mine', started_at: '2026-08-07T00:00:00.000Z' });

    const svc = service({
      agents: { list: async () => [agentFacts()] },
      store: {
        listWorkspaceBatches: async () => [mine, orphanTwo, orphanOne],
        countCasesByOwner: async () => [{ ownerId: AGENT, count: 4 }],
      },
    });

    const dashboard = await svc.workspaceDashboard(WS, '30d');

    expect(dashboard.period).toBe('30d');
    expect(dashboard.rows).toHaveLength(3);
    expect(dashboard.rows[0]?.agent_id).toBe(AGENT);
    expect(dashboard.rows[0]?.cases_total).toBe(4);

    const orphans = dashboard.rows.filter((r) => r.agent_id === null);
    expect(orphans).toHaveLength(2);
    // Each keeps its own model snapshot and its own batch — the tell that the
    // fallback key held.
    expect(orphans.map((r) => r.model).sort()).toEqual(['claude-sonnet', 'gpt-4o']);
    expect(orphans.map((r) => r.last_batch?.batch_id).sort()).toEqual([
      'b-orphan-1',
      'b-orphan-2',
    ]);

    // The cross-agent recent list carries every batch, newest first.
    expect(dashboard.recent_batches.map((b) => b.id)).toEqual([
      'b-mine',
      'b-orphan-2',
      'b-orphan-1',
    ]);
  });

  it('lists an agent that has never run, with null metrics and no trend', async () => {
    const svc = service({
      agents: { list: async () => [agentFacts(), agentFacts({ id: 'agent-2', name: 'Security' })] },
      store: {
        listWorkspaceBatches: async () => [batch()],
        countCasesByOwner: async () => [{ ownerId: AGENT, count: 2 }],
      },
    });

    const dashboard = await svc.workspaceDashboard(WS, '30d');
    const quiet = dashboard.rows.find((r) => r.agent_id === 'agent-2');
    expect(quiet?.last_batch).toBeNull();
    expect(quiet?.trend).toEqual([]);
    expect(quiet?.cases_total).toBe(0);
  });
});

/* ─── run all agents ──────────────────────────────────────────────────────── */

describe('runAllAgents', () => {
  it('names every skip with its reason, and starts one batch per eligible agent', async () => {
    const runner = recordingRunner();
    const svc = service({
      agents: {
        list: async () => [
          agentFacts({ id: 'agent-ready' }),
          agentFacts({ id: 'agent-off', enabled: false }),
          agentFacts({ id: 'agent-empty' }),
        ],
        getById: async (_ws, id) => agentFacts({ id }),
      },
      runner,
      store: {
        countCasesByOwner: async () => [
          { ownerId: 'agent-ready', count: 3 },
          // 'agent-off' is disabled and 'agent-empty' holds nothing: a reader
          // cannot tell those two apart without the reason.
          { ownerId: 'agent-off', count: 3 },
        ],
        listRunningBatches: async () => [],
        listCases: async () => [evalCase()],
        insertBatch: async () => batch({ id: 'b-ready', status: 'running' }),
        pruneAgentBatches: async () => 0,
      },
    });

    const result = await svc.runAllAgents(WS);

    expect(result.created.map((b) => b.id)).toEqual(['b-ready']);
    expect(result.skipped).toEqual([
      { agent_id: 'agent-off', reason: 'agent_disabled' },
      { agent_id: 'agent-empty', reason: 'no_cases' },
    ]);
    expect(runner.started).toHaveLength(1);
  });

  it('returns the in-flight batch for an agent already running one, and starts no second', async () => {
    const live = batch({
      id: 'b-live',
      status: 'running',
      started_at: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const runner = recordingRunner();
    const svc = service({
      agents: {
        list: async () => [agentFacts()],
        getById: async () => agentFacts(),
      },
      runner,
      store: {
        countCasesByOwner: async () => [{ ownerId: AGENT, count: 2 }],
        listRunningBatches: async () => [live],
      },
    });

    const result = await svc.runAllAgents(WS);

    // `insertBatch` is unreachable in this fake — a second row would have failed
    // the test by name. The postcondition holds: exactly one running batch for
    // this agent, and the caller has an id to follow.
    expect(result.created.map((b) => b.id)).toEqual(['b-live']);
    expect(result.skipped).toEqual([]);
    expect(runner.started).toHaveLength(0);
  });
});
