/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   any CLAUDE.md / any agent / the workflow cases           → run the workflow tier
 *
 * Two whole-suite escalations sit on top of the per-artifact mapping:
 *
 *   evals/src/**                      → RUN ALL. An engine change (scoring/, dsl/, runtime/)
 *                                       invalidates every tier, not just the workflow one.
 *   this file / .github/workflows/evals.yml
 *                                     → SMOKE. Changing the CI plumbing itself must prove the
 *                                       plumbing still works, but need not pay for the full
 *                                       suite: one representative artifact per tier.
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents,
 * reason) to $GITHUB_OUTPUT, and a human-readable summary to $GITHUB_STEP_SUMMARY when present.
 * Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Every artifact name under evals/<tier>/ that actually has evals written, sorted. */
function allWithEvals(tier) {
  const dir = join(EVALS_DIR, tier);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && hasEvals(tier, e.name))
    .map((e) => e.name)
    .sort();
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

// --- whole-suite escalations -------------------------------------------------------------------

// The engine is what every tier is measured THROUGH: src/scoring/ decides pass/fail, src/dsl/
// decides what a case even is, src/runtime/ decides which model answers. A change there can flip
// any tier's verdict, so a change there re-runs every tier — not just the workflow one.
const engineChanged = changed.some((f) => /^evals\/src\//.test(f));

// The CI plumbing itself. Changing it must prove it still routes, but a smoke run is enough:
// one representative artifact per tier plus the workflow tier.
const selfChanged = changed.some(
  (f) => f === "evals/scripts/ci-detect.mjs" || f === ".github/workflows/evals.yml",
);

// --- per-artifact mapping ---------------------------------------------------------------------

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
// `(?!README)` because .claude/agents/README.md is the folder's index, not an agent — without it
// the detector reports a phantom agent named "README" on every SKIP line.
const agentNames = touched(
  /^\.claude\/agents\/(?!README\.md$)([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);


let skills = skillNames.filter((n) => hasEvals("skills", n));
let agents = agentNames.filter((n) => hasEvals("agents", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const skippedAgents = agentNames.filter((n) => !hasEvals("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it: the
// root or .claude CLAUDE.md, ANY package CLAUDE.md (server/CLAUDE.md and client/CLAUDE.md show up
// as explicit Reads in the asserted trace — see evals/INSIGHTS.md, 2026-08-23), any agent
// definition, or the workflow cases.
let runWorkflow = changed.some(
  (f) =>
    f === "CLAUDE.md" ||
    f === ".claude/CLAUDE.md" ||
    /^[^/]+\/CLAUDE\.md$/.test(f) ||
    /^\.claude\/agents\/.+\.md$/.test(f) ||
    /^evals\/workflow\//.test(f),
);

let reason = "per-artifact mapping";

if (engineChanged) {
  // Union, so an engine change never DROPS an artifact the diff also touched.
  skills = [...new Set([...skills, ...allWithEvals("skills")])].sort();
  agents = [...new Set([...agents, ...allWithEvals("agents")])].sort();
  runWorkflow = true;
  reason = "engine change (evals/src/**) → run all tiers";
} else if (selfChanged) {
  const smokeSkill = allWithEvals("skills")[0];
  const smokeAgent = allWithEvals("agents")[0];
  if (smokeSkill) skills = [...new Set([...skills, smokeSkill])].sort();
  if (smokeAgent) agents = [...new Set([...agents, smokeAgent])].sort();
  runWorkflow = true;
  reason = "CI plumbing change → smoke: one artifact per tier";
}

// --- outputs -----------------------------------------------------------------------------------

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));
write("reason", reason);

// Human-readable summary — to the step log always, and to the PR-visible job summary in CI so
// "this skill has no evals" is readable without opening the job.
const lines = [
  `changed files : ${changed.length}`,
  `reason        : ${reason}`,
  `skills → run  : ${skills.join(", ") || "(none)"}`,
  `agents → run  : ${agents.join(", ") || "(none)"}`,
  `workflow tier : ${runWorkflow ? "run" : "skip"}`,
];
if (skippedSkills.length) lines.push(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) lines.push(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);

console.error("── eval change detection ──");
for (const l of lines) console.error(l);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  appendFileSync(summary, `### Eval change detection\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\n`);
}
