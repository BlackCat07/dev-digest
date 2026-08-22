import { simpleGit } from 'simple-git';
import type { Container } from '../../platform/container.js';
import { resolveDestination } from '../../platform/notifier.js';
import { NOTIFY_DIFF_LINES } from './constants.js';

/**
 * Announce a finished review.
 *
 * The message carries a short excerpt of the diff so the reader can judge from
 * the notification whether it is worth opening the studio. The excerpt is taken
 * from the workspace's existing clone — the review has already run against it,
 * so the bytes are local and no fetch is needed.
 */
export async function announceReview(
  container: Container,
  workspaceId: string,
  reviewId: string,
  clonePath: string,
  baseSha: string,
  headSha: string,
): Promise<void> {
  const destination = await resolveDestination(container.db, workspaceId);
  if (destination.channel === 'none') return;

  const git = simpleGit(clonePath);
  const raw = await git.diff([`${baseSha}...${headSha}`, '--unified=0']);
  const excerpt = raw.split('\n').slice(0, NOTIFY_DIFF_LINES).join('\n');

  await container.jobs.enqueue({
    kind: 'notify',
    payload: { reviewId, channel: destination.channel, target: destination.target, excerpt },
  });
}
