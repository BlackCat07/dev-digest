import { describe, it, expect } from 'vitest';
import { FetchRunnerGitHub, GitHubHttpError } from '../src/github.js';

const TOKEN = 'ghp_SENTINEL0000githubtoken000000000000';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A `fetch` stand-in that records every call and replays canned responses. */
function stubFetch(responses: { status?: number; body: unknown }[]): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const canned = responses[Math.min(i, responses.length - 1)]!;
    i++;
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const status = canned.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => canned.body,
      text: async () => JSON.stringify(canned.body),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('FetchRunnerGitHub.getChangedFiles', () => {
  it('parses the response and keeps the token out of the URL', async () => {
    const { fetchImpl, calls } = stubFetch([
      { body: [{ filename: 'src/a.ts', patch: '@@ -1 +1 @@\n+a', sha: 'x' }] },
      { body: [] },
    ]);
    const gh = new FetchRunnerGitHub(TOKEN, fetchImpl);

    const files = await gh.getChangedFiles('acme', 'payments-api', 482);

    expect(files).toEqual([{ path: 'src/a.ts', patch: '@@ -1 +1 @@\n+a' }]);
    expect(calls[0]?.url).toContain('/repos/acme/payments-api/pulls/482/files');
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('treats a file with no patch as a file with no patch, not as clean', async () => {
    const { fetchImpl } = stubFetch([{ body: [{ filename: 'a.png' }] }]);
    const files = await new FetchRunnerGitHub(TOKEN, fetchImpl).getChangedFiles('a', 'b', 1);
    expect(files).toEqual([{ path: 'a.png', patch: null }]);
  });

  it('rejects a body that does not match the expected shape instead of casting it', async () => {
    const { fetchImpl } = stubFetch([{ body: { message: 'Not Found' } }]);
    await expect(
      new FetchRunnerGitHub(TOKEN, fetchImpl).getChangedFiles('a', 'b', 1),
    ).rejects.toThrow(/unexpected shape/);
  });

  it('surfaces a non-2xx with its status', async () => {
    const { fetchImpl } = stubFetch([{ status: 404, body: { message: 'Not Found' } }]);
    const err = await new FetchRunnerGitHub(TOKEN, fetchImpl)
      .getChangedFiles('a', 'b', 1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubHttpError);
    expect((err as GitHubHttpError).status).toBe(404);
  });
});

describe('FetchRunnerGitHub.createReview — the 422 recovery ladder', () => {
  const payload = {
    body: 'summary',
    event: 'REQUEST_CHANGES' as const,
    comments: [{ path: 'src/a.ts', line: 1, body: 'c' }],
  };

  it('posts the review as asked when GitHub accepts it', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { id: 99 } }]);
    const res = await new FetchRunnerGitHub(TOKEN, fetchImpl).createReview('a', 'b', 1, payload);
    expect(res.id).toBe('99');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ event: 'REQUEST_CHANGES' });
  });

  it('downgrades to COMMENT when REQUEST_CHANGES on your own PR is refused', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 422, body: { message: 'Can not request changes on your own pull request' } },
      { body: { id: 100 } },
    ]);
    const res = await new FetchRunnerGitHub(TOKEN, fetchImpl).createReview('a', 'b', 1, payload);
    expect(res.id).toBe('100');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ event: 'COMMENT' });
    expect((calls[1]?.body as { comments?: unknown[] }).comments).toHaveLength(1);
  });

  it('falls back to body-only when one inline line cannot be resolved', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 422, body: { message: 'nope' } },
      { status: 422, body: { message: 'Line could not be resolved' } },
      { body: { id: 101 } },
    ]);
    const res = await new FetchRunnerGitHub(TOKEN, fetchImpl).createReview('a', 'b', 1, payload);
    expect(res.id).toBe('101');
    expect(calls).toHaveLength(3);
    // Body-only: every finding still appears in the summary rather than nowhere.
    expect((calls[2]?.body as { comments?: unknown[] }).comments).toBeUndefined();
  });

  it('does not swallow a non-422 failure', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 403, body: { message: 'Forbidden' } }]);
    await expect(
      new FetchRunnerGitHub(TOKEN, fetchImpl).createReview('a', 'b', 1, payload),
    ).rejects.toBeInstanceOf(GitHubHttpError);
    expect(calls).toHaveLength(1);
  });
});

describe('FetchRunnerGitHub.createIssueComment', () => {
  it('posts the body to the issues endpoint', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: { id: 7 } }]);
    const res = await new FetchRunnerGitHub(TOKEN, fetchImpl).createIssueComment(
      'acme',
      'payments-api',
      482,
      'summary',
    );
    expect(res.id).toBe('7');
    expect(calls[0]?.url).toContain('/repos/acme/payments-api/issues/482/comments');
    expect(calls[0]?.body).toEqual({ body: 'summary' });
  });
});
