import { describe, it, expect } from 'vitest';
import { mapGitHubError } from '../src/adapters/github/octokit.js';
import { AppError } from '../src/platform/errors.js';

/**
 * Octokit's `HttpError` → `AppError`, at the one boundary that owns the GitHub
 * SDK.
 *
 * This file exists because of a defect that two green tests missed between them.
 * `ci-export.test.ts` proved the SERVICE rejects with GitHub's words; the client
 * proved the WIZARD renders `error.message`. Neither covered the HTTP layer in
 * the middle, where Octokit's `status` met an error handler reading `statusCode`
 * — so a real 403 "Resource not accessible by personal access token" reached the
 * screen as "Internal error" and the reviewer had no idea their token was
 * read-only.
 *
 * Hermetic: `mapGitHubError` is a pure function and no Octokit instance, token
 * or network is involved.
 */

/** The shape Octokit throws: `status`, never `statusCode`. */
const httpError = (status: number, message: string) => Object.assign(new Error(message), {
  name: 'HttpError',
  status,
});

describe('mapGitHubError', () => {
  it('turns a 403 into a github_permission AppError carrying GitHub\'s own message', () => {
    // The exact error the export hit: the PAT can read the repository and cannot
    // write a tree to it.
    const raw = httpError(
      403,
      'Resource not accessible by personal access token - https://docs.github.com/rest/git/trees#create-a-tree',
    );

    const mapped = mapGitHubError(raw);

    expect(mapped).toBeInstanceOf(AppError);
    const err = mapped as AppError;
    expect(err.code).toBe('github_permission');
    // 403 and NOT 500 — this is the whole point. `app.ts` hides the message of
    // anything it reads as 5xx.
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(raw.message);
  });

  it('names the other 4xx a caller can act on', () => {
    const cases: [number, string][] = [
      [401, 'github_auth'],
      [404, 'github_not_found'],
      [422, 'github_error'],
    ];
    for (const [status, code] of cases) {
      const mapped = mapGitHubError(httpError(status, `boom ${status}`)) as AppError;
      expect(mapped).toBeInstanceOf(AppError);
      expect(mapped.code).toBe(code);
      expect(mapped.statusCode).toBe(status);
    }
  });

  it('leaves a 5xx, a network error and a non-HTTP throw exactly as they are', () => {
    // Deliberate, not an oversight. These stay retryable for
    // `platform/resilience.ts` (which reads `status` itself), stay logged as
    // unhandled, and stay behind the generic message — an upstream 500's body is
    // not ours to forward.
    const upstream = httpError(502, 'Bad gateway');
    expect(mapGitHubError(upstream)).toBe(upstream);

    const network = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(mapGitHubError(network)).toBe(network);

    const plain = new Error('something else entirely');
    expect(mapGitHubError(plain)).toBe(plain);
  });
});
