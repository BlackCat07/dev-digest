import { describe, it, expect } from 'vitest';
import type { SmartDiffRole } from '@devdigest/shared';
import { classifyPath, normalizePath } from '../src/modules/smart-diff/classify.js';
import { LOCK_FILE_NAMES, ROLE_BY_PATH } from '../src/modules/smart-diff/constants.js';

/**
 * L03b — the role classifier.
 *
 * Two properties carry most of the value here, and neither is "the happy path
 * works":
 *
 *  1. **A lock file is ALWAYS boilerplate.** An acceptance criterion, universal
 *     over a set — so the test iterates the classifier's OWN name list rather
 *     than a hand-copied sample, and a name added to `LOCK_FILE_NAMES` later is
 *     covered with no test edit.
 *  2. **An unrecognised path is `core`.** The direction of the default is the one
 *     mistake with an asymmetric cost: a false `core` costs one extra expanded
 *     file, a false `boilerplate` HIDES a change inside a collapsed group. A
 *     regression to a boilerplate default passes every "is it grouped?" test and
 *     silently stops the feature from doing its job.
 */

/** Where a lock file might sit, including inside a directory that looks like wiring. */
const PREFIXES = ['', 'src/', 'config/', 'src/index/', 'deep/nested/dir/'];

describe('classifyPath — a lock file is always boilerplate', () => {
  it('classifies every known lock file as boilerplate, at any depth and in any case', () => {
    for (const name of LOCK_FILE_NAMES) {
      for (const prefix of PREFIXES) {
        for (const path of [`${prefix}${name}`, `${prefix}${name}`.toUpperCase()]) {
          expect(classifyPath(path), path).toBe('boilerplate');
        }
      }
    }
  });

  /**
   * The reason the check sits in a statement ABOVE the table rather than as its
   * first row — and this test is what proves the placement is load-bearing rather
   * than belt-and-braces.
   *
   * `pnpm-lock.yaml` and `package-lock.json` both match the wiring block's
   * config-by-extension catch-all (`.yaml`, `.json`), and nothing in the
   * boilerplate blocks above it matches them first. So the table ALONE really does
   * misclassify them: deleting the pre-check would move a lock file into `wiring`
   * while every other assertion in this file still passed.
   */
  it('is not redundant with the table: the table alone would misclassify a lock file', () => {
    const tableRole = (raw: string): SmartDiffRole | null => {
      const path = normalizePath(raw);
      for (const [pattern, role] of ROLE_BY_PATH) if (pattern.test(path)) return role;
      return null;
    };

    const misclassified = LOCK_FILE_NAMES.filter((n) => {
      const role = tableRole(n);
      return role !== null && role !== 'boilerplate';
    });

    expect(misclassified.length).toBeGreaterThan(0);
    expect(misclassified).toContain('pnpm-lock.yaml');
    // …and the pre-check nonetheless gets every one of them right.
    for (const name of misclassified) expect(classifyPath(name)).toBe('boilerplate');
  });

  it('beats a directory that would otherwise win, and an extension-based rule', () => {
    expect(classifyPath('config/package-lock.json')).toBe('boilerplate');
    expect(classifyPath('src/index/deno.lock')).toBe('boilerplate');
    expect(classifyPath('packages.lock.json')).toBe('boilerplate');
  });

  it('does not match a file that merely looks like one', () => {
    // Anchored on the basename, so a lock file's NAME inside another name is not
    // a lock file. `packageXlockXjson` is what an unescaped `.` would accept.
    expect(classifyPath('src/packageXlockXjson.ts')).toBe('core');
    expect(classifyPath('src/yarn.lock.backup.ts')).toBe('core');
  });
});

describe('classifyPath — the demo PR', () => {
  /**
   * The nine files of the seeded PR, with the role each must land in.
   *
   * `src/api/users.ts` is `core`, which DIVERGES from the design mock (it shows
   * the file under Boilerplate). No path rule yields boilerplate for `src/api/`,
   * and it is the file carrying the seeded WARNING — putting it in the collapsed
   * group would fight the acceptance criterion it exists to demonstrate. Recorded
   * in `server/specs/smart-diff.md`.
   */
  const DEMO: ReadonlyArray<readonly [string, SmartDiffRole]> = [
    ['src/middleware/ratelimit.ts', 'core'],
    ['src/api/public/webhooks.ts', 'core'],
    ['src/api/users.ts', 'core'],
    ['src/api/public/index.ts', 'wiring'],
    ['src/server.ts', 'wiring'],
    ['src/config.ts', 'wiring'],
    ['package.json', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['test/ratelimit.test.ts', 'boilerplate'],
  ];

  it.each(DEMO)('%s → %s', (path, role) => {
    expect(classifyPath(path)).toBe(role);
  });

  it('puts each of the three roles on screen, so the demo shows the feature', () => {
    const roles = new Set(DEMO.map(([path]) => classifyPath(path)));
    expect([...roles].sort()).toEqual(['boilerplate', 'core', 'wiring']);
  });
});

describe('classifyPath — wiring', () => {
  it.each([
    'src/api/public/index.ts',
    'main.go',
    'pkg/mod.rs',
    'src/server.ts',
    'app.py',
    'src/pkg/__init__.py',
    'src/config.ts',
    'settings.py',
    'vitest.config.ts',
    'tsconfig.json',
    'tsconfig.eslint.json',
    '.github/workflows/ci.yml',
    'Dockerfile',
    'docker-compose.yml',
    'Makefile',
    '.env.production',
    '.eslintrc',
    '.prettierrc.json',
    'deploy/values.yaml',
  ])('%s → wiring', (path) => {
    expect(classifyPath(path)).toBe('wiring');
  });

  it('attributes a CI yaml by its directory, not by being a yaml', () => {
    // The by-extension catch-all is last inside the wiring block precisely so
    // this reads as CI wiring rather than as an anonymous config file. Both are
    // `wiring`, so the assertion that carries the ordering is the one below.
    expect(classifyPath('.github/workflows/release.yml')).toBe('wiring');
    expect(classifyPath('deploy/k8s/ingress.yaml')).toBe('wiring');
  });

  it('leaves a constants file as core, because a reviewer must read the numbers', () => {
    expect(classifyPath('src/modules/smart-diff/constants.ts')).toBe('core');
  });
});

describe('classifyPath — boilerplate', () => {
  it.each([
    'dist/main.js',
    'build/index.js',
    'coverage/lcov.info',
    'client/.next/static/chunk.js',
    'src/generated/client.ts',
    'src/db/migrations/0001_init.sql',
    'db/migration/002.sql',
    'src/api.gen.ts',
    'proto/service.pb.go',
    'gen/service_pb2.py',
    'public/app.min.js',
    'public/app.js.map',
    'src/types/global.d.ts',
    'src/__snapshots__/view.tsx.snap',
    'src/view.test.tsx',
    'server/test/helpers/pg.ts',
    'e2e/specs/01-boot.flow.json',
    'cypress/e2e/login.cy.ts',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'requirements.txt',
    'README.md',
    'docs/guide.mdx',
    'LICENSE',
    'CHANGELOG.md',
    'CODEOWNERS',
  ])('%s → boilerplate', (path) => {
    expect(classifyPath(path)).toBe('boilerplate');
  });

  it('classifies build output ahead of the entry-point rule', () => {
    // `dist/main.js` matches BOTH block 1 and the wiring `main.*` rule. Block
    // order is what decides it, and generated output is never an entry point a
    // reviewer should read.
    expect(classifyPath('dist/main.js')).toBe('boilerplate');
    expect(classifyPath('build/server.js')).toBe('boilerplate');
  });
});

describe('classifyPath — the default', () => {
  it.each([
    'src/middleware/ratelimit.ts',
    'lib/foo.rb',
    'internal/billing/invoice.go',
    'app/models/user.rb',
    'Something.kt',
    'src/deeply/nested/unknown-thing',
  ])('%s → core, because an unrecognised path is the substance until proven otherwise', (path) => {
    expect(classifyPath(path)).toBe('core');
  });
});

describe('normalizePath', () => {
  it('folds the separators and prefixes a path can arrive with', () => {
    for (const raw of ['src/config.ts', './src/config.ts', '/src/config.ts', 'src\\config.ts', '  src/config.ts  ']) {
      expect(normalizePath(raw), raw).toBe('src/config.ts');
      // …and therefore the role is the same whichever form arrived.
      expect(classifyPath(raw), raw).toBe('wiring');
    }
  });
});
