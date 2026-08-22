import { readFile } from 'node:fs/promises';
import type { Finding } from '@devdigest/shared';
import { SEVERITY_RANK } from '../../../server/src/modules/reviews/constants.js';

/**
 * Severity re-weighting.
 *
 * A model returns a severity per finding, but severity is only comparable within
 * one agent's own output — a security agent calls everything `critical`, a style
 * agent calls nothing worse than `warning`. This pass rescales each finding's
 * severity against a per-kind weight so the merged list from several agents can
 * be ordered honestly.
 *
 * The weights are deliberately data rather than code: a workspace tunes them
 * without a deploy, and the defaults below are what ships.
 */

export const DEFAULT_WEIGHTS: Record<string, number> = {
  secret_leak: 1.0,
  injection: 0.95,
  correctness: 0.8,
  performance: 0.55,
  style: 0.2,
};

export interface WeightedFinding extends Finding {
  /** Rescaled 0-1 priority; ties fall back to the finding's own severity rank. */
  weight: number;
}

/**
 * Load the weight table. A workspace may override the defaults by pointing at a
 * JSON file; anything it omits keeps the shipped default, so a partial override
 * is a valid override.
 */
export async function loadWeights(): Promise<Record<string, number>> {
  const path = process.env.DEVDIGEST_SEVERITY_WEIGHTS;
  if (!path) return DEFAULT_WEIGHTS;

  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const merged = { ...DEFAULT_WEIGHTS };
  for (const [kind, value] of Object.entries(parsed)) {
    if (typeof value === 'number' && value >= 0 && value <= 1) merged[kind] = value;
  }
  return merged;
}

/**
 * Order findings by weighted priority, highest first. The comparison is total —
 * weight, then severity rank, then file and line — so the same input list always
 * renders in the same order and a tie cannot reshuffle between requests.
 */
export async function prioritize(findings: Finding[]): Promise<WeightedFinding[]> {
  const weights = await loadWeights();

  return findings
    .map((f) => ({ ...f, weight: weights[f.kind] ?? DEFAULT_WEIGHTS.correctness }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.file.localeCompare(b.file) ||
        a.startLine - b.startLine,
    );
}
