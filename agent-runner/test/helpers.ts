import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Committed fixtures: `agents/<slug>.yaml` + `skills/<slug>.md`. */
export const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const AGENTS = join(FIX, 'agents');
export const SKILLS = join(FIX, 'skills');

/**
 * GitHub's pull-request files endpoint returns the hunk text in `patch`, with no
 * `diff --git` / `---` / `+++` headers — the runner puts those back.
 */
export const CONFIG_PATCH = `@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_abc123def456",
   redisUrl: x,`;

/**
 * A canned model response with one grounded finding (line 11 is in the hunk) and
 * one phantom (line 999 is not). Its `verdict` is deliberately at odds with its
 * findings in some tests — the review event is arithmetic over severities, not
 * the model's opinion of itself.
 */
export function cannedReview(opts: { verdict?: string; severity?: string } = {}) {
  return {
    verdict: opts.verdict ?? 'request_changes',
    summary: 'A hardcoded Stripe secret was introduced.',
    score: 35,
    findings: [
      {
        id: 'f-secret',
        severity: opts.severity ?? 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'A live Stripe key is committed in source.',
        suggestion: 'Move it to an environment variable.',
        confidence: 0.96,
        kind: 'finding',
      },
      {
        id: 'f-phantom',
        severity: 'WARNING',
        category: 'bug',
        title: 'Phantom finding in a file outside the diff',
        file: 'src/not-in-the-diff.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'Cites a file the diff never touched.',
        confidence: 0.4,
        kind: 'finding',
      },
    ],
  };
}

/** A canned response with no findings at all. */
export const CLEAN_REVIEW = {
  verdict: 'approve',
  summary: 'Nothing of concern.',
  score: 95,
  findings: [],
};
