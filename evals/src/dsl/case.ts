/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      expectFilesRead?: string[];
      /**
       * Optional judge ON TOP of the trace assertions — the answer to "did it also tell the truth".
       * The trace tier alone cannot see a confabulation: on 2026-08-23 a session produced a
       * fabricated verbatim quote attributed to a file it had really opened, and only a missing
       * Read made the case go red. Practices close that gap; the case then passes only if the trace
       * facets hold AND the judge clears `threshold`.
       *
       * Supplying practices DISABLES the early stop for this case (see the runner): stopWhen cuts
       * the session the moment the trace evidence lands, which leaves almost no answer text behind
       * (measured: 27 output tokens), and an empty answer is not something a judge can read.
       */
      practices?: string[];
      /** Judge score gate for `practices` (default 0.6). */
      threshold?: number;
      maxTurns?: number;
    };

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
export function activated(result: Result, skill: string): boolean {
  const bySkill = result.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`));
  const byRead = result.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
  return bySkill || byRead;
}

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

/**
 * Run the model call, and if the call ITSELF throws, leave a failure record before re-throwing.
 *
 * `runClaude` re-throws when a session dies with nothing usable collected. The record() calls below
 * all sit in a `finally` AFTER that await, so such a death used to leave no record at all — and
 * `eval:repeat` counts records, so the case silently vanished from the denominator: the 2026-08-23
 * `workflow-guarded` run printed "run 1/2 ✓ 5/5 cases" for a run where a sixth case had crashed.
 * A crash must read as a failure, never as a smaller suite.
 *
 * Only the call is wrapped, so a later `expect` throw still hits the existing finally-record and
 * nothing is recorded twice.
 */
async function measure(label: string, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (err) {
    record(label, {
      result: {
        text: "",
        toolsUsed: [],
        subagents: [],
        skillsInvoked: [],
        filesRead: [],
        numTurns: 0,
        isError: true,
        metrics: { durationMs: 0, inputTokens: 0, outputTokens: 0, toolCallCount: 0 },
      },
      passed: false,
      extra: { error: String(err) },
    });
    throw err;
  }
}

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await measure(c.name, () => task(c.prompt, artifact, { maxTurns: c.maxTurns }));
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await measure(c.name, () =>
          workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: (p) => p.subagents.includes(expect1),
          }),
        );
        logTrace(c.name, result);
        // Compute the verdict BEFORE asserting, so the record carries the case's own pass/fail
        // rather than "did the session end cleanly" (see RecordData.passed).
        const passed = result.subagents.includes(c.expectSubagent);
        try {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
        } finally {
          record(c.name, { result, passed });
        }
      } else if (c.kind === "activation") {
        const result = await measure(c.name, () => workflowTask(c.prompt, { maxTurns: c.maxTurns }));
        logTrace(c.name, result);
        // A correct negative that ran out of turns is still a correct negative — the verdict is the
        // activation check alone, never the session's exit status.
        const passed = activated(result, c.skill) === c.shouldActivate;
        try {
          expect(
            activated(result, c.skill),
            `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
          ).toBe(c.shouldActivate);
        } finally {
          record(c.name, { result, passed });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        const skillEngaged = (p: { skillsInvoked: string[]; filesRead: string[] }, skill: string) =>
          p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
          p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
        // A judged trace has to run to the end — see WorkflowCase.practices.
        const wantsJudge = (c.practices?.length ?? 0) > 0;
        const result = await measure(c.name, () =>
          workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: wantsJudge
            ? undefined
            : (p) =>
                subs.every((s) => p.subagents.includes(s)) &&
                skls.every((s) => skillEngaged(p, s)) &&
                files.every((f) => p.filesRead.some((r) => r.includes(f))),
          }),
        );
        logTrace(c.name, result);
        // Every provided expectation, plus a clean exit — the same conjunction the asserts below
        // check, evaluated once so the record and the test agree.
        const traceOk =
          subs.every((sub) => result.subagents.includes(sub)) &&
          skls.every((skill) => activated(result, skill)) &&
          files.every((file) => result.filesRead.some((f) => f.includes(file))) &&
          !result.isError;
        const threshold = wantsJudge ? (c.threshold ?? DEFAULT_THRESHOLD) : undefined;
        let verdict: Verdict | undefined;
        try {
          if (wantsJudge) {
            verdict = await llmJudge(result.text, c.practices ?? []);
            logVerdict(c.name, verdict);
          }
        } finally {
          // A case that ASKED for a judge and has no verdict did not pass — llmJudge threw (a rate
          // limit, a malformed response). Without this the record would say PASS on `traceOk` alone
          // while vitest failed the test: the record and the test must never disagree, which is the
          // whole point of computing the verdict here. Scoring `true` for "no judge ran" would also
          // silently delete the confabulation gate this case exists for.
          const judgeOk = wantsJudge ? verdict !== undefined && verdict.score >= (threshold ?? 0) : true;
          record(c.name, { result, verdict, threshold, passed: traceOk && judgeOk });
        }
        // The record has already landed (with the verdict), so the asserts need no finally.
        for (const sub of c.expectSubagents ?? []) {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
        }
        for (const skill of c.expectSkills ?? []) {
          expect(
            activated(result, skill),
            `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
          ).toBe(true);
        }
        for (const file of c.expectFilesRead ?? []) {
          expect(
            result.filesRead.some((f) => f.includes(file)),
            `${file} not read | reads: ${result.filesRead.join(", ")}`,
          ).toBe(true);
        }
        expect(result.isError).toBe(false);
        if (verdict && threshold !== undefined) {
          expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await measure(`${c.name} [treatment]`, () =>
          workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns }),
        );
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        const control = await measure(`${c.name} [control]`, () =>
          runClaude(c.prompt, {
            allowedTools: tools,
            maxTurns: c.maxTurns,
            cwd: emptyCwd,
            settingSources: [],
          }),
        );
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        // Each half is scored on ITS OWN half of the claim: treatment had to read the file, control
        // had to not. Recording the conjunction on both rows would hide which side broke.
        const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
        const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
        try {
          expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
          expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
        } finally {
          record(`${c.name} [treatment]`, { result: treatment, passed: treatmentRead });
          record(`${c.name} [control]`, { result: control, passed: !controlRead });
        }
      }
    });
  }
}
