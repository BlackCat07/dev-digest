import type { Container } from '../../platform/container.js';
import type { Digest } from '@devdigest/shared';
import type { ReviewRow } from './service.js';
import { DIGEST_MAX_ROWS } from './constants.js';

/**
 * Turn a window of review rows into the rendered digest.
 *
 * The summariser needs the workspace's configured model for the narrative line,
 * so it resolves it as it goes rather than making every caller pre-fetch it.
 */
export async function summariseWindow(
  container: Container,
  workspaceId: string,
  rows: ReviewRow[],
): Promise<Digest> {
  const model = await container.featureModel(workspaceId, 'digest');
  const trimmed = rows.slice(0, DIGEST_MAX_ROWS);

  const worst = trimmed.reduce<number | null>(
    (acc, r) => (r.score == null ? acc : acc == null ? r.score : Math.min(acc, r.score)),
    null,
  );

  return {
    windowDays: 7,
    reviewCount: trimmed.length,
    worstScore: worst,
    model,
    rows: trimmed.map((r) => ({ id: r.id, score: r.score, createdAt: r.createdAt.toISOString() })),
  };
}
