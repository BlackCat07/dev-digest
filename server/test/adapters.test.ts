import { describe, it, expect } from 'vitest';
import { Review } from '@devdigest/shared';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockCodeIndex,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import { assemblePrompt } from '../src/platform/prompt.js';
import { groundFindings } from '../src/platform/grounding.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';

describe('mock adapters (no network)', () => {
  it('MockGitClient.diff parses into hunks with new line numbers', async () => {
    const git = new MockGitClient();
    const diff = await git.diff();
    expect(diff.files[0]!.path).toBe('src/config.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('MockGitHubClient records posted reviews and opened PRs', async () => {
    const gh = new MockGitHubClient();
    await gh.postReview({ owner: 'a', name: 'b' }, 482, { body: 'x', event: 'COMMENT' });
    expect(gh.posted).toHaveLength(1);
    const { url } = await gh.openPullRequest({ owner: 'a', name: 'b' }, {
      title: 't',
      head: 'h',
      base: 'main',
      body: 'b',
    });
    expect(url).toContain('github.com');
  });

  it('MockGitHubClient.listWorkflowRuns returns the canned runs and filters on headSha', async () => {
    const runs = [
      {
        id: 101,
        prNumber: 7,
        headSha: 'aaa111',
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/mock/mock/actions/runs/101',
        runStartedAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:01:00Z',
      },
      {
        id: 102,
        prNumber: 8,
        headSha: 'bbb222',
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/mock/mock/actions/runs/102',
        runStartedAt: '2026-06-02T00:00:00Z',
        updatedAt: '2026-06-02T00:01:00Z',
      },
    ];
    const gh = new MockGitHubClient({ workflowRuns: runs });
    const repo = { owner: 'a', name: 'b' };

    const all = await gh.listWorkflowRuns(repo, { workflowFile: 'devdigest-review.yml' });
    expect(all.map((r) => r.id)).toEqual([101, 102]);

    const one = await gh.listWorkflowRuns(repo, {
      workflowFile: 'devdigest-review.yml',
      headSha: 'bbb222',
    });
    expect(one.map((r) => r.id)).toEqual([102]);
    expect(one[0]!.prNumber).toBe(8);

    // `limit` caps the list, and every call is recorded so an ingest test can
    // prove a repository with no installation is never polled.
    const capped = await gh.listWorkflowRuns(repo, {
      workflowFile: 'devdigest-review.yml',
      limit: 1,
    });
    expect(capped).toHaveLength(1);
    expect(gh.listedRuns).toHaveLength(3);
    expect(gh.listedRuns[0]!.opts.workflowFile).toBe('devdigest-review.yml');
  });

  it('MockGitHubClient.downloadRunArtifact returns null for an unknown artifact name', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const gh = new MockGitHubClient({ artifacts: { '101:devdigest-result': bytes } });
    const repo = { owner: 'a', name: 'b' };

    expect(await gh.downloadRunArtifact(repo, 101, 'devdigest-result')).toEqual(bytes);
    // null, not a throw: "no artifact on this run" is the ordinary outcome for an
    // expired artifact and for a cancelled run that uploaded nothing.
    expect(await gh.downloadRunArtifact(repo, 101, 'something-else')).toBeNull();
    expect(await gh.downloadRunArtifact(repo, 999, 'devdigest-result')).toBeNull();
    expect(gh.downloads).toEqual([
      { runId: 101, artifactName: 'devdigest-result' },
      { runId: 101, artifactName: 'something-else' },
      { runId: 999, artifactName: 'devdigest-result' },
    ]);
  });

  it('MockCodeIndex + MockEmbedder return deterministic shapes', async () => {
    const ci = new MockCodeIndex();
    expect((await ci.symbols({ owner: 'a', name: 'b' }))[0]!.name).toBe('rateLimit');
    const emb = await new MockEmbedder().embed(['a', 'b']);
    expect(emb[0]!).toHaveLength(1536);
  });
});

describe('structured review pipeline (mock LLM → grounding)', () => {
  it('runs assemble → completeStructured(Review) → groundFindings end-to-end', async () => {
    // a fixture review where one finding is grounded and one is hallucinated
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
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    const { messages } = assemblePrompt({
      system: 'security reviewer',
      diff: diff.raw,
      task: 'Review PR #482',
    });
    const result = await llm.completeStructured({
      model: 'gpt-4.1',
      schema: Review,
      schemaName: 'Review',
      messages,
    });
    expect(result.data.findings).toHaveLength(2);

    const grounded = groundFindings(result.data.findings, diff);
    expect(grounded.kept).toHaveLength(1); // the real one survives
    expect(grounded.kept[0]!.id).toBe('f1');
    expect(grounded.dropped[0]!.finding.id).toBe('f-hallucinated');
    expect(llm.calls.find((c) => c.method === 'completeStructured')).toBeTruthy();
  });
});

describe('pricing / cost discipline', () => {
  it('estimates cost for known models and returns null for unknown', () => {
    expect(estimateCost('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 5);
    expect(estimateCost('some-future-model', 1000, 1000)).toBeNull();
  });
});
