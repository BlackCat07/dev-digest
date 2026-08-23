/**
 * Local version-over-version trend. A tiny vitest reporter that appends each eval test's
 * pass/fail (with the current git sha) to results/history.jsonl. Both `eval:compare` and
 * `eval:repeat` read this file, so removing the reporter disables both — it is not optional
 * if you use those. Nothing here calls a model.
 *
 * It also carries the MUTATION CANARY. An eval measures what a model would do; it must never be
 * able to do it to the repo it runs in. The SDK's tool restrictions were measured not to guarantee
 * that under bypassPermissions (twice — see run-claude.ts), so this reporter snapshots
 * `git status --porcelain` at init and again at the end, and prints a loud diff of any path that
 * appeared or changed during the run. Being in the reporter means every entry point is covered:
 * `pnpm eval`, `eval:workflow`, `eval:repeat`, `eval:benchmark`. `results/` is gitignored, so a
 * normal run produces nothing here.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeStatus } from "./git.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HISTORY = join(HERE, "..", "results", "history.jsonl");

function gitSha(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

interface TaskLike {
  type?: string;
  name?: string;
  result?: { state?: string };
  tasks?: TaskLike[];
}

export default class TrendReporter {
  private runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  private sha = gitSha();
  private treeBefore: string[] = [];

  onInit() {
    this.treeBefore = worktreeStatus();
  }

  /** Loud, unmissable, and it does not fail the run — the tests' verdicts stay the tests' own. */
  private reportMutations() {
    const before = new Set(this.treeBefore);
    const appeared = worktreeStatus().filter((line) => !before.has(line));
    if (!appeared.length) return;
    const bar = "!".repeat(78);
    console.error(`\n\x1b[31m${bar}\x1b[0m`);
    console.error("\x1b[31mEVAL SESSION MODIFIED THE REPOSITORY — this should be impossible.\x1b[0m");
    for (const line of appeared) console.error(`  ${line}`);
    console.error(
      "Review and revert (git checkout -- <path> / rm the untracked file), then treat the tool\n" +
        "restrictions in src/runtime/run-claude.ts as broken until proven otherwise.",
    );
    console.error(`\x1b[31m${bar}\x1b[0m\n`);
  }

  onFinished(files: TaskLike[] = []) {
    const rows: string[] = [];
    const walk = (task: TaskLike, file: string) => {
      const state = task.result?.state;
      // Only record tests that actually ran (pass/fail) — skips add noise to the trend.
      if (state === "pass" || state === "fail") {
        rows.push(
          JSON.stringify({
            run_id: this.runId,
            git_sha: this.sha,
            nodeid: `${file} > ${task.name ?? "?"}`,
            outcome: state,
          }),
        );
      }
      task.tasks?.forEach((t) => walk(t, file));
    };
    for (const f of files) (f.tasks ?? []).forEach((t) => walk(t, f.name ?? "?"));
    this.reportMutations();
    if (!rows.length) return;
    mkdirSync(dirname(HISTORY), { recursive: true });
    appendFileSync(HISTORY, rows.join("\n") + "\n");
  }
}
