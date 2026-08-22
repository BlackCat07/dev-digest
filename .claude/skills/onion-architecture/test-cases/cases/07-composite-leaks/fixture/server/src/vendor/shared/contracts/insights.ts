import { z } from 'zod';
import { readFileSync } from 'node:fs';

/**
 * L07 — cross-repo insights.
 *
 * A window is a closed interval of agent activity for one repository. The
 * reliability figure is derived from what the runs in that window did, weighted
 * per outcome so a flaky provider error does not read like a bad review.
 *
 * The weights ship as data so an operator can retune them for a workspace
 * without a deploy; the file below is the shipped default.
 */
const WEIGHTS_PATH = new URL('./insight-weights.json', import.meta.url);
const DEFAULT_WEIGHTS = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf8')) as Record<string, number>;

export const OutcomeWeights = z.record(z.string(), z.number().min(0).max(1));
export type OutcomeWeights = z.infer<typeof OutcomeWeights>;

export const InsightWindow = z.object({
  repoId: z.string().uuid(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  weights: OutcomeWeights.default(DEFAULT_WEIGHTS),
});
export type InsightWindow = z.infer<typeof InsightWindow>;

export const RepoReliability = z.object({
  repoId: z.string().uuid(),
  runs: z.number().int(),
  reliability: z.number().min(0).max(1),
  worstAgent: z.string().nullable(),
});
export type RepoReliability = z.infer<typeof RepoReliability>;

export const InsightsReport = z.object({
  window: InsightWindow,
  repos: z.array(RepoReliability),
  generatedAt: z.string().datetime(),
});
export type InsightsReport = z.infer<typeof InsightsReport>;

export { DEFAULT_WEIGHTS };
