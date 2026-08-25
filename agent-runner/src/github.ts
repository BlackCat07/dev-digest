import { z } from 'zod';
import type { GitHubReviewPayload } from '@devdigest/shared';
import type { ChangedFile } from './diff.js';

/**
 * The slice of GitHub the runner needs: read a pull request's changed files
 * (with hunk patches) and publish the result. Kept as an interface so the
 * orchestration is unit-testable with a mock — no network in tests.
 *
 * Three REST calls and no SDK. `fetch` is global on Node 20, and the bundle has
 * to be small enough to commit into somebody else's repository —
 * `reviewer-core/CLAUDE.md` asks for exactly this trade: "prefer writing the
 * helper over adding a package".
 */
export interface RunnerGitHub {
  getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
  createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }>;
  createIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: string }>;
}

const API = 'https://api.github.com';
/** GitHub caps a page at 100; a pull request larger than this is already unusual. */
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** Thrown for any non-2xx response. Carries the status so 422 recovery can see it. */
export class GitHubHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubHttpError';
  }
}

/**
 * The response boundary parses; it never casts. `res.json()` is `unknown`, the
 * body is written by a service DevDigest does not run, and `filename` in
 * particular is attacker-influenced — it is the path every exclusion check and
 * every grounding lookup is then made against.
 */
const ApiFiles = z.array(
  z.object({
    filename: z.string(),
    patch: z.string().nullish(),
  }),
);

/** GitHub returns the new object; only its id is used, and only for the log. */
const ApiCreated = z.object({ id: z.union([z.number(), z.string()]).nullish() });

/** Real client over global `fetch` (the workflow's `GITHUB_TOKEN`). */
export class FetchRunnerGitHub implements RunnerGitHub {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        // The token appears here and nowhere else — never in a log line, never
        // in a query string, never in the written result.
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'devdigest-agent-runner',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubHttpError(
        res.status,
        `GitHub ${method} ${path} failed: ${res.status} ${res.statusText}${
          text ? ` — ${text.slice(0, 400)}` : ''
        }`,
      );
    }
    if (res.status === 204) return null;
    return (await res.json()) as unknown;
  }

  async getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const out: ChangedFile[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.request(
        'GET',
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files` +
          `?per_page=${PER_PAGE}&page=${page}`,
      );
      const parsed = ApiFiles.safeParse(body);
      if (!parsed.success) {
        throw new GitHubHttpError(
          200,
          `GitHub returned an unexpected shape for the changed files of #${prNumber}: ` +
            parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      }
      if (parsed.data.length === 0) break;
      for (const f of parsed.data) out.push({ path: f.filename, patch: f.patch ?? null });
      if (parsed.data.length < PER_PAGE) break;
    }
    return out;
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`;
    const comments = payload.comments?.map((c) => ({ path: c.path, line: c.line, body: c.body }));
    const submit = async (event: GitHubReviewPayload['event'], withComments: boolean) => {
      const res = await this.request('POST', path, {
        body: payload.body,
        event,
        ...(withComments && comments?.length ? { comments } : {}),
      });
      return { id: String(ApiCreated.safeParse(res).data?.id ?? '') };
    };
    const is422 = (e: unknown) => e instanceof GitHubHttpError && e.status === 422;

    try {
      return await submit(payload.event, true);
    } catch (err) {
      if (!is422(err)) throw err;
      // Recovery 1 — GitHub forbids APPROVE / REQUEST_CHANGES on your OWN pull
      // request. Downgrade to COMMENT but keep the inline comments, so findings
      // still land on their lines.
      try {
        return await submit('COMMENT', true);
      } catch (err2) {
        if (!is422(err2)) throw err2;
        // Recovery 2 — an inline comment targets a line GitHub cannot resolve
        // ("Line could not be resolved"); one bad line rejects the WHOLE review.
        // Post body-only so every finding still appears in the summary.
        return await submit('COMMENT', false);
      }
    }
  }

  async createIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: string }> {
    const res = await this.request(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`,
      { body },
    );
    return { id: String(ApiCreated.safeParse(res).data?.id ?? '') };
  }
}

/** In-memory mock for tests: canned changed files + records what was published. */
export class MockRunnerGitHub implements RunnerGitHub {
  posted: { owner: string; repo: string; prNumber: number; payload: GitHubReviewPayload }[] = [];
  comments: { owner: string; repo: string; prNumber: number; body: string }[] = [];

  constructor(private files: ChangedFile[] = []) {}

  async getChangedFiles(): Promise<ChangedFile[]> {
    return this.files;
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    payload: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    this.posted.push({ owner, repo, prNumber, payload });
    return { id: `mock-review-${prNumber}` };
  }

  async createIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: string }> {
    this.comments.push({ owner, repo, prNumber, body });
    return { id: `mock-comment-${prNumber}` };
  }
}

/**
 * A client whose every method throws with its own name. The only way to prove a
 * negative — "this path posted nothing" — where an assertion over the result can
 * merely say the answer looked right.
 */
export class ThrowingRunnerGitHub implements RunnerGitHub {
  constructor(private readonly files: ChangedFile[] = []) {}

  async getChangedFiles(): Promise<ChangedFile[]> {
    return this.files;
  }
  async createReview(): Promise<{ id: string }> {
    throw new Error('createReview must not be called');
  }
  async createIssueComment(): Promise<{ id: string }> {
    throw new Error('createIssueComment must not be called');
  }
}
