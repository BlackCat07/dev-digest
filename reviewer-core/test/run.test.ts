import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  /**
   * The scope guard is gated on the intent slot, not run unconditionally.
   *
   * Without an intent nobody judged scope, so `Finding.scope` must stay absent
   * — the contract says "Absent/null when no intent was available". Persisting
   * `in_scope` on every finding of an intent-less review makes the UI render
   * "In scope N / Out of scope 0", a judgement nobody made.
   */
  describe('scope labelling is gated on the intent slot', () => {
    // Both findings are grounded: the mock diff's hunk covers new-side 10–12.
    const scopeFixture = {
      verdict: 'request_changes',
      summary: 'two real findings',
      score: 40,
      findings: [
        {
          id: 'f-critical',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-warning',
          severity: 'WARNING',
          category: 'style',
          title: 'drive-by rename',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'unrelated to the stated job',
          confidence: 0.5,
          kind: 'finding',
          scope: 'out_of_scope',
        },
      ],
    };

    async function run(intent?: string) {
      const events: string[] = [];
      const outcome = await reviewPullRequest({
        systemPrompt: 'security reviewer',
        model: 'gpt-4.1',
        diff: await new MockGitClient().diff(),
        llm: new MockLLMProvider('openai', { structured: scopeFixture }),
        task: 'Review PR #482',
        ...(intent ? { intent } : {}),
        onEvent: (e) => events.push(e.msg),
      });
      return { outcome, events };
    }

    it('leaves every scope untouched and emits no scope event when no intent was supplied', async () => {
      const { outcome, events } = await run();

      const byId = new Map(outcome.review.findings.map((f) => [f.id, f]));
      expect([...byId.keys()]).toEqual(['f-critical', 'f-warning']);
      // Unlabelled stays unlabelled — NOT back-filled to 'in_scope'.
      expect(byId.get('f-critical')!.scope ?? null).toBeNull();
      // And a label the model did set survives: the floor did not run at all.
      expect(byId.get('f-warning')!.scope).toBe('out_of_scope');

      expect(outcome.assembly.intent ?? null).toBeNull();
      expect(events.some((m) => m.startsWith('scope:'))).toBe(false);
      expect(events.some((m) => m.startsWith('scope floor:'))).toBe(false);
    });

    it('labels and floors every finding when an intent was supplied', async () => {
      const { outcome, events } = await run('Rate-limit the public API endpoints.');

      const byId = new Map(outcome.review.findings.map((f) => [f.id, f]));
      // A CRITICAL cannot even be labelled out of scope, so no filter can hide it.
      expect(byId.get('f-critical')!.scope).toBe('in_scope');
      expect(byId.get('f-warning')!.scope).toBe('out_of_scope');

      expect(events).toContain('scope: 1 in-scope, 1 out-of-scope (1 forced)');
      expect(events.some((m) => m.startsWith('scope floor:'))).toBe(true);
    });

    it('changes labels only: grounding, membership and score are identical either way', async () => {
      const bare = await run();
      const scoped = await run('Rate-limit the public API endpoints.');

      expect(scoped.outcome.grounding).toBe(bare.outcome.grounding);
      expect(scoped.outcome.review.score).toBe(bare.outcome.review.score);
      expect(scoped.outcome.review.findings.map((f) => f.id)).toEqual(
        bare.outcome.review.findings.map((f) => f.id),
      );
      expect(scoped.outcome.dropped).toHaveLength(bare.outcome.dropped.length);
    });
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});
