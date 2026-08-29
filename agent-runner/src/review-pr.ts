import type { GitHubReviewPayload, LLMProvider } from '@devdigest/shared';
import { reviewPullRequest, toReviewPayload, type ReviewEvent } from '@devdigest/reviewer-core';
import { excludeDevDigestFiles, filesToUnifiedDiff } from './diff.js';
import type { LoadedAgent } from './manifest.js';
import type { RunnerGitHub } from './github.js';

/**
 * The orchestration, as a library: pull a pull request's diff from GitHub (the
 * files endpoint — no clone), drop DevDigest's own installed files, run the
 * reviewer-core engine, turn the GROUNDED review into a GitHub review payload,
 * and publish it. No process, no env, no exit code — main.ts owns those, and
 * this stays drivable from a test with a mock client and a canned provider.
 *
 * Two things are deliberately not decided here and cannot be:
 *  - the review EVENT comes from `toReviewPayload` with `failOn` read off the
 *    manifest, never from the model's self-reported verdict;
 *  - the findings published are the ones `reviewPullRequest` already grounded,
 *    so a citation outside the diff reaches neither the review nor the result.
 */

export type PostMode = 'github_review' | 'pr_comment' | 'none';

const POST_MODES: readonly PostMode[] = ['github_review', 'pr_comment', 'none'];

/**
 * Read a post mode off a workflow-supplied string. Tolerates the hyphenated
 * spelling, because the value is interpolated into a YAML file that outlives
 * this release in someone else's repository.
 */
export function parsePostMode(raw: string | undefined | null): PostMode {
  if (!raw) return 'github_review';
  const normalised = raw.trim().toLowerCase().replaceAll('-', '_');
  return POST_MODES.find((m) => m === normalised) ?? 'github_review';
}

export interface ReviewAndPostInput {
  github: RunnerGitHub;
  llm: LLMProvider;
  agent: LoadedAgent;
  owner: string;
  repo: string;
  prNumber: number;
  post?: PostMode;
  inline?: boolean;
  /** OpenRouter session id; defaults to `owner/repo#pr:agent` (one review = one session). */
  sessionId?: string;
  /**
   * The pull request author's description/body. UNTRUSTED author-controlled
   * text — the engine's prompt wraps and truncates it, and nothing in it can
   * reach the review event, which is arithmetic over severities.
   */
  prDescription?: string;
  onEvent?: (e: ReviewEvent) => void;
}

export interface ReviewAndPostResult {
  outcome: Awaited<ReturnType<typeof reviewPullRequest>> | null;
  payload: GitHubReviewPayload | null;
  posted: { id: string } | null;
  /** Files GitHub returned without a patch (binary / truncated) — never silent. */
  skipped: string[];
  /** DevDigest's own files, dropped before the engine saw the diff. */
  excluded: string[];
}

export async function reviewAndPost(input: ReviewAndPostInput): Promise<ReviewAndPostResult> {
  const { github, llm, agent, owner, repo, prNumber } = input;
  const post = input.post ?? 'github_review';
  const sessionId = input.sessionId ?? `${owner}/${repo}#${prNumber}:${agent.manifest.name}`;
  const log = (e: ReviewEvent) => input.onEvent?.(e);

  const all = await github.getChangedFiles(owner, repo, prNumber);
  const { reviewable, excluded } = excludeDevDigestFiles(all);
  if (excluded.length > 0) {
    log({
      kind: 'info',
      msg: `${excluded.length} DevDigest file(s) excluded from the review: ${excluded.join(', ')}`,
    });
  }

  const { diff, skipped } = filesToUnifiedDiff(reviewable);
  if (skipped.length > 0) {
    // "Never go silent": these files cannot be grounded; say so explicitly.
    log({
      kind: 'info',
      msg: `${skipped.length} file(s) had no patch (binary/too large), skipped: ${skipped.join(', ')}`,
    });
  }

  if (diff.files.length === 0) {
    // Nothing reviewable — a pull request that only touches DevDigest's own
    // files, or only binaries. No model call and no posted review: an APPROVE
    // here would be a verdict on a diff nobody looked at.
    log({ kind: 'info', msg: 'Nothing to review after exclusions — no review posted.' });
    return { outcome: null, payload: null, posted: null, skipped, excluded };
  }

  const outcome = await reviewPullRequest({
    systemPrompt: agent.manifest.system_prompt,
    model: agent.manifest.model,
    strategy: agent.manifest.strategy,
    diff,
    llm,
    skills: agent.skillBodies,
    task: `Review pull request #${prNumber} in ${owner}/${repo} with agent "${agent.manifest.name}".`,
    ...(input.prDescription ? { prDescription: input.prDescription } : {}),
    sessionId,
    onEvent: log,
  });

  const payload = toReviewPayload(outcome.review, {
    inline: input.inline ?? true,
    failOn: agent.manifest.ci_fail_on,
    diff,
  });

  let posted: { id: string } | null = null;
  if (post === 'github_review') {
    posted = await github.createReview(owner, repo, prNumber, payload);
    log({
      kind: 'result',
      msg: `Posted review ${posted.id} (${payload.event}) with ${payload.comments?.length ?? 0} inline comment(s)`,
    });
  } else if (post === 'pr_comment') {
    posted = await github.createIssueComment(owner, repo, prNumber, payload.body);
    log({ kind: 'result', msg: `Posted comment ${posted.id} (${payload.event})` });
  }

  return { outcome, payload, posted, skipped, excluded };
}
