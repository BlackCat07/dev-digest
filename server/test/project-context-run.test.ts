import { describe, it, expect } from 'vitest';
import type { Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository, PullRow, ReviewRow } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';
import type * as schema from '../src/db/schema.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * L05 — the executor seam for Project Context (T5).
 *
 * Covers AC-14, AC-17, AC-18, AC-20, AC-21, AC-22, AC-24 and AC-25 at the level
 * they are actually observable: the assembled prompt, the persisted `RunTrace`,
 * the run log, and the number of provider calls.
 *
 * HERMETIC, deliberately — no Postgres and therefore no `.it.` in the filename
 * (the two CI workflows filter on exactly that substring, and a DB-backed file
 * misnamed lands in the hermetic lane and fails there). Everything the executor
 * reaches is injected: a real `RunBus` (a plain in-memory emitter), a
 * `MockLLMProvider` whose `calls` array IS the model-call counter AC-24 asks
 * for, and a fake `projectContext` standing in for the module T4 owns.
 *
 * The fake resolves each run's documents by READING a mutable "clone" map at
 * call time, never by holding text — which is what makes AC-14 (text read fresh
 * every run, paths stored) something this file can prove rather than assert.
 *
 * The load-bearing assertion is in "wraps each document exactly once": the
 * engine wraps the `specs` slot itself (`reviewer-core/src/prompt.ts`, the
 * `parts.specs.map((s, i) => wrapUntrusted(...))` line), which is the mirror
 * image of `skills`. If the executor ever wraps too, every gate in this repo
 * stays green and the block reads to the model as data about data
 * (`DDG-SEC-002`). A nested `<untrusted` inside a `spec-N` block is the tell.
 */

/** A one-file diff, enough for a single-pass review. */
const DIFF: UnifiedDiff = parseUnifiedDiff(
  [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -10,3 +10,4 @@',
    '   port: 3000,',
    '+  timeout: 5,',
    '   redisUrl: x,',
  ].join('\n'),
);

/** Zero findings, so grounding drops nothing and the run always reaches `done`. */
const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Nothing to report.',
  score: 95,
  findings: [],
};

const CLONE_HEAD = 'deadbee1234567890abcdef';

/** One document a run may carry, exactly as the project-context module hands it over. */
type Doc = { path: string; text: string };
/** One document the module refused, with the reason the executor must log. */
type Skip = { path: string; reason: string };

interface RunSetup {
  /** Repo-relative path → current text in the clone. Mutated between runs for AC-14. */
  clone: Map<string, string>;
  /** The agent's effective document paths, in effective order. Text is NOT stored. */
  attached: string[];
  /** Documents the module reports as skipped, verbatim (AC-22, AC-23). */
  skipped?: Skip[];
  /** Make the whole resolution fail, to prove the review survives it (AC-21). */
  failResolution?: boolean;
}

interface RunResult {
  trace: RunTrace;
  status: string;
  /** Every call the injected provider saw — AC-24's counter. */
  providerCalls: number;
  /** The persisted run log, flattened to its messages. */
  log: string[];
  /** How many times the fake read the clone, i.e. text was resolved fresh. */
  reads: number;
}

/**
 * Run ONE agent through the real executor against injected fakes.
 *
 * `state` is shared across calls on purpose: two `runOnce` calls against the
 * same `state` are two runs of the same agent with the same stored attachments,
 * which is the only way to observe AC-14.
 */
async function runOnce(state: RunSetup): Promise<RunResult> {
  let reads = 0;
  const resolveForRun = async () => {
    if (state.failResolution) throw new Error('store unavailable');
    const kept: Doc[] = [];
    for (const path of state.attached) {
      const text = state.clone.get(path);
      if (text === undefined) continue;
      reads += 1;
      kept.push({ path, text });
    }
    return {
      texts: kept.map((d) => d.text),
      paths: kept.map((d) => d.path),
      skipped: state.skipped ?? [],
      // ceil(chars / 4), the one counting method this feature uses.
      tokens: kept.reduce((sum, d) => sum + Math.ceil(d.text.length / 4), 0),
    };
  };

  const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
  const runBus = new RunBus();

  const container = {
    runBus,
    llm: async () => llm,
    // No intent: the derivation rejects, `resolveIntent` logs and returns
    // undefined, and the prompt carries no "## Stated intent and scope".
    intent: { derive: async () => Promise.reject(new Error('no intent in this test')) },
    skills: {
      resolveBodiesForAgent: async () => ({ bodies: [], used: [] }),
      recordRunSkills: async () => undefined,
    },
    tokenizer: { count: (s: string) => Math.ceil(s.length / 4) },
    git: {
      diff: async () => DIFF,
      currentHead: async () => CLONE_HEAD,
    },
    projectContext: { resolveForRun },
  } as unknown as Container;

  let trace: RunTrace | undefined;
  let status = 'unknown';
  const repo = {
    getPrFiles: async () => [],
    insertReview: async () => ({ id: 'review-1' }) as unknown as ReviewRow,
    insertFindings: async () => [],
    markReviewed: async () => undefined,
    saveRunTrace: async (_runId: string, t: RunTrace) => {
      trace = t;
    },
    completeAgentRun: async (_runId: string, values: { status: string }) => {
      status = values.status;
    },
  } as unknown as ReviewRepository;

  const agent = {
    id: 'agent-1',
    name: 'Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    strategy: 'single-pass',
    ciFailOn: 'critical',
    // Off, so no repo-intel fake is needed and the prompt stays minimal.
    repoIntel: false,
    version: 1,
  } as unknown as AgentRow;

  const pull = {
    id: 'pr-1',
    repoId: 'repo-1',
    number: 482,
    title: 'rate limit',
    author: 'octocat',
    base: 'main',
    headSha: 'head-sha',
    body: null,
  } as unknown as PullRow;

  const repoRow = {
    id: 'repo-1',
    owner: 'acme',
    name: 'payments-api',
  } as unknown as typeof schema.repos.$inferSelect;

  const executor = new ReviewRunExecutor(container, repo, {} as Container['agentsRepo']);
  await executor.executeRuns('ws-1', pull, repoRow, [{ agent, runId: 'run-1' }]);

  if (!trace) throw new Error('no trace was persisted');
  return {
    trace,
    status,
    providerCalls: llm.calls.length,
    log: trace.log.map((l) => l.msg),
    reads,
  };
}

/**
 * Every `<untrusted source="spec-N">` opening in the assembled specs block.
 *
 * The parameter is nullish rather than merely nullable because the contract
 * declares `PromptAssembly.specs` as `z.string().nullish()`: a persisted trace
 * is read back by a cast (`getRunTrace` does `row.trace as RunTrace`), not by a
 * Zod parse, so a trace written before the field existed comes back with the key
 * ABSENT rather than null. Hence the loose `== null`, which covers both.
 */
function specOpenings(specs: string | null | undefined): number {
  return specs == null ? 0 : (specs.match(/<untrusted source="spec-/g) ?? []).length;
}

/** Each `spec-N` block's inner body, i.e. what the model reads as one document. */
function specBodies(specs: string): string[] {
  return specs
    .split(/<untrusted source="spec-\d+">\n/)
    .slice(1)
    .map((chunk) => chunk.split('\n</untrusted>')[0] ?? '');
}

describe('project context in a review run', () => {
  it('assembles a prompt with no project-context section when nothing is attached', async () => {
    // AC-25 — the omit-when-empty spread must leave the pre-L05 prompt intact.
    const result = await runOnce({ clone: new Map(), attached: [] });

    expect(result.status).toBe('done');
    expect(result.trace.prompt_assembly.specs).toBeNull();
    expect(result.trace.prompt_assembly.user).not.toContain('## Project context');
    expect(result.trace.specs_read).toEqual([]);
  });

  it('passes each attached document raw, in effective order, and records it in specs_read', async () => {
    // AC-17, AC-18, AC-20 — and the double-wrap guard (`DDG-SEC-002`).
    const clone = new Map([
      ['specs/public-api.md', '# Public API\nEvery endpoint is versioned.'],
      ['docs/architecture.md', '# Architecture\nThe onion points inward.'],
      ['INSIGHTS.md', '# Insights\nMigrations never run on boot.'],
    ]);
    const attached = ['specs/public-api.md', 'docs/architecture.md', 'INSIGHTS.md'];
    const result = await runOnce({ clone, attached });

    expect(result.status).toBe('done');
    const specs = result.trace.prompt_assembly.specs;
    expect(specs).not.toBeNull();

    // AC-20 — one specs_read entry per document that actually reached the
    // prompt, in the same order, and the count equals the block count.
    expect(result.trace.specs_read).toEqual(attached);
    expect(result.trace.specs_read.length).toBe(specOpenings(specs));

    // `specBodies` takes a plain string; narrow here rather than asserting, so
    // an absent block fails this test loudly instead of at `.split`.
    if (specs == null) throw new Error('expected an assembled specs block');

    // AC-18 — the engine wrapped each document EXACTLY once. A second wrapper
    // applied by the executor would show up as a nested opening inside a block,
    // and no gate in this repo can see that.
    const bodies = specBodies(specs);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body).not.toContain('<untrusted');
    expect(bodies[0]).toBe(clone.get('specs/public-api.md'));
    expect(bodies[1]).toBe(clone.get('docs/architecture.md'));
    expect(bodies[2]).toBe(clone.get('INSIGHTS.md'));

    // AC-17 — the text is in the user message, in effective order, and the log
    // names the commit the clone was checked out at (EC-7).
    const user = result.trace.prompt_assembly.user;
    expect(user).toContain('## Project context');
    const first = user.indexOf('Every endpoint is versioned.');
    const second = user.indexOf('The onion points inward.');
    const third = user.indexOf('Migrations never run on boot.');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(result.log.some((m) => m.includes(CLONE_HEAD))).toBe(true);
  });

  it('sends the changed text on a second run without the attachment being re-saved', async () => {
    // AC-14 — metadata stores paths, never text, seen from the outside.
    const clone = new Map([['specs/public-api.md', 'Version one.']]);
    const state: RunSetup = { clone, attached: ['specs/public-api.md'] };

    const before = await runOnce(state);
    expect(before.trace.prompt_assembly.user).toContain('Version one.');

    // The clone moves on; nothing is re-attached and `attached` is untouched.
    clone.set('specs/public-api.md', 'Version two.');
    const after = await runOnce(state);

    expect(after.trace.prompt_assembly.user).toContain('Version two.');
    expect(after.trace.prompt_assembly.user).not.toContain('Version one.');
    expect(after.trace.specs_read).toEqual(['specs/public-api.md']);
    // Each run resolved the text itself rather than reusing the first run's.
    expect(before.reads).toBe(1);
    expect(after.reads).toBe(1);
  });

  it('completes the review with the remaining documents when one is missing, and logs why', async () => {
    // AC-21, AC-22 — a run of three attachments, one deleted from the clone.
    const clone = new Map([
      ['specs/public-api.md', 'Every endpoint is versioned.'],
      ['docs/architecture.md', 'The onion points inward.'],
    ]);
    const result = await runOnce({
      clone,
      attached: ['specs/public-api.md', 'docs/architecture.md'],
      skipped: [
        { path: 'specs/deleted.md', reason: 'the document is not in the clone' },
        { path: 'specs/huge.md', reason: 'over the 24000-token run budget' },
      ],
    });

    expect(result.status).toBe('done');
    expect(result.trace.specs_read).toEqual(['specs/public-api.md', 'docs/architecture.md']);
    expect(result.trace.specs_read).not.toContain('specs/deleted.md');
    expect(result.trace.specs_read).not.toContain('specs/huge.md');
    expect(specOpenings(result.trace.prompt_assembly.specs)).toBe(2);

    // AC-22 / AC-23 — one log line per skipped document, naming BOTH the path
    // and the reason, so an absent document is never indistinguishable from one
    // that was never attached.
    const missing = result.log.find((m) => m.includes('specs/deleted.md'));
    expect(missing).toBeDefined();
    expect(missing).toContain('the document is not in the clone');
    const budgeted = result.log.find((m) => m.includes('specs/huge.md'));
    expect(budgeted).toBeDefined();
    expect(budgeted).toContain('over the 24000-token run budget');
  });

  it('completes the review when the project-context lookup itself fails', async () => {
    // AC-21, AC-25 — degrading reproduces the pre-L05 prompt exactly.
    const result = await runOnce({
      clone: new Map([['specs/public-api.md', 'Every endpoint is versioned.']]),
      attached: ['specs/public-api.md'],
      failResolution: true,
    });

    expect(result.status).toBe('done');
    expect(result.trace.prompt_assembly.specs).toBeNull();
    expect(result.trace.prompt_assembly.user).not.toContain('## Project context');
    expect(result.trace.specs_read).toEqual([]);
    expect(result.log.some((m) => m.includes('store unavailable'))).toBe(true);
  });

  it('issues the same number of provider calls with five documents as with none', async () => {
    // AC-24 — discovering, reading and assembling project context costs no
    // model call. The counter is the injected provider's own `calls` array.
    const clone = new Map(
      Array.from({ length: 5 }, (_, i) => [`specs/doc-${i}.md`, `Document ${i}.`] as const),
    );
    const withDocs = await runOnce({ clone, attached: [...clone.keys()] });
    const without = await runOnce({ clone: new Map(), attached: [] });

    expect(withDocs.trace.specs_read).toHaveLength(5);
    expect(withDocs.providerCalls).toBe(without.providerCalls);
  });
});
