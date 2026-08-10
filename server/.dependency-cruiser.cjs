/**
 * Onion / ports-and-adapters boundary gate for @devdigest/api.
 *
 * The rule set is a RATCHET, not a snapshot:
 *   error → a boundary that is currently unbroken. Breaking it fails CI.
 *   warn  → known drift with a burn-down list. Green today; do not add more.
 * Promote a warn to error once its backlog is cleared. Rationale, the burn-down
 * list and the exception ledger: .claude/skills/onion-architecture/enforcement.md
 *
 * pnpm gotcha: a `to.path` anchored as `^node_modules/<pkg>` NEVER matches here —
 * resolved paths are `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…`. Every
 * package pattern below is unanchored and ends in a slash on purpose.
 */

/** Concrete SDKs a feature module must never import directly (law: go through a port). */
const RAW_SDKS = 'node_modules/(octokit|openai|@anthropic-ai/sdk|simple-git|@ast-grep/napi|dependency-cruiser|postgres|js-tiktoken)/';

module.exports = {
  forbidden: [
    // ─── errors: boundaries that hold today ──────────────────────────────────
    {
      name: 'modules-no-raw-sdk',
      severity: 'error',
      comment:
        'A feature module never imports a vendor SDK. Define a port in vendor/shared, ' +
        'implement it in src/adapters/, take it off the container. (root CLAUDE.md)',
      from: { path: '^src/modules/' },
      to: { dependencyTypes: ['npm'], path: RAW_SDKS },
    },
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment:
        'reviewer-core is the domain core: no server code, no DB, no HTTP. Its one ' +
        'permitted outward edge is the port ring (@devdigest/shared → src/vendor/shared), ' +
        'which is logically inside the core but physically lives in this package.',
      from: { path: '^\\.\\./reviewer-core/src/' },
      to: { path: '^src/(?!vendor/shared)|node_modules/(postgres|drizzle-orm|octokit|fastify)/' },
    },
    {
      name: 'ports-import-nothing',
      severity: 'error',
      comment: 'The port ring declares contracts only. zod is its single dependency.',
      from: { path: '^src/vendor/shared/' },
      to: { path: '^src/(?!vendor/shared)', pathNot: 'node_modules/zod/' },
    },
    {
      name: 'adapters-are-leaves',
      severity: 'error',
      comment:
        'An adapter is a leaf: it implements a port and knows nothing about features ' +
        'or the composition root. EXCEPTION: SUPPORTED_EXT in repo-intel/constants — ' +
        'see the exception ledger in enforcement.md.',
      from: { path: '^src/adapters/' },
      to: {
        path: '^src/modules/|^src/platform/container',
        pathNot: '^src/modules/repo-intel/constants\\.ts$',
      },
    },
    {
      name: 'platform-not-module-aware',
      severity: 'error',
      comment:
        'platform/ is cross-cutting and sits below every feature. Only the composition ' +
        'root (container.ts) may know which modules exist.',
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules/' },
    },

    // ─── warns: known drift, burn down then promote ──────────────────────────
    {
      name: 'routes-no-data-access',
      severity: 'warn',
      comment:
        'DRIFT (4 files). Transport must not touch persistence — move the queries into ' +
        'a repository and let the route call a service.',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/|node_modules/drizzle-orm/' },
    },
    {
      name: 'application-no-db-schema',
      severity: 'warn',
      comment:
        'DRIFT (4 files). The application ring orchestrates repositories; it does not ' +
        'know the Drizzle schema.',
      from: {
        path: '^src/modules/[^/]+/(service|helpers|run-executor|diff-loader|feature-models|status|latest)\\.ts$',
      },
      to: { path: '^src/db/schema|node_modules/drizzle-orm/' },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'warn',
      comment:
        'DRIFT (1 edge). A module never reaches into a sibling. Lift the shared part to ' +
        'the composition root or to _shared/. modules/_shared is the sanctioned kernel.',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/($1|_shared)/' },
    },
    {
      name: 'row-types-stay-in-persistence',
      severity: 'warn',
      comment:
        'DRIFT (1 edge). A Drizzle Row type should not appear in an application or ' +
        'transport signature — map Row → DTO in helpers.ts.',
      from: { path: '^src/modules/[^/]+/(service|routes)\\.ts$' },
      to: { path: '^src/db/rows\\.ts$' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'DRIFT. A cycle means two files are really one unit, or a layer was crossed ' +
        'both ways. Most of ours run through the DI root by design.',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Required: without it the @devdigest/* path aliases resolve to nothing and
    // every rule silently passes.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(^|/)test/' },
  },
};
