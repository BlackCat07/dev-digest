import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitHubClient } from '@devdigest/shared';
import {
  collectSources,
  type CollectedSources,
  type IntentDeps,
  type IntentPrFile,
  type IntentPull,
  type IntentRepoRef,
  type IntentStore,
} from '../src/modules/intent/sources.js';
import { ConfinedRepoDocReader } from '../src/adapters/git/confined-doc.js';

/**
 * L03 — what the classifier is allowed to see, over a REAL directory on disk.
 *
 * The two rules under test are the two a hostile PR description attacks, and
 * both of them are one boolean away from being no rules at all:
 *
 *  1. **Path confinement.** A document path comes out of an author-controlled
 *     description, so `../`, a symlink pointing out of the clone and a
 *     non-regular file must each end as an `unfetched` source with NO read
 *     attempted. Every case below therefore plants real bytes outside the clone
 *     and asserts they never appear in a block — asserting only the `status`
 *     would still pass if the file were read and then discarded.
 *  2. **Redaction.** A recorded URL is origin + path only. A query string can
 *     carry a credential, and this string is written to a database row and
 *     rendered on a card.
 *
 * A real temp tree rather than a mocked `fs`: the confinement's whole job is what
 * the filesystem answers — `realpath` following a symlink out of the tree is
 * exactly the case a stubbed reader cannot show. The confinement itself now lives
 * in `adapters/git/confined-doc.ts` (`ConfinedRepoDocReader`), injected as the
 * `repoDocs` port, and these cases drive the real adapter through
 * `collectSources` so both halves stay covered by one assertion.
 */

const REPO: IntentRepoRef = { owner: 'acme', name: 'payments-api' };

function pullWith(body: string): IntentPull {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    repoId: '22222222-2222-4222-8222-222222222222',
    number: 7,
    title: 'Add rate limiting',
    body,
    headSha: 'a1b2c3d4',
  };
}

/**
 * Only `getPrFiles` is reachable from `collectSources`; the rest throw rather
 * than return an empty value, so a future call that starts using one is a loud
 * failure instead of a silently-empty source list.
 */
function store(files: IntentPrFile[]): IntentStore {
  const unreachable = (name: string) => async (): Promise<never> => {
    throw new Error(`IntentStore.${name} must not be reached by collectSources`);
  };
  return {
    getPull: unreachable('getPull'),
    getRepo: unreachable('getRepo'),
    getPrFiles: async () => files,
    getIntent: unreachable('getIntent'),
    markIntentRunning: unreachable('markIntentRunning'),
    upsertIntent: unreachable('upsertIntent'),
    failIntent: unreachable('failIntent'),
  };
}

function depsFor(root: string, opts: { files?: IntentPrFile[]; github?: () => Promise<GitHubClient> } = {}): IntentDeps {
  return {
    reviewRepo: store(opts.files ?? []),
    github:
      opts.github ??
      (async () => {
        throw new Error('GitHub must not be reached for a body with no issue reference');
      }),
    // The REAL adapter, over a real temp tree: the confinement under test is
    // what the filesystem answers — `realpath` following a symlink out of the
    // clone is exactly the case a stubbed reader cannot show. Only the clone
    // location is faked.
    repoDocs: new ConfinedRepoDocReader({ clonePathFor: () => root }),
    featureModel: async () => {
      throw new Error('the feature-model resolver must not be reached while collecting sources');
    },
    llm: async () => {
      throw new Error('the LLM must not be reached while collecting sources');
    },
    jobs: {
      enqueue: async () => {
        throw new Error('the job queue must not be reached while collecting sources');
      },
    },
  };
}

/** Everything that reached the prompt, as one string. */
function promptText(collected: CollectedSources): string {
  return collected.blocks.map((b) => `${b.heading}\n${b.text}`).join('\n\n');
}

function docSources(collected: CollectedSources) {
  return collected.sources.filter((s) => s.kind === 'repo_doc');
}

describe('collectSources — path confinement', () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'intent-sources-'));
    root = join(base, 'clone');
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'plan.md'), 'PLAN BODY — the design of the limiter.');
    // Real bytes OUTSIDE the clone. No test below may ever surface them.
    await writeFile(join(base, 'outside-secret.txt'), 'OUTSIDE SECRET');
    // A symlink that lives inside the clone and points out of it.
    await symlink(join(base, 'outside-secret.txt'), join(root, 'escape.md'));
    // A directory wearing a document extension.
    await mkdir(join(root, 'notes.md'));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('reads a document that really is inside the clone', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('The design is written up in docs/plan.md.'),
      REPO,
    );

    expect(docSources(collected)).toEqual([
      expect.objectContaining({ ref: 'docs/plan.md', status: 'used' }),
    ]);
    expect(promptText(collected)).toContain('PLAN BODY');
  });

  it('refuses a candidate that escapes the clone, without reading it', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('Context is in ../outside-secret.txt and ../../etc/passwd.txt.'),
      REPO,
    );

    expect(docSources(collected)).toEqual([
      {
        kind: 'repo_doc',
        ref: '../outside-secret.txt',
        status: 'unfetched',
        // null, not 0: nothing was read, and a size would imply otherwise.
        chars: null,
        note: 'outside the repository',
      },
      {
        kind: 'repo_doc',
        ref: '../../etc/passwd.txt',
        status: 'unfetched',
        chars: null,
        note: 'outside the repository',
      },
    ]);
    // The bytes exist and are readable — the confinement is what kept them out.
    expect(promptText(collected)).not.toContain('OUTSIDE SECRET');
    expect(promptText(collected)).not.toContain('Repository document');
  });

  it('refuses a symlink pointing out of the clone, after realpath', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('See escape.md for the plan.'),
      REPO,
    );

    // `path.resolve` alone accepts this one — it is INSIDE the root until the
    // symlink is followed. Only the post-realpath re-check refuses it.
    expect(docSources(collected)).toEqual([
      expect.objectContaining({
        ref: 'escape.md',
        status: 'unfetched',
        note: 'outside the repository',
      }),
    ]);
    expect(promptText(collected)).not.toContain('OUTSIDE SECRET');
  });

  it('refuses a candidate that is not a regular file', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('Everything is in notes.md.'),
      REPO,
    );

    expect(docSources(collected)).toEqual([
      expect.objectContaining({ ref: 'notes.md', status: 'unfetched', note: 'not a regular file' }),
    ]);
  });

  it('records a missing document as unfetched rather than inventing it', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('Implements docs/never-written.md.'),
      REPO,
    );

    expect(docSources(collected)).toEqual([
      expect.objectContaining({
        ref: 'docs/never-written.md',
        status: 'unfetched',
        note: 'no such file in the repository',
      }),
    ]);
  });

  /**
   * The absolute-path branch of `resolveInClone` is defence in depth: `DOC_REF`
   * cannot capture a leading `/` (its first character class is `[\w.-]`), so an
   * absolute path is refused one stage EARLIER, by never becoming a candidate at
   * all. Asserted here rather than in `resolveInClone`, which is not exported —
   * and asserted as "no source of that kind", because a `/etc/...` entry
   * appearing as `unfetched` would mean the extractor started accepting them.
   */
  it('never treats an absolute path as a document candidate', async () => {
    const collected = await collectSources(
      depsFor(root),
      'ws',
      pullWith('The values live at /etc/passwd.txt on the host.'),
      REPO,
    );

    expect(docSources(collected)).toEqual([]);
    // No fetch block either — the standard three are all that was assembled.
    expect(collected.blocks.map((b) => b.label)).toEqual(['pr:title', 'pr:body', 'facts']);
  });
});

describe('collectSources — link redaction', () => {
  it('records an external link as origin + path, dropping the query string and fragment', async () => {
    const collected = await collectSources(
      depsFor('/nonexistent/clone'),
      'ws',
      pullWith('Tracked in https://jira.example.com/browse/X-1?token=abc#worklog'),
      REPO,
    );

    const links = collected.sources.filter((s) => s.kind === 'unfetched_link');
    expect(links).toHaveLength(1);
    expect(links[0]!.ref).toBe('https://jira.example.com/browse/X-1');
    // The two things a recorded URL may never carry into a DB row or a card.
    expect(links[0]!.ref).not.toContain('token=abc');
    expect(links[0]!.ref).not.toContain('worklog');
    expect(links[0]!.status).toBe('unfetched');
    // And nothing was dereferenced: no fetch block joined the standard three.
    // (The URL itself is still inside the description block — that is the
    // author's own text, and redaction is about what we RECORD, not about
    // rewriting what they wrote.)
    expect(collected.blocks.map((b) => b.label)).toEqual(['pr:title', 'pr:body', 'facts']);
  });
});
