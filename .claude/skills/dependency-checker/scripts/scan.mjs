#!/usr/bin/env node
/**
 * dependency-checker / scan.mjs
 *
 * Emits one JSON document of MEASURED FACTS about this repo's dependencies.
 * Judgement, ranking and advice belong in the report the agent writes; this
 * file only counts things.
 *
 * Node stdlib only, on purpose: `jq` is not installed on this machine, and
 * adding an npm dependency would touch a lockfile, which the root CLAUDE.md
 * lists as never-hand-edit. So the scanner may never grow a dependency.
 *
 * Usage:
 *   node scan.mjs                      # every package, JSON to stdout
 *   node scan.mjs --pkg server,client  # only these
 *   node scan.mjs --no-sizes           # skip the disk walk (fast)
 *   node scan.mjs --out facts.json
 */

import { readFileSync, readdirSync, statSync, lstatSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The workspace packages. Hard-coded on purpose — see the two traps below. */
const PACKAGES = ['client', 'server', 'reviewer-core', 'e2e', 'mcp-server', 'evals'];

/**
 * Trap 1: `server/clones/` holds foreign repos DevDigest has cloned to review,
 *         including a whole second copy of dev-digest. It is gitignored.
 * Trap 2: `client/.next/` ships its own package.json.
 * A `find . -name package.json` picks up 6 packages that are not ours.
 */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'clones', 'dist', 'build', 'coverage', '.turbo']);

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const only = opt('--pkg');
const targets = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : PACKAGES;
const withSizes = !flag('--no-sizes');

// ── helpers ──────────────────────────────────────────────────────────────────

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Node resolution: find `name` walking node_modules up from `fromDir`. */
function resolvePkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const cand = join(dir, 'node_modules', name);
    if (existsSync(join(cand, 'package.json'))) {
      try { return realpathSync(cand); } catch { return cand; }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Bytes on disk for a package directory, EXCLUDING any nested node_modules.
 *
 * Why not `du`: under pnpm every top-level entry is a symlink into `.pnpm/`,
 * and `du -sk` does not follow symlinks — it reports 0 for every dependency.
 * `du -skL` does follow, but has no portable --exclude on macOS/BSD, so it
 * double-counts npm's occasional nested node_modules. Walking in JS costs a
 * few seconds and gets both right.
 */
const sizeCache = new Map();
function dirSize(dir) {
  if (sizeCache.has(dir)) return sizeCache.get(dir);
  let bytes = 0, files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;      // nested copy is its own package
      const p = join(cur, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (e.isSymbolicLink()) continue;             // never double-count a link
      try { bytes += statSync(p).size; files++; } catch { /* broken link, races */ }
    }
  }
  const r = { bytes, files };
  sizeCache.set(dir, r);
  return r;
}

/** Every unique package reachable from `roots`, by node resolution. */
function closure(roots, fromDir) {
  const seen = new Map();   // realpath -> {name, version, dir}
  const queue = roots.map((n) => [n, fromDir]);
  let unresolved = 0;
  while (queue.length) {
    const [name, base] = queue.shift();
    const dir = resolvePkgDir(name, base);
    if (!dir) { unresolved++; continue; }
    if (seen.has(dir)) continue;
    const pj = readJson(join(dir, 'package.json'));
    if (!pj) { unresolved++; continue; }
    seen.set(dir, { name: pj.name || name, version: pj.version || null, dir });
    // runtime edges only: devDependencies of a dependency are never installed
    for (const d of Object.keys(pj.dependencies || {})) queue.push([d, dir]);
    for (const d of Object.keys(pj.optionalDependencies || {})) queue.push([d, dir]);
  }
  return { members: [...seen.values()], unresolved };
}

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|__mocks__|fixtures?|cases)\/|\.(test|spec)\.[jt]sx?$/;

/** Source files of a package, excluding node_modules and the traps above. */
function sourceFiles(pkgDir) {
  const out = [];
  const stack = [pkgDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) { if (!EXCLUDED_DIRS.has(e.name)) stack.push(p); continue; }
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

/** Loose: any import/require anywhere. Used for "is this dep used at all". */
const IMPORT_RE = /(?:^|[^\w$])(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/*
 * Anchored: an import statement at the start of its own line. This repo embeds
 * whole source files inside prompt templates and eval fixtures as string
 * literals, so the loose regex reports `react` imported by server/ and
 * `fastify` by evals/ — both are quoted example code, not edges. The undeclared
 * check is the one that accuses a package of a missing dependency, so it uses
 * the strict form and skips test/fixture paths entirely.
 */
const IMPORT_ANCHORED_RE = /^[ \t]*(?:import|export)[ \t][^\n]*?from[ \t]*['"]([^'"\n]+)['"]|^[ \t]*import[ \t]*['"]([^'"\n]+)['"]|^[ \t]*(?:const|let|var)[^\n=]*=[ \t]*require\([ \t]*['"]([^'"\n]+)['"]/gm;

/** A legal npm package name. Guards against the regex catching string fragments. */
const PKG_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Bare specifier -> package name. 'node:fs', './x' and junk return null. */
function toPkgName(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  if (spec.includes('\n') || spec.includes(' ')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return PKG_NAME_RE.test(name) ? name : null;
}

// ── scan ─────────────────────────────────────────────────────────────────────

/*
 * Packages a framework loads for you: present in `dependencies`, correct to keep,
 * and never named in an import. Flagged rather than filtered, so the report can
 * say why it is not a removal candidate instead of silently hiding it.
 */
const FRAMEWORK_RUNTIME = new Set([
  'react-dom', 'tslib', 'core-js', 'regenerator-runtime', 'sharp', 'pg-native', 'bufferutil', 'utf-8-validate',
]);

const NODE_BUILTINS = new Set([
  'fs','path','url','util','os','crypto','http','https','stream','events','child_process',
  'zlib','buffer','assert','net','tls','dns','worker_threads','readline','process','timers','module','perf_hooks',
]);

const packages = [];
const versionIndex = new Map();   // dep name -> Map(version -> [package])

for (const name of targets) {
  const pkgDir = join(REPO, name);
  const pj = readJson(join(pkgDir, 'package.json'));
  if (!pj) { packages.push({ name, error: 'no package.json' }); continue; }

  const manager = existsSync(join(pkgDir, 'pnpm-lock.yaml')) ? 'pnpm'
                : existsSync(join(pkgDir, 'package-lock.json')) ? 'npm' : 'unknown';
  const installed = existsSync(join(pkgDir, 'node_modules'));

  const groups = {
    prod: Object.keys(pj.dependencies || {}),
    dev: Object.keys(pj.devDependencies || {}),
    peer: Object.keys(pj.peerDependencies || {}),
    optional: Object.keys(pj.optionalDependencies || {}),
  };

  // internal aliases declared in tsconfig — the real cross-package edges
  const tscfg = readJson(join(pkgDir, 'tsconfig.json'));
  const aliases = Object.entries(tscfg?.compilerOptions?.paths || {}).map(([k, v]) => ({
    alias: k, target: v[0], crossPackage: String(v[0]).startsWith('..'),
  }));

  /*
   * A dep can be load-bearing without ever being imported: eslint, typescript,
   * tsx and vitest are invoked by a script or named in a config file. Flagging
   * those as "unused" is the classic false positive of every depcheck tool, so
   * gather the toolchain surface first and let the report subtract it.
   */
  const toolchainText = [
    Object.values(pj.scripts || {}).join('\n'),
    ...readdirSync(pkgDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^(\.?[\w.-]*\.(config|rc)\.(js|cjs|mjs|ts|json)|\.?[\w.-]*rc|tsconfig[\w.-]*\.json|Dockerfile|\.dependency-cruiser\.cjs)$/.test(e.name))
      .map((e) => { try { return readFileSync(join(pkgDir, e.name), 'utf8'); } catch { return ''; } }),
  ].join('\n');

  // what the source actually imports
  const files = sourceFiles(pkgDir);
  const used = new Map();       // pkg name -> file count  (loose, all files)
  const usedStrict = new Map(); // pkg name -> file count  (anchored, product files only)
  let productFileCount = 0;
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = relative(pkgDir, f);
    const isTest = TEST_PATH_RE.test(rel);
    if (!isTest) productFileCount++;

    const hits = new Set();
    for (const m of text.matchAll(IMPORT_RE)) {
      const n = toPkgName(m[1] || m[2] || m[3]);
      if (n && !NODE_BUILTINS.has(n)) hits.add(n);
    }
    for (const n of hits) used.set(n, (used.get(n) || 0) + 1);

    if (isTest) continue;
    const strict = new Set();
    for (const m of text.matchAll(IMPORT_ANCHORED_RE)) {
      const n = toPkgName(m[1] || m[2] || m[3]);
      if (n && !NODE_BUILTINS.has(n)) strict.add(n);
    }
    for (const n of strict) usedStrict.set(n, (usedStrict.get(n) || 0) + 1);
  }

  const declared = new Set([...groups.prod, ...groups.dev, ...groups.peer, ...groups.optional]);
  const aliasNames = new Set(aliases.map((a) => a.alias.replace(/\/\*$/, '')));

  const deps = [];
  for (const [type, list] of Object.entries(groups)) {
    for (const dep of list) {
      const dir = installed ? resolvePkgDir(dep, pkgDir) : null;
      const meta = dir ? readJson(join(dir, 'package.json')) : null;
      const self = dir && withSizes ? dirSize(dir) : null;
      const cl = dir && withSizes ? closure([dep], pkgDir) : null;
      const clBytes = cl ? cl.members.reduce((s, m) => s + dirSize(m.dir).bytes, 0) : null;

      deps.push({
        name: dep,
        type,
        range: (pj.dependencies?.[dep] ?? pj.devDependencies?.[dep] ?? pj.peerDependencies?.[dep] ?? pj.optionalDependencies?.[dep]) || null,
        installedVersion: meta?.version ?? null,
        deprecated: meta?.deprecated ?? null,
        license: meta?.license ?? (Array.isArray(meta?.licenses) ? meta.licenses.map((l) => l.type).join(' OR ') : null),
        hasTypes: !!(meta?.types || meta?.typings) || (dir ? existsSync(join(dir, 'index.d.ts')) : false),
        selfBytes: self?.bytes ?? null,
        closureBytes: clBytes,
        transitiveCount: cl ? Math.max(0, cl.members.length - 1) : null,
        importedInFiles: used.get(dep) || 0,
        referencedInConfig: toolchainText.includes(dep),
        hasBin: !!meta?.bin,
        frameworkRuntime: FRAMEWORK_RUNTIME.has(dep),
      });

      if (meta?.version) {
        if (!versionIndex.has(dep)) versionIndex.set(dep, new Map());
        const vm = versionIndex.get(dep);
        if (!vm.has(meta.version)) vm.set(meta.version, []);
        vm.get(meta.version).push(name);
      }
    }
  }

  /*
   * Declared, never imported, AND not named in a script or config, AND ships no
   * binary. Still only a CANDIDATE — @types/* packages are consumed by tsc
   * through node_modules/@types with no import anywhere. Never delete on this
   * signal alone; the report must say what it checked.
   */
  const unusedCandidates = deps
    .filter((d) => d.importedInFiles === 0 && !d.referencedInConfig && !d.hasBin
                && !d.frameworkRuntime && !d.name.startsWith('@types/'))
    .map((d) => ({ name: d.name, type: d.type, closureBytes: d.closureBytes }));

  // imported but not declared: real risk, it resolves today only by hoisting or alias
  const undeclared = [...usedStrict.entries()]
    .filter(([n]) => !declared.has(n) && !aliasNames.has(n) && !n.startsWith('@devdigest/'))
    .map(([n, c]) => ({ name: n, files: c }))
    .sort((a, b) => b.files - a.files);

  /*
   * Total installed weight. NOT `du` on node_modules: under pnpm every entry
   * there is a symlink into `.pnpm/`, so a plain walk reports ~0 and `du -skL`
   * would double-count. Summing the deduplicated union closure of every direct
   * dep gives the same number under both managers.
   */
  let installedBytes = null, installedPackages = null;
  if (installed && withSizes) {
    const union = closure([...groups.prod, ...groups.dev, ...groups.optional], pkgDir);
    installedBytes = union.members.reduce((s2, m) => s2 + dirSize(m.dir).bytes, 0);
    installedPackages = union.members.length;
  }

  packages.push({
    name,
    packageName: pj.name,
    manager,
    installed,
    counts: { prod: groups.prod.length, dev: groups.dev.length, peer: groups.peer.length, optional: groups.optional.length },
    scripts: Object.keys(pj.scripts || {}),
    aliases,
    sourceFileCount: files.length,
    productFileCount,
    installedBytes,
    installedPackages,
    deps,
    unusedCandidates,
    undeclared,
  });
}

// version drift: one dep name installed at 2+ versions across packages
const drift = [];
for (const [dep, vm] of versionIndex) {
  if (vm.size > 1) {
    drift.push({ name: dep, versions: [...vm.entries()].map(([v, pkgs]) => ({ version: v, packages: pkgs })) });
  }
}
drift.sort((a, b) => b.versions.length - a.versions.length || a.name.localeCompare(b.name));

const doc = {
  generatedFrom: relative(process.cwd(), REPO) || '.',
  node: process.version,
  scanned: targets,
  sizesMeasured: withSizes,
  packages,
  crossPackage: {
    versionDrift: drift,
    // shared-by-many: a dep declared in 3+ packages is a de-facto platform choice
    sharedDeps: [...versionIndex.entries()]
      .map(([n, vm]) => ({ name: n, packages: [...new Set([...vm.values()].flat())] }))
      .filter((x) => x.packages.length >= 3)
      .sort((a, b) => b.packages.length - a.packages.length),
  },
};

const out = opt('--out');
const json = JSON.stringify(doc, null, 2);
if (out) { writeFileSync(out, json); console.error(`wrote ${out} (${(json.length / 1024).toFixed(0)} KB)`); }
else process.stdout.write(json);
