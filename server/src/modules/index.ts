import type { FastifyPluginAsync } from 'fastify';
import settings from './settings/routes.js';
import repos from './repos/routes.js';
import pulls from './pulls/routes.js';
import polling from './polling/routes.js';
import workspace from './workspace/routes.js';
import agents from './agents/routes.js';
import skills from './skills/routes.js';
import conventions from './conventions/routes.js';
import intent from './intent/routes.js';
import smartDiff from './smart-diff/routes.js';
import blast from './blast/routes.js';
import priorPrs from './prior-prs/routes.js';
import projectContext from './project-context/routes.js';
import onboarding from './onboarding/routes.js';
import brief from './brief/routes.js';
import reviews from './reviews/routes.js';
import repoIntel from './repo-intel/routes.js';
// `eval` is not a legal binding name in a module (ES modules are strict mode), so
// the import is aliased and the REGISTRY KEY below carries the module's real name.
import evalPipeline from './eval/routes.js';

/**
 * Module registry. Each feature module is a Fastify plugin in
 * `modules/<name>/routes.ts`. Registered here in one place.
 *
 * ADD A MODULE: create `modules/<name>/routes.ts` exporting a default Fastify
 * plugin, then add one import + one entry below. (We register statically rather
 * than via filesystem autoload so the same code path works under tsx, the
 * bundler, and vitest — native dynamic import() of .ts files is not portable.)
 *
 * This is the Part-0 starter set plus L02's `skills`/`conventions`, L03's
 * `intent` and `smart-diff`, L04's `blast` + `prior-prs`, L05's
 * `project-context` + `onboarding` + `brief`, and L06's `eval`. Each further
 * lesson adds its own module here (ci/hooks, memory, plugins,
 * …) without touching any other module.
 */
export const modules: Record<string, FastifyPluginAsync> = {
  settings,
  repos,
  pulls,
  polling,
  workspace,
  agents,
  skills,
  conventions,
  intent,
  smartDiff,
  blast,
  priorPrs,
  projectContext,
  onboarding,
  brief,
  reviews,
  repoIntel,
  eval: evalPipeline,
};
