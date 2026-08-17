/**
 * tools.test.ts — hermetic. Every test drives a fake `fetchImpl`, so no socket is
 * opened and no DevDigest API has to be running.
 *
 * What this file is for, and what it deliberately leaves to its neighbours:
 *
 *  - `test/run-agent.test.ts` owns the wait loop (fake timers, the three
 *    statuses, the absence stop). Here `devdigest_run_agent_on_pr` appears only
 *    where it shares something with another tool.
 *  - `test/shape.test.ts` owns the ORDERING and the caps. Here the question is
 *    which of those fields each tool actually emits, and in what shape - a
 *    response is a contract, so the key sets are asserted with `Object.keys`
 *    rather than `toMatchObject`, which would pass on an accidental passthrough.
 *  - `test/budget.test.ts` (T6) owns the token measurements. The `tools/list`
 *    round trip below asserts BEHAVIOUR: that a real client can reach a real
 *    server over `InMemoryTransport`, that the one tool with an `outputSchema`
 *    really returns validated `structuredContent`, and that a failure arrives as
 *    an error result carrying an instruction.
 */
import { describe, expect, it } from 'vitest';
import type {
  Agent,
  ConventionScan,
  ConventionScanBudget,
  ConventionStatus,
  ConventionsPayload,
  ExtractedConvention,
  FindingRecord,
  PrBlastRadius,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  Severity,
  Verdict,
} from '@devdigest/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ApiClient, type FetchLike } from '../src/api/client.js';
import { Resolver } from '../src/resolve.js';
import { createServer } from '../src/server.js';
import { TOOL_DEFS } from '../src/tools/defs.js';
import { MAX_AGENT_DESCRIPTION_CHARS, listAgents } from '../src/tools/list-agents.js';
import { EITHER_OR_MESSAGE, NEVER_REVIEWED_NEXT_STEP, getFindings } from '../src/tools/get-findings.js';
import { getConventions } from '../src/tools/get-conventions.js';
import { getBlastRadius } from '../src/tools/get-blast-radius.js';
import type { RunOrigin, ToolDeps } from '../src/tools/schemas.js';
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_RUN_TIMEOUT_MS } from '../src/config.js';
import { MAX_TOOL_INPUT_FIELDS } from '../src/instructions.js';
import type { LogFields, Logger } from '../src/log.js';

/** Same house rule as `test/errors.test.ts`: a failure names an ACTION. */
const IMPERATIVE =
  /(Start|Wait|Retry|retry|Check|check|Call|call|Open|open|Use|use|Enable|enable|Pick|pick|report|set) /;

const BASE_URL = 'http://localhost:3001';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const REPO: Repo = {
  id: 'repo-1',
  workspace_id: 'ws-1',
  owner: 'acme',
  name: 'payments-api',
  full_name: 'acme/payments-api',
  default_branch: 'main',
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

const PULL: PrMeta = {
  id: 'pr-1',
  number: 482,
  title: 'Add rate limiting',
  author: 'octocat',
  branch: 'feature/rate-limit',
  base: 'main',
  head_sha: 'sha-482',
  additions: 120,
  deletions: 8,
  files_count: 4,
  status: 'needs_review',
};

function agentRow(input: {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
}): Agent {
  return {
    id: input.id,
    name: input.name,
    description: input.description ?? 'Reviews for security problems',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    // Thousands of tokens, and the one field that must never leave this process.
    system_prompt: 'You are a reviewer. '.repeat(200),
    enabled: input.enabled ?? true,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
  };
}

function findingRow(input: {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly file?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly confidence?: number;
  readonly suggestion?: string | null;
  readonly dismissed?: boolean;
}): FindingRecord {
  return {
    id: input.id,
    review_id: 'review-1',
    severity: input.severity,
    category: 'security',
    title: input.title,
    file: input.file ?? 'src/api/users.ts',
    start_line: input.startLine ?? 13,
    end_line: input.endLine ?? input.startLine ?? 13,
    rationale: `Why ${input.title} matters.`,
    suggestion: input.suggestion === undefined ? 'Bind the parameter instead.' : input.suggestion,
    confidence: input.confidence ?? 0.9,
    accepted_at: null,
    dismissed_at: input.dismissed === true ? '2026-08-13T10:00:00.000Z' : null,
  };
}

function reviewRow(input: {
  readonly id: string;
  readonly agentId: string | null;
  readonly agentName?: string;
  readonly runId?: string | null;
  readonly kind?: 'review' | 'summary';
  readonly verdict?: Verdict | null;
  readonly score?: number | null;
  readonly createdAt?: string;
  readonly summary?: string | null;
  readonly findings?: readonly FindingRecord[];
}): ReviewRecord {
  return {
    id: input.id,
    pr_id: 'pr-1',
    agent_id: input.agentId,
    run_id: input.runId ?? null,
    agent_name: input.agentName ?? 'Security Reviewer',
    kind: input.kind ?? 'review',
    verdict: input.verdict ?? 'request_changes',
    summary: input.summary === undefined ? 'Two problems worth fixing.' : input.summary,
    score: input.score ?? 42,
    model: 'gpt-4.1-mini',
    grounding: 'ok',
    created_at: input.createdAt ?? '2026-08-13T10:00:00.000Z',
    findings: [...(input.findings ?? [])],
  };
}

const SCAN: ConventionScan = {
  id: 'scan-1',
  status: 'done',
  commit_sha: 'abc123',
  eligible_files: 26,
  sampled_files: 26,
  proposed: 12,
  dropped_unverified: 4,
  dropped_low_adherence: 3,
  kept: 3,
  cost_usd: 0.0031,
  started_at: '2026-08-13T09:59:00.000Z',
  finished_at: '2026-08-13T10:00:00.000Z',
  error: null,
};

const BUDGET: ConventionScanBudget = {
  indexed_files: 300,
  eligible_files: 26,
  planned_sample: 26,
  planned_tokens: 41_000,
  planned_calls: 10,
  estimated_cost_usd: 0.004,
  capped_by: null,
  can_scan: true,
  blocked_reason: null,
};

function conventionRow(input: {
  readonly id: string;
  readonly rule: string;
  readonly confidence: number;
  readonly status?: ConventionStatus;
}): ExtractedConvention {
  return {
    id: input.id,
    category: 'imports',
    rule: input.rule,
    rationale: 'Relative imports carry the extension in this package.',
    evidence: [
      {
        path: 'src/modules/agents/service.ts',
        start_line: 13,
        end_line: 19,
        snippet: "import { toAgentDto } from './helpers.js';",
        match: 'exact',
      },
    ],
    confidence: input.confidence,
    adherence: { conforming: 62, violating: 2 },
    status: input.status ?? 'pending',
    edited: false,
    skill_id: null,
    created_at: '2026-08-13T10:00:00.000Z',
  };
}

function conventionsPayload(input: {
  readonly scan: ConventionScan | null;
  readonly candidates: readonly ExtractedConvention[];
}): ConventionsPayload {
  return {
    scan: input.scan,
    budget: BUDGET,
    candidates: [...input.candidates],
    repo: { full_name: 'acme/payments-api', sha: 'abc123' },
  };
}

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

function silentLogger(): Logger {
  const drop = (_message: string, _fields?: LogFields): void => undefined;
  return { error: drop, warn: drop, info: drop, debug: drop };
}

interface FakeApi {
  readonly repos?: () => Response;
  readonly pulls?: () => Response;
  readonly agents?: () => Response;
  readonly reviews?: () => Response;
  readonly conventions?: () => Response;
  readonly blast?: () => Response;
  /** `GET /pulls/:id` — the blast tool calls it for its WRITE (it backfills pr_files). */
  readonly pullDetail?: () => Response;
}

interface Harness {
  readonly deps: ToolDeps;
  readonly paths: string[];
}

/**
 * Tool dependencies over a fake API, plus the exact sequence of request paths.
 *
 * `paths` is asserted with `toEqual` wherever a tool's request COUNT is part of
 * its contract - `get_blast_radius` must make no call beyond resolving its
 * arguments, and `list_agents` must not be served from the resolver's cache.
 */
function harness(api: FakeApi, runOrigins: readonly [string, RunOrigin][] = []): Harness {
  const paths: string[] = [];
  const logger = silentLogger();

  const fetchImpl: FetchLike = (url) => {
    const path = new URL(url).pathname;
    paths.push(path);

    if (path === '/repos' && api.repos !== undefined) return Promise.resolve(api.repos());
    if (/^\/repos\/[^/]+\/pulls$/.test(path) && api.pulls !== undefined) {
      return Promise.resolve(api.pulls());
    }
    if (path === '/agents' && api.agents !== undefined) return Promise.resolve(api.agents());
    if (/^\/pulls\/[^/]+\/reviews$/.test(path) && api.reviews !== undefined) {
      return Promise.resolve(api.reviews());
    }
    if (/^\/repos\/[^/]+\/conventions$/.test(path) && api.conventions !== undefined) {
      return Promise.resolve(api.conventions());
    }
    if (/^\/pulls\/[^/]+\/blast$/.test(path) && api.blast !== undefined) {
      return Promise.resolve(api.blast());
    }
    if (/^\/pulls\/[^/]+$/.test(path) && api.pullDetail !== undefined) {
      return Promise.resolve(api.pullDetail());
    }
    return Promise.resolve(errorResponse(404, 'not_found', `no fake route for ${path}`));
  };

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl, logger });
  const deps: ToolDeps = {
    client,
    resolver: new Resolver({ client, logger }),
    config: {
      apiUrl: BASE_URL,
      runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      logLevel: 'error',
    },
    logger,
    runOrigins: new Map(runOrigins),
  };
  return { deps, paths };
}

/** Addressing routes every tool that takes `repo`/`pr` needs. */
function addressable(): FakeApi {
  return { repos: () => json([REPO]), pulls: () => json([PULL]) };
}

/** The payload of an outcome that must have succeeded. */
function payloadOf(outcome: { readonly ok: boolean }): Record<string, unknown> {
  expect(outcome.ok).toBe(true);
  if (!('payload' in outcome)) throw new Error('outcome carries no payload');
  const payload = outcome.payload;
  expect(typeof payload).toBe('object');
  return payload as Record<string, unknown>;
}

/** The instruction of an outcome that must have failed. */
function instructionOf(outcome: { readonly ok: boolean }): string {
  expect(outcome.ok).toBe(false);
  if (!('instruction' in outcome)) throw new Error('outcome carries no instruction');
  return String(outcome.instruction);
}

// --------------------------------------------------------------------------
// The tool table itself
// --------------------------------------------------------------------------

describe('TOOL_DEFS', () => {
  it('is exactly five devdigest_* tools', () => {
    expect(TOOL_DEFS).toHaveLength(5);
    expect(TOOL_DEFS.map((def) => def.name)).toEqual([
      'devdigest_list_agents',
      'devdigest_run_agent_on_pr',
      'devdigest_get_findings',
      'devdigest_get_conventions',
      'devdigest_get_blast_radius',
    ]);
    for (const def of TOOL_DEFS) expect(def.name.startsWith('devdigest_')).toBe(true);
  });

  it('marks four tools read-only and only run_agent_on_pr as a writer', () => {
    const readOnly = TOOL_DEFS.filter((def) => def.annotations.readOnlyHint === true);
    const writers = TOOL_DEFS.filter((def) => def.annotations.readOnlyHint === false);

    expect(readOnly).toHaveLength(4);
    expect(writers.map((def) => def.name)).toEqual(['devdigest_run_agent_on_pr']);

    // The writer is the only non-idempotent, open-world tool: it calls an LLM, so
    // two calls are two runs and two bills. It destroys nothing.
    const writer = writers[0];
    expect(writer?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    for (const def of readOnly) {
      expect(def.annotations.idempotentHint).toBe(true);
      expect(def.annotations.openWorldHint).toBe(false);
    }
  });

  it('gives an outputSchema to devdigest_list_agents and to nothing else', () => {
    const withOutput = TOOL_DEFS.filter((def) => def.outputSchema !== undefined);
    expect(withOutput.map((def) => def.name)).toEqual(['devdigest_list_agents']);
  });

  it('keeps every input schema flat, small and described', () => {
    for (const def of TOOL_DEFS) {
      const fields = Object.entries(def.inputSchema);
      expect(fields.length, `${def.name} has too many fields`).toBeLessThanOrEqual(
        MAX_TOOL_INPUT_FIELDS,
      );

      for (const [field, schema] of fields) {
        // A field the model cannot read the meaning of is a field it will fill in
        // wrongly: `.describe()` is the only place that meaning travels.
        expect(schema.description, `${def.name}.${field} has no description`).toBeTruthy();
        expect((schema.description ?? '').length).toBeGreaterThan(10);

        // Flat: no object and no array inside a field.
        const json = JSON.stringify(schema._def.typeName ?? '');
        expect(json, `${def.name}.${field} is not a primitive`).not.toContain('ZodObject');
        expect(json, `${def.name}.${field} is not a primitive`).not.toContain('ZodArray');
      }
    }
  });
});

// --------------------------------------------------------------------------
// devdigest_list_agents
// --------------------------------------------------------------------------

describe('devdigest_list_agents', () => {
  it('returns id, name, model and enabled - and never the system prompt', async () => {
    const { deps, paths } = harness({
      agents: () =>
        json([
          agentRow({ id: 'agent-z', name: 'Zed Reviewer' }),
          agentRow({ id: 'agent-a', name: 'Architecture', enabled: false }),
        ]),
    });

    const payload = payloadOf(await listAgents({}, deps));

    expect(payload.count).toBe(2);
    expect(Object.keys(payload)).toEqual(['count', 'agents']);

    const agents = payload.agents as Record<string, unknown>[];
    // Ordered by name, so the same workspace always reads the same way.
    expect(agents.map((agent) => agent.name)).toEqual(['Architecture', 'Zed Reviewer']);
    expect(Object.keys(agents[0] ?? {})).toEqual([
      'id',
      'name',
      'description',
      'model',
      'enabled',
    ]);
    expect(agents[0]?.enabled).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('You are a reviewer');

    expect(paths).toEqual(['/agents']);
  });

  it('caps a long description', async () => {
    const { deps } = harness({
      agents: () => json([agentRow({ id: 'agent-1', name: 'A', description: 'x'.repeat(400) })]),
    });

    const payload = payloadOf(await listAgents({}, deps));
    const agents = payload.agents as { description: string }[];

    expect(agents[0]?.description).toHaveLength(MAX_AGENT_DESCRIPTION_CHARS);
    expect(agents[0]?.description.endsWith('...')).toBe(true);
  });

  it('re-reads GET /agents on every call, rather than the resolver cache', async () => {
    let generation = 0;
    const { deps, paths } = harness({
      agents: () => {
        generation += 1;
        return json(
          generation === 1
            ? [agentRow({ id: 'agent-1', name: 'First' })]
            : [agentRow({ id: 'agent-1', name: 'First' }), agentRow({ id: 'agent-2', name: 'Second' })],
        );
      },
    });

    expect(payloadOf(await listAgents({}, deps)).count).toBe(1);
    // The resolver memoises this list for the life of the process, which is right
    // for explaining a bad id and wrong here: this tool's contract is "the agents
    // that exist now", so an agent added mid-session has to appear.
    expect(payloadOf(await listAgents({}, deps)).count).toBe(2);
    expect(paths).toEqual(['/agents', '/agents']);
  });

  it('turns an empty list into an instruction rather than a bare zero', async () => {
    const { deps } = harness({ agents: () => json([]) });

    const payload = payloadOf(await listAgents({}, deps));

    expect(payload.count).toBe(0);
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
    expect(String(payload.next_step)).toContain('Agents screen');
  });

  it('answers an unreachable API with the instruction, not an error code', async () => {
    const { deps } = harness({ agents: () => errorResponse(500, 'internal_error', 'Internal') });

    const instruction = instructionOf(await listAgents({}, deps));

    expect(instruction).toMatch(IMPERATIVE);
    expect(instruction).not.toMatch(/^[A-Z_]+$/);
  });
});

// --------------------------------------------------------------------------
// devdigest_get_findings
// --------------------------------------------------------------------------

describe('devdigest_get_findings', () => {
  const FINDINGS: readonly FindingRecord[] = [
    findingRow({ id: 'f-2', severity: 'WARNING', title: 'Unbounded query' }),
    findingRow({
      id: 'f-1',
      severity: 'CRITICAL',
      title: 'SQL injection',
      startLine: 13,
      endLine: 19,
    }),
    findingRow({ id: 'f-3', severity: 'SUGGESTION', title: 'Rename helper', suggestion: null }),
    findingRow({ id: 'f-4', severity: 'CRITICAL', title: 'Dismissed one', dismissed: true }),
  ];

  function reviewedApi(): FakeApi {
    return {
      ...addressable(),
      reviews: () =>
        json([
          reviewRow({
            id: 'review-1',
            agentId: 'agent-1',
            runId: 'run-1',
            findings: FINDINGS,
            score: 42,
            verdict: 'request_changes',
          }),
          reviewRow({
            id: 'review-2',
            agentId: 'agent-2',
            agentName: 'Style',
            runId: 'run-2',
            verdict: 'approve',
            score: 88,
            findings: [findingRow({ id: 'f-5', severity: 'SUGGESTION', title: 'Style nit' })],
          }),
          // A summary row: `reviewsForPull` does NOT filter kind, and folding one
          // in would double-count the pull request.
          reviewRow({
            id: 'review-3',
            agentId: 'agent-1',
            kind: 'summary',
            verdict: 'approve',
            score: 99,
            createdAt: '2026-08-13T11:00:00.000Z',
          }),
        ]),
    };
  }

  it('aggregates the worst verdict and the lowest score over one review per agent', async () => {
    const { deps } = harness(reviewedApi());

    const payload = payloadOf(await getFindings({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect(payload.reviewed).toBe(true);
    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.pr).toBe(482);
    // Worst verdict, lowest score - the basis PrMeta.score documents, so this
    // number equals what the studio shows. The kind:'summary' row (99, approve)
    // is excluded.
    expect(payload.verdict).toBe('request_changes');
    expect(payload.score).toBe(42);
    expect(payload.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 2 });
    expect(payload.total).toBe(4);

    const agents = payload.agents as { name: string; summary?: string }[];
    expect(agents.map((agent) => agent.name)).toEqual(['Security Reviewer', 'Style']);
    expect(agents[0]?.summary).toBe('Two problems worth fixing.');
  });

  it('emits concise findings as severity, title, file:line and rationale', async () => {
    const { deps } = harness(reviewedApi());

    const payload = payloadOf(await getFindings({ repo: 'acme/payments-api', pr: 482 }, deps));
    const findings = payload.findings as Record<string, unknown>[];

    // Worst first, and the dismissed CRITICAL is gone rather than labelled.
    expect(findings.map((finding) => finding.title)).toEqual([
      'SQL injection',
      'Unbounded query',
      'Rename helper',
      'Style nit',
    ]);
    expect(Object.keys(findings[0] ?? {})).toEqual(['severity', 'title', 'file', 'rationale']);
    // `file` carries the line reference, which is the published contract shape.
    expect(findings[0]?.file).toBe('src/api/users.ts:13-19');
    expect(findings[1]?.file).toBe('src/api/users.ts:13');
  });

  it('adds category, confidence and suggestion in detailed, and no extra rows', async () => {
    const { deps } = harness(reviewedApi());

    const concise = payloadOf(await getFindings({ repo: 'acme/payments-api', pr: 482 }, deps));
    const detailed = payloadOf(
      await getFindings(
        { repo: 'acme/payments-api', pr: 482, response_format: 'detailed' },
        deps,
      ),
    );

    const detailedFindings = detailed.findings as Record<string, unknown>[];
    expect(Object.keys(detailedFindings[0] ?? {})).toEqual([
      'severity',
      'category',
      'title',
      'file',
      'confidence',
      'rationale',
      'suggestion',
    ]);
    // A finding with no suggestion carries no empty key for it.
    const nit = detailedFindings.find((finding) => finding.title === 'Rename helper');
    expect(nit === undefined ? [] : Object.keys(nit)).not.toContain('suggestion');

    // The two formats differ in SIZE, never in which rows come back.
    expect((concise.findings as unknown[]).length).toBe(detailedFindings.length);
  });

  it('pages with offset/limit and reports counts over the whole review, not the page', async () => {
    const { deps } = harness(reviewedApi());

    const payload = payloadOf(
      await getFindings({ repo: 'acme/payments-api', pr: 482, offset: 1, limit: 2 }, deps),
    );

    expect(payload.total).toBe(4);
    expect(payload.offset).toBe(1);
    expect(payload.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 2 });
    expect((payload.findings as unknown[]).length).toBe(2);
    // The notice names the exact offset to pass next, not just the fact of a cap.
    expect(String(payload.truncated)).toContain('offset 3');
    expect(String(payload.truncated)).toMatch(IMPERATIVE);
  });

  it('answers a never-reviewed pull request with reviewed:false and the next step', async () => {
    const { deps } = harness({ ...addressable(), reviews: () => json([]) });

    const payload = payloadOf(await getFindings({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect(Object.keys(payload)).toEqual(['reviewed', 'repo', 'pr', 'findings', 'next_step']);
    expect(payload.reviewed).toBe(false);
    expect(payload.findings).toEqual([]);
    expect(payload.next_step).toBe(NEVER_REVIEWED_NEXT_STEP);
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
  });

  it('names BOTH addressing paths when neither is complete', async () => {
    const { deps, paths } = harness(reviewedApi());

    for (const args of [{}, { repo: 'acme/payments-api' }, { pr: 482 }]) {
      const instruction = instructionOf(await getFindings(args, deps));
      expect(instruction).toBe(EITHER_OR_MESSAGE);
      // Both paths, by name - never "invalid input".
      expect(instruction).toContain('run_id');
      expect(instruction).toContain('repo');
      expect(instruction).toContain('pr');
      expect(instruction).toMatch(IMPERATIVE);
    }
    // Rejected before any request is made.
    expect(paths).toEqual([]);
  });

  it('reads one run by id from the runs this server started', async () => {
    const origin: RunOrigin = {
      prId: 'pr-1',
      repo: 'acme/payments-api',
      pr: 482,
      agentName: 'Security Reviewer',
    };
    const { deps, paths } = harness(reviewedApi(), [['run-2', origin]]);

    const payload = payloadOf(await getFindings({ run_id: 'run-2' }, deps));

    expect(payload.reviewed).toBe(true);
    expect(payload.run_id).toBe('run-2');
    // One run means one agent: no reduction, and the other agent's findings stay
    // out of the answer.
    expect(payload.verdict).toBe('approve');
    expect(payload.total).toBe(1);
    expect((payload.agents as { name: string }[]).map((agent) => agent.name)).toEqual(['Style']);
    // The run id resolves with no repository or pull-request lookup at all.
    expect(paths).toEqual(['/pulls/pr-1/reviews']);
  });

  it('sends a run id it never issued to the repo + pr path', async () => {
    const { deps, paths } = harness(reviewedApi());

    const instruction = instructionOf(await getFindings({ run_id: 'run-from-last-week' }, deps));

    expect(instruction).toContain('run-from-last-week');
    expect(instruction).toContain('repo');
    expect(instruction).toContain('pr');
    expect(instruction).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('reports a known run with no review row as reviewed:false, not as an error', async () => {
    const origin: RunOrigin = {
      prId: 'pr-1',
      repo: 'acme/payments-api',
      pr: 482,
      agentName: 'Security Reviewer',
    };
    const { deps } = harness({ ...addressable(), reviews: () => json([]) }, [['run-9', origin]]);

    const payload = payloadOf(await getFindings({ run_id: 'run-9' }, deps));

    expect(payload.reviewed).toBe(false);
    expect(payload.findings).toEqual([]);
    expect(String(payload.next_step)).toContain('run-9');
    expect(String(payload.next_step)).toMatch(IMPERATIVE);
  });

  it('passes a mistyped repository through as the resolver instruction', async () => {
    const { deps } = harness(reviewedApi());

    const instruction = instructionOf(await getFindings({ repo: 'acme/nope', pr: 482 }, deps));

    expect(instruction).toContain('acme/payments-api');
    expect(instruction).toMatch(IMPERATIVE);
  });
});

// --------------------------------------------------------------------------
// devdigest_get_conventions
// --------------------------------------------------------------------------

describe('devdigest_get_findings — the pr_id path', () => {
  const PR_UUID = '11111111-1111-4111-8111-111111111111';

  it('reads the latest review per agent, addressed by uuid', async () => {
    const { deps } = harness({
      ...addressable(),
      pullDetail: () => json({ ...PULL, body: null, files: [], commits: [] }),
      reviews: () =>
        json([
          reviewRow({
            id: 'rev-1',
            agentId: 'a1',
            findings: [findingRow({ id: 'f1', severity: 'CRITICAL', title: 'SQL injection' })],
          }),
        ]),
    });

    const payload = payloadOf(await getFindings({ pr_id: PR_UUID }, deps));

    expect(payload.reviewed).toBe(true);
    expect(payload.pr).toBe(482);
  });

  it('names the three accepted address forms when given none', async () => {
    const { deps, paths } = harness(addressable());
    const instruction = instructionOf(await getFindings({}, deps));
    expect(instruction).toContain('run_id');
    expect(instruction).toContain('pr_id');
    expect(instruction).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('lets run_id win over pr_id, the more specific address', async () => {
    const { deps, paths } = harness(
      { ...addressable(), reviews: () => json([]) },
      [['run-1', { prId: 'pr-1', repo: 'acme/payments-api', pr: 482, agentName: 'Reviewer' }]],
    );
    await getFindings({ run_id: 'run-1', pr_id: PR_UUID }, deps);
    // The run_id path reads reviews for its remembered pull request and never
    // touches `GET /pulls/:id`.
    expect(paths).not.toContain(`/pulls/${PR_UUID}`);
  });
});

describe('devdigest_get_conventions', () => {
  const CANDIDATES: readonly ExtractedConvention[] = [
    conventionRow({ id: 'c-1', rule: 'Pending high', confidence: 0.9 }),
    conventionRow({ id: 'c-2', rule: 'Accepted low', confidence: 0.5, status: 'accepted' }),
    conventionRow({ id: 'c-3', rule: 'Rejected', confidence: 0.99, status: 'rejected' }),
  ];

  it('returns every candidate with accepted, accepted first, and no scan envelope', async () => {
    const { deps } = harness({
      ...addressable(),
      conventions: () => json(conventionsPayload({ scan: SCAN, candidates: CANDIDATES })),
    });

    const payload = payloadOf(await getConventions({ repo: 'acme/payments-api' }, deps));

    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.scanned).toBe(true);
    expect(payload.count).toBe(3);
    expect(payload.accepted_count).toBe(1);

    const conventions = payload.conventions as Record<string, unknown>[];
    // All candidates, not only the accepted ones - and accepted sort up.
    expect(conventions.map((convention) => convention.rule)).toEqual([
      'Accepted low',
      'Pending high',
      'Rejected',
    ]);
    expect(conventions[0]?.accepted).toBe(true);
    expect(conventions[1]?.accepted).toBe(false);

    // No `scan` / `budget` envelope, and no evidence in concise: those two are the
    // biggest token sinks in this payload.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('planned_tokens');
    expect(serialised).not.toContain('dropped_low_adherence');
    expect(serialised).not.toContain('snippet');
    expect(Object.keys(conventions[0] ?? {})).toEqual([
      'rule',
      'category',
      'file',
      'lines',
      'confidence',
      'accepted',
    ]);
  });

  it('adds the evidence snippet only in detailed', async () => {
    const { deps } = harness({
      ...addressable(),
      conventions: () => json(conventionsPayload({ scan: SCAN, candidates: CANDIDATES })),
    });

    const payload = payloadOf(
      await getConventions({ repo: 'acme/payments-api', response_format: 'detailed' }, deps),
    );

    expect(JSON.stringify(payload)).toContain('toAgentDto');
  });

  it('tells the two empty cases apart', async () => {
    const never = harness({
      ...addressable(),
      conventions: () => json(conventionsPayload({ scan: null, candidates: [] })),
    });
    const scanned = harness({
      ...addressable(),
      conventions: () => json(conventionsPayload({ scan: SCAN, candidates: [] })),
    });

    const neverPayload = payloadOf(await getConventions({ repo: 'acme/payments-api' }, never.deps));
    const scannedPayload = payloadOf(
      await getConventions({ repo: 'acme/payments-api' }, scanned.deps),
    );

    expect(neverPayload.scanned).toBe(false);
    expect(scannedPayload.scanned).toBe(true);
    // Different facts, different instructions: "never measured" versus "measured
    // and kept nothing" call for different actions, and an empty array cannot say
    // which happened.
    expect(neverPayload.next_step).not.toBe(scannedPayload.next_step);
    expect(String(neverPayload.next_step)).toContain('never');
    expect(String(scannedPayload.next_step)).toContain('measurement');
    expect(String(neverPayload.next_step)).toMatch(IMPERATIVE);
    expect(String(scannedPayload.next_step)).toMatch(IMPERATIVE);
  });

  it('accepts repo_id, which is exact where a bare name may not be', async () => {
    const { deps } = harness({
      repos: () =>
        json([REPO, { ...REPO, id: 'repo-2', owner: 'globex', full_name: 'globex/payments-api' }]),
      conventions: () => json(conventionsPayload({ scan: SCAN, candidates: CANDIDATES })),
    });

    // "payments-api" is ambiguous across these two repositories; the uuid is not.
    const payload = payloadOf(await getConventions({ repo_id: 'repo-1' }, deps));

    expect(payload.repo).toBe('acme/payments-api');
  });

  it('explains a repo_id no repository has, by NAME not by id', async () => {
    // A caller cannot spot their typo in a list of other uuids, but can recognise
    // the repository they meant.
    const { deps } = harness({ repos: () => json([REPO]) });
    const instruction = instructionOf(await getConventions({ repo_id: 'repo-nope' }, deps));
    expect(instruction).toContain('acme/payments-api');
    expect(instruction).toMatch(IMPERATIVE);
  });

  it('explains both address forms when given neither', async () => {
    const { deps, paths } = harness({ repos: () => json([REPO]) });
    const instruction = instructionOf(await getConventions({}, deps));
    expect(instruction).toContain('repo_id');
    expect(instruction).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('resolves a bare repository name and reports an ambiguous one', async () => {
    const { deps } = harness({
      repos: () =>
        json([
          REPO,
          { ...REPO, id: 'repo-2', owner: 'globex', full_name: 'globex/payments-api' },
        ]),
      conventions: () => json(conventionsPayload({ scan: SCAN, candidates: CANDIDATES })),
    });

    const instruction = instructionOf(await getConventions({ repo: 'payments-api' }, deps));

    expect(instruction).toContain('acme/payments-api and globex/payments-api');
    expect(instruction).toMatch(IMPERATIVE);
  });
});

// --------------------------------------------------------------------------
// devdigest_get_blast_radius
// --------------------------------------------------------------------------

describe('devdigest_get_blast_radius', () => {
  /** The map for the design's PR: one hot symbol, one quiet one. */
  function blastPayload(over: Partial<PrBlastRadius> = {}): PrBlastRadius {
    return {
      pr_id: 'pr-1',
      changed_files: ['src/middleware/ratelimit.ts'],
      changed_symbols: [
        { name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' },
        { name: 'bucketKey', file: 'src/middleware/ratelimit.ts', kind: 'function' },
      ],
      downstream: [
        {
          symbol: 'rateLimit',
          file: 'src/middleware/ratelimit.ts',
          kind: 'function',
          callers: Array.from({ length: 8 }, (_unused, i) => ({
            name: `caller${i}`,
            file: `src/api/f${i}.ts`,
            line: i + 10,
          })),
          caller_count: 14,
          truncated: true,
          endpoints_affected: ['GET /api/public/items'],
          crons_affected: [],
          impacted: [
            {
              label: 'GET /api/public/items',
              kind: 'endpoint' as const,
              file: 'src/api/f0.ts',
              depth: 1,
            },
          ],
        },
        {
          symbol: 'bucketKey',
          file: 'src/middleware/ratelimit.ts',
          kind: 'function',
          callers: [{ name: 'resetBuckets', file: 'src/jobs/reset.ts', line: 4 }],
          caller_count: 1,
          truncated: false,
          endpoints_affected: [],
          crons_affected: ['reset-rate-buckets (hourly)'],
          impacted: [
            {
              label: 'reset-rate-buckets (hourly)',
              kind: 'cron' as const,
              file: 'src/jobs/reset.ts',
              depth: 1,
            },
          ],
        },
      ],
      impacted: [
        {
          label: 'GET /api/public/items',
          kind: 'endpoint' as const,
          file: 'src/api/f0.ts',
          depth: 1,
        },
        {
          label: 'reset-rate-buckets (hourly)',
          kind: 'cron' as const,
          file: 'src/jobs/reset.ts',
          depth: 1,
        },
      ],
      counts: { symbols: 2, callers: 15, endpoints: 1, crons: 1 },
      status: 'ok',
      reason: null,
      indexed_sha: 'indexsha1',
      ...over,
    };
  }

  const pullDetail: PrDetail = { ...PULL, body: null, files: [], commits: [] };

  /** `pr_id` has to be a real uuid — `PrIdArg` checks the shape before any HTTP. */
  const PR_UUID = '11111111-1111-4111-8111-111111111111';

  function blastApi(over: Partial<PrBlastRadius> = {}): FakeApi {
    return {
      ...addressable(),
      pullDetail: () => json(pullDetail),
      blast: () => json(blastPayload(over)),
    };
  }

  it('groups callers under the symbol they reach, most-impacted first', async () => {
    const { deps } = harness(blastApi());

    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.pr).toBe(482);
    const symbols = payload.symbols as Array<Record<string, unknown>>;
    expect(symbols.map((s) => s.symbol)).toEqual(['rateLimit', 'bucketKey']);
    // A flat caller list could not answer "which changed function has 14 callers".
    expect(symbols[0]!.caller_count).toBe(14);
  });

  it('leads with status, so an empty map is explained before it is read', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    // The property inherited from the stub: a top-down reader meets the caveat first.
    expect(Object.keys(payload).slice(0, 4)).toEqual(['repo', 'pr', 'status', 'counts']);
  });

  it('caps callers per symbol in concise and says it did', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    const symbols = payload.symbols as Array<Record<string, unknown>>;
    expect((symbols[0]!.callers as unknown[]).length).toBe(5);
    expect(symbols[0]!.callers_truncated).toBe(true);
    // The count still describes the WHOLE map, which is why it may exceed the rows.
    expect(payload.counts).toMatchObject({ callers: 15 });
  });

  it('returns every caller the server sent when asked for detail', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(
      await getBlastRadius(
        { repo: 'acme/payments-api', pr: 482, response_format: 'detailed' },
        deps,
      ),
    );
    const symbols = payload.symbols as Array<Record<string, unknown>>;
    expect((symbols[0]!.callers as unknown[]).length).toBe(8);
    // Still flagged truncated, and correctly so: the SERVER sent 8 of 14 (its own
    // per-symbol cap). `detailed` returns everything that arrived — it cannot recover
    // rows the server never sent, and must not imply the list is now complete.
    expect(symbols[0]!.callers_truncated).toBe(true);
  });

  it('carries file:line for every caller — the point of the tool', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    const symbols = payload.symbols as Array<Record<string, unknown>>;
    expect((symbols[0]!.callers as unknown[])[0]).toEqual({
      file: 'src/api/f0.ts',
      line: 10,
      symbol: 'caller0',
    });
  });

  it('names the endpoints and crons in the radius', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    expect(payload.impacted).toEqual(['GET /api/public/items', 'reset-rate-buckets (hourly)']);
  });

  it('adds no next_step when the map is complete', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    expect(payload.next_step).toBeUndefined();
    expect(payload.reason).toBeUndefined();
  });

  it('loads the PR detail first, because it is the only writer of pr_files', async () => {
    const { deps, paths } = harness(blastApi());
    await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps);
    // Resolution, then the detail WRITE, then the map — in that order.
    expect(paths).toEqual(['/repos', '/repos/repo-1/pulls', '/pulls/pr-1', '/pulls/pr-1/blast']);
  });

  it('still returns the map when the detail request fails', async () => {
    // The detail call is a best-effort backfill, not a precondition: its failure must
    // not deny the caller a map the server can still build.
    const { deps } = harness({
      ...addressable(),
      pullDetail: () => errorResponse(500, 'internal_error', 'boom'),
      blast: () => json(blastPayload()),
    });
    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));
    expect(payload.status).toBe('ok');
  });

  it.each([
    ['index_missing', 'no usable codebase index'],
    ['no_changed_files', 'have not been imported yet'],
    ['flag_off', 'turned off'],
  ] as const)('explains a degraded map caused by %s', async (reason, phrase) => {
    const { deps } = harness(
      blastApi({
        status: 'degraded',
        reason,
        downstream: [],
        changed_symbols: [],
        impacted: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );

    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect(payload.status).toBe('degraded');
    expect(payload.reason).toBe(reason);
    const next = String(payload.next_step);
    expect(next).toContain(phrase);
    // The inference that must NOT be drawn — the stub's fifth property, kept.
    expect(next).toContain('do NOT infer');
    expect(next).toContain('no callers');
    expect(next).toMatch(IMPERATIVE);
  });

  it('warns that a partial index may be hiding callers, while still returning them', async () => {
    const { deps } = harness(blastApi({ status: 'partial', reason: 'index_partial' }));

    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect(payload.status).toBe('partial');
    const next = String(payload.next_step);
    expect(next).toContain('Do NOT read an absent caller as proof');
    expect(next).toMatch(IMPERATIVE);
    // Partial is a caveat, not an erasure.
    expect((payload.symbols as unknown[]).length).toBe(2);
  });

  it('caps the symbol list and says how many it dropped', async () => {
    const many = Array.from({ length: 14 }, (_unused, i) => ({
      symbol: `sym${i}`,
      file: 'src/big.ts',
      kind: 'function',
      callers: [{ name: 'x', file: 'src/x.ts', line: 1 }],
      caller_count: 14 - i,
      truncated: false,
      endpoints_affected: [],
      crons_affected: [],
      impacted: [],
    }));
    const { deps } = harness(blastApi({ downstream: many }));

    const payload = payloadOf(await getBlastRadius({ repo: 'acme/payments-api', pr: 482 }, deps));

    expect((payload.symbols as unknown[]).length).toBe(10);
    expect(String(payload.symbols_truncated)).toContain('10 most-impacted of 14');
  });

  it('accepts pr_id, the uuid form a DevDigest studio URL carries', async () => {
    // The address form external walkthroughs use. Before this, it was rejected by
    // design and the caller had to go and find the PR number instead.
    const { deps, paths } = harness(blastApi());

    const payload = payloadOf(await getBlastRadius({ pr_id: PR_UUID }, deps));

    expect(payload.pr).toBe(482);
    expect((payload.symbols as unknown[]).length).toBe(2);
    // The uuid path needs no repository listing to address the pull request, and it
    // does NOT repeat `GET /pulls/:id` — the resolver already made that call, which
    // is the same call that backfills `pr_files`.
    expect(paths).toEqual([`/pulls/${PR_UUID}`, '/repos', `/pulls/${PR_UUID}/blast`]);
  });

  it('names the repository on the uuid path when there is only one', async () => {
    const { deps } = harness(blastApi());
    const payload = payloadOf(await getBlastRadius({ pr_id: PR_UUID }, deps));
    // One repository in the workspace, so the pull can only belong to it.
    expect(payload.repo).toBe('acme/payments-api');
  });

  it('omits the repository rather than inventing one when it cannot be named', async () => {
    // Two repositories and neither lists this pull, so no cheap or paid lookup names
    // it. A `repo` key holding a placeholder would be quoted back by a model.
    const { deps } = harness({
      repos: () =>
        json([REPO, { ...REPO, id: 'repo-2', name: 'other', full_name: 'acme/other' }]),
      pulls: () => json([]),
      pullDetail: () => json(pullDetail),
      blast: () => json(blastPayload()),
    });

    const payload = payloadOf(await getBlastRadius({ pr_id: PR_UUID }, deps));

    expect(payload.repo).toBeUndefined();
    expect(payload.pr).toBe(482);
  });

  it('prefers pr_id when both address forms are given', async () => {
    // A uuid names exactly one row; a bare repository name may not.
    const { deps, paths } = harness(blastApi());
    await getBlastRadius({ pr_id: PR_UUID, repo: 'acme/payments-api', pr: 999 }, deps);
    expect(paths).toContain(`/pulls/${PR_UUID}/blast`);
  });

  it('rejects an empty pr_id before any HTTP call', async () => {
    // `.min(1)` is the only shape rule on this field — the API is the authority on
    // whether an id EXISTS (see `PrIdArg`), but a blank string cannot address
    // anything and is not worth a request.
    const { deps, paths } = harness(blastApi());
    const instruction = instructionOf(await getBlastRadius({ pr_id: '' }, deps));
    expect(instruction).toContain('pr_id');
    expect(instruction).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('explains both address forms when given neither', async () => {
    const { deps, paths } = harness(blastApi());
    const instruction = instructionOf(await getBlastRadius({}, deps));
    expect(instruction).toContain('pr_id');
    expect(instruction).toContain('repo');
    expect(instruction).toMatch(IMPERATIVE);
    expect(paths).toEqual([]);
  });

  it('explains a pr_id the API has no row for', async () => {
    const { deps } = harness({
      ...addressable(),
      pullDetail: () => errorResponse(404, 'not_found', 'no such pull request'),
      blast: () => json(blastPayload()),
    });
    const instruction = instructionOf(
      await getBlastRadius({ pr_id: '11111111-1111-4111-8111-111111111111' }, deps),
    );
    expect(instruction).toContain('11111111-1111-4111-8111-111111111111');
    expect(instruction).toMatch(IMPERATIVE);
  });

  it('still catches a typo in the address, before any other request', async () => {
    const { deps, paths } = harness(blastApi());

    const instruction = instructionOf(await getBlastRadius({ repo: 'acme/nope', pr: 482 }, deps));

    expect(instruction).toContain('acme/payments-api');
    expect(instruction).toMatch(IMPERATIVE);
    // No blast request was made for an address that does not exist.
    expect(paths).not.toContain('/pulls/pr-1/blast');
  });
});


describe('createServer over InMemoryTransport', () => {
  /** A real client talking to a real server, with no socket in between. */
  async function connected(api: FakeApi): Promise<{ client: Client; paths: string[] }> {
    const { deps, paths } = harness(api);
    const server = createServer(deps);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, paths };
  }

  it('advertises the five tools with their descriptions and annotations', async () => {
    const { client } = await connected({ agents: () => json([]) });

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [...TOOL_DEFS].map((def) => def.name).sort(),
    );
    for (const tool of listed.tools) {
      expect(tool.description ?? '').not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
    // Only one tool advertises an output schema, and it is the one whose result a
    // model consumes programmatically.
    const withOutput = listed.tools.filter((tool) => tool.outputSchema !== undefined);
    expect(withOutput.map((tool) => tool.name)).toEqual(['devdigest_list_agents']);

    await client.close();
  });

  it('returns validated structuredContent for the tool that declares an outputSchema', async () => {
    const { client } = await connected({
      agents: () => json([agentRow({ id: 'agent-1', name: 'Security Reviewer' })]),
    });

    // The SDK fails the call itself when a tool with an outputSchema returns no
    // structured content, so reaching an assertion here is part of the check.
    const result = await client.callTool({ name: 'devdigest_list_agents', arguments: {} });

    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent).toMatchObject({ count: 1 });
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ count: 1 });

    await client.close();
  });

  it('delivers a failure as an error result whose text is the instruction', async () => {
    const { client } = await connected({
      repos: () => errorResponse(503, 'internal_error', 'Internal'),
    });

    const result = await client.callTool({
      name: 'devdigest_get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]?.text ?? '').toMatch(IMPERATIVE);

    await client.close();
  });

  it('rejects arguments that do not match the flat schema before the handler runs', async () => {
    const { client, paths } = await connected(addressable());

    // `pr` is the pull request NUMBER; a uuid is exactly the mistake the schema
    // exists to catch, and the SDK catches it without a request being made.
    const result = await client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 'pr-1' },
    });

    expect(result.isError).toBe(true);
    expect(paths).toEqual([]);

    await client.close();
  });
});
