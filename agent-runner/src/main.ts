import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CiResultArtifact, Finding, LLMProvider } from '@devdigest/shared';
import { CI_AGENTS_DIR, CI_RESULT_FILE_NAME, CI_SKILLS_DIR } from '@devdigest/shared';
import { countBlockers, gateTriggered } from '@devdigest/reviewer-core';
import { loadAgent, ManifestError, type LoadedAgent } from './manifest.js';
import { FetchRunnerGitHub, type RunnerGitHub } from './github.js';
import { OpenRouterProvider } from './llm.js';
import { parsePostMode, reviewAndPost, type PostMode } from './review-pr.js';
import { makeRedactor, type Redactor } from './redact.js';

/**
 * The runner entry point, bundled to dist/runner.mjs and invoked by the
 * generated workflow as:
 *
 *   node .devdigest/runner.mjs review --agent <slug>
 *
 * It reads files and never executes them: no `spawn`, no `exec`, and no import
 * of anything in the checked-out tree beyond the `.devdigest/` files the
 * manifest names. The diff, the pull request's title and body, the branch name
 * and every skill body are DATA — they reach the model inside untrusted
 * delimiters and they reach the exit code not at all.
 *
 * Two invariants hold on EVERY terminating path, including one where the model
 * call throws:
 *  - a result parseable against `CiResultArtifact` is written to
 *    `CI_RESULT_FILE_NAME`, because the workflow uploads it with `if: always()`
 *    and a run with no artifact is a run the studio cannot report;
 *  - no secret value reaches stdout, stderr, that file or the posted review.
 */

/** Environment variables the runner cannot run without. Checked before any model call. */
const REQUIRED_ENV = ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'] as const;

/** Artifact schema version this runner writes. */
const RESULT_VERSION = '1';

export interface RunnerIO {
  env: NodeJS.ProcessEnv;
  /** Arguments after the script path (i.e. `process.argv.slice(2)`). */
  argv: string[];
  /** Repository root; the result file and `.devdigest/` resolve against it. */
  cwd?: string;
  /** Injected for tests. Default: a `fetch`-backed client on `GITHUB_TOKEN`. */
  github?: RunnerGitHub;
  /** Injected for tests. Default: the shared OpenRouter provider. */
  llm?: LLMProvider;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

export interface RunnerOutcome {
  /** Non-zero exactly when the gate tripped, or when the run failed outright. */
  exitCode: number;
  result: CiResultArtifact;
  resultPath: string;
}

export interface RunnerArgs {
  command: 'review';
  agent: string;
  postAs: PostMode;
  /** Pull request number, when given explicitly rather than via the event payload. */
  prNumber: number | null;
}

/** A failure with a message meant for the log and the result file, not a stack trace. */
class RunnerError extends Error {}

/**
 * `review --agent <slug>` plus two optional flags. Hand-parsed on purpose: an
 * argument parser is a dependency, and this bundle travels into repositories
 * that did not ask for one.
 */
export function parseArgs(argv: string[]): RunnerArgs {
  const [command, ...rest] = argv;
  if (command !== 'review') {
    throw new RunnerError(
      `Unknown command ${command ? `"${command}"` : '(none)'} — usage: runner.mjs review --agent <slug>`,
    );
  }

  let agent: string | undefined;
  let postAs: string | undefined;
  let prNumber: number | null = null;

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    switch (flag) {
      case '--agent':
        if (!value) throw new RunnerError('--agent requires a value (the agent slug).');
        agent = value;
        i++;
        break;
      case '--post-as':
        if (!value) throw new RunnerError('--post-as requires a value.');
        postAs = value;
        i++;
        break;
      case '--pr':
        if (!value || !/^\d+$/.test(value)) {
          throw new RunnerError('--pr requires a pull-request number.');
        }
        prNumber = Number(value);
        i++;
        break;
      default:
        throw new RunnerError(`Unknown option "${flag}" — usage: runner.mjs review --agent <slug>`);
    }
  }

  if (!agent) throw new RunnerError('Missing --agent <slug>: which manifest should this run?');
  return { command: 'review', agent, postAs: parsePostMode(postAs), prNumber };
}

/** Names of the required variables that are absent or empty, in declaration order. */
export function missingEnv(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

interface ResultParts {
  agent: string;
  findings: Finding[];
  costUsd: number | null;
  durationMs: number;
  blockers: number;
  missingSkills: string[];
  prNumber: number | null;
  status: 'succeeded' | 'failed' | 'no_findings';
  error: string | null;
}

/** The one place a `CiResultArtifact` is constructed, so every path writes the same shape. */
export function buildResult(parts: ResultParts): CiResultArtifact {
  const bySev = (s: string) => parts.findings.filter((f) => f.severity === s).length;
  return {
    findings_count: parts.findings.length,
    critical: bySev('CRITICAL'),
    warning: bySev('WARNING'),
    suggestion: bySev('SUGGESTION'),
    cost_usd: parts.costUsd,
    duration_ms: parts.durationMs,
    agent: parts.agent,
    version: RESULT_VERSION,
    pr_number: parts.prNumber,
    status: parts.status,
    error: parts.error,
    blockers: parts.blockers,
    missing_skills: parts.missingSkills,
  };
}

/**
 * The `pull_request` event payload, reduced to the two fields the runner uses.
 * `JSON.parse` returns `unknown` and this file is written by the runner host,
 * so it is parsed rather than cast — and `body` is author-controlled text on its
 * way into a prompt, which is the last place to start trusting a shape.
 */
const EventPayload = z.object({
  pull_request: z
    .object({ number: z.number().int().nullish(), body: z.string().nullish() })
    .nullish(),
  number: z.number().int().nullish(),
});

/** Pull request number + author body from the triggering event payload. */
async function prFromEvent(
  env: NodeJS.ProcessEnv,
): Promise<{ number: number; body: string | null } | null> {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
  const parsed = EventPayload.safeParse(raw);
  if (!parsed.success) return null;
  const number = parsed.data.pull_request?.number ?? parsed.data.number;
  if (typeof number !== 'number') return null;
  return { number, body: parsed.data.pull_request?.body ?? null };
}

async function writeResult(
  cwd: string,
  result: CiResultArtifact,
  redact: Redactor,
): Promise<string> {
  const path = join(cwd, CI_RESULT_FILE_NAME);
  await writeFile(path, redact(JSON.stringify(result, null, 2)), 'utf8');
  return path;
}

export async function run(io: RunnerIO): Promise<RunnerOutcome> {
  const env = io.env;
  const cwd = io.cwd ?? process.cwd();
  const redact = makeRedactor([env.OPENROUTER_API_KEY, env.GITHUB_TOKEN]);
  const log = (line: string) => (io.log ?? console.log)(redact(line));
  const errorLog = (line: string) => (io.errorLog ?? console.error)(redact(line));

  const started = Date.now();
  let agentName = 'unknown';
  let missingSkills: string[] = [];
  let prNumber: number | null = null;

  const fail = async (message: string): Promise<RunnerOutcome> => {
    errorLog(message);
    const result = buildResult({
      agent: agentName,
      findings: [],
      costUsd: null,
      durationMs: Date.now() - started,
      blockers: 0,
      missingSkills,
      prNumber,
      status: 'failed',
      error: redact(message),
    });
    const resultPath = await writeResult(cwd, result, redact);
    return { exitCode: 1, result, resultPath };
  };

  try {
    // First, before the arguments and before anything that costs money: a run
    // missing a secret must say which one, not fail three calls later inside a
    // provider — and a misconfigured workflow should read as a misconfigured
    // workflow whatever else is wrong with the command line.
    const missing = missingEnv(env);
    if (missing.length > 0) {
      return await fail(
        `Missing required environment variable(s): ${missing.join(', ')}. ` +
          'Add OPENROUTER_API_KEY to the repository Actions secrets; ' +
          'GITHUB_TOKEN and GITHUB_REPOSITORY are provided by the workflow.',
      );
    }

    const args = parseArgs(io.argv);
    agentName = args.agent;

    const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
    if (!owner || !repo) {
      return await fail('GITHUB_REPOSITORY is not "owner/name".');
    }

    const event = await prFromEvent(env);
    prNumber = args.prNumber ?? event?.number ?? null;
    if (prNumber == null) {
      return await fail(
        'No pull request in the event payload and no --pr given — nothing to review.',
      );
    }

    let agent: LoadedAgent;
    try {
      agent = await loadAgent(
        join(cwd, CI_AGENTS_DIR, `${args.agent}.yaml`),
        join(cwd, CI_SKILLS_DIR),
      );
    } catch (err) {
      if (err instanceof ManifestError) return await fail(err.message);
      throw err;
    }
    agentName = agent.manifest.name;
    missingSkills = agent.missingSkills;
    if (missingSkills.length > 0) {
      // Named in the output AND in the result: a skill that silently did not
      // load is a review run under rules nobody knows were absent.
      log(
        `[${args.agent}] missing skill file(s), continuing without them: ${missingSkills.join(', ')}`,
      );
    }

    const github = io.github ?? new FetchRunnerGitHub(env.GITHUB_TOKEN ?? '');
    const llm = io.llm ?? new OpenRouterProvider(env.OPENROUTER_API_KEY ?? '');

    log(`Reviewing ${owner}/${repo}#${prNumber} with agent "${agent.manifest.name}".`);

    const review = await reviewAndPost({
      github,
      llm,
      agent,
      owner,
      repo,
      prNumber,
      post: args.postAs,
      ...(event?.body ? { prDescription: event.body } : {}),
      onEvent: (e) => log(`[${args.agent}] ${e.msg}`),
    });

    const findings = review.outcome?.review.findings ?? [];
    const failOn = agent.manifest.ci_fail_on;
    const blockers = countBlockers(findings, failOn);
    // The exit code, and the only thing that decides it: the gate over the
    // findings that SURVIVED grounding, under the manifest's own ci_fail_on.
    // Not the model's verdict, not the count of comments GitHub accepted.
    const tripped = gateTriggered(findings, failOn);

    const result = buildResult({
      agent: agent.manifest.name,
      findings,
      costUsd: review.outcome?.costUsd ?? null,
      durationMs: Date.now() - started,
      blockers,
      missingSkills,
      prNumber,
      status: findings.length === 0 ? 'no_findings' : 'succeeded',
      error: null,
    });
    const resultPath = await writeResult(cwd, result, redact);

    log(
      `Done — ${findings.length} grounded finding(s), ${blockers} blocking under ci_fail_on: ${failOn}; wrote ${CI_RESULT_FILE_NAME}.`,
    );
    if (tripped) {
      errorLog(
        `Changes requested: ${blockers} finding(s) trip the ci_fail_on: ${failOn} gate.`,
      );
    }
    return { exitCode: tripped ? 1 : 0, result, resultPath };
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }
}

/* c8 ignore start — the process shell; every branch above is library code. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ env: process.env, argv: process.argv.slice(2) })
    .then((outcome) => {
      // exitCode, not process.exit(): the result file write must flush first.
      process.exitCode = outcome.exitCode;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
