/**
 * CI runner-bundle loader.
 *
 * The export ships `agent-runner/dist/runner.mjs` verbatim into the target
 * repository as `.devdigest/runner.mjs`. Reading that file is filesystem work,
 * and `platform/` is the ring allowed to do it: a feature module may not import
 * any `node:` specifier, so `modules/ci/` declares the need as a bare call
 * signature (`() => Promise<string>`) and the composition root satisfies it with
 * `loadCiRunnerBundle`. This module knows nothing about that module.
 *
 * NOTE (the same caveat `platform/prompts.ts` carries): the bundle is resolved
 * relative to THIS module — `server/src/platform/` under `tsx` (dev) and
 * `server/dist/platform/` in a compiled build. Three levels up is the repository
 * root in both cases, which is where `agent-runner/` lives.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RUNNER_BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'agent-runner',
  'dist',
  'runner.mjs',
);

let cached: string | undefined;

/**
 * The committed agent-runner bundle, cached for the life of the process — it is
 * a build artefact, so it cannot change under a running server.
 */
export async function loadCiRunnerBundle(): Promise<string> {
  if (cached !== undefined) return cached;
  cached = await readFile(RUNNER_BUNDLE_PATH, 'utf8');
  return cached;
}
