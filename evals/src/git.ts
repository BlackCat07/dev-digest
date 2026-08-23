/**
 * Git provenance for a run — the short sha and whether the tree is dirty. Shared by record.ts
 * (per-run rows) and repeat.ts (labeled aggregates) so both stamp the same way. No vitest
 * dependency here, so plain `tsx` CLIs can import it safely.
 */

import { execFileSync } from "node:child_process";

export interface GitInfo {
  sha: string;
  dirty: boolean;
}

/**
 * Every path git considers changed, as `XY path` lines. Used by the mutation canary in
 * trend-reporter.ts: an eval session must never modify the repository it measures, and the SDK's
 * own tool-restriction options were measured NOT to guarantee that (see run-claude.ts). Comparing
 * this before and after a run catches a write no matter which layer let it through.
 */
export function worktreeStatus(): string[] {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

export function gitInfo(): GitInfo {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: "unknown", dirty: false };
  }
}
