import { describe, it, expect } from 'vitest';
import { ProjectDocList } from '@devdigest/shared';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type {
  ProjectContextDeps,
  ProjectContextDocReader,
  ProjectContextStore,
} from '../src/modules/project-context/types.js';

/**
 * L05 — the service that lists a repository's documents and stores an owner's
 * attachments.
 *
 * Hermetic by name and by construction: no Postgres, no clone, no queue, no
 * provider. Docker is not authorised on this run, so the DB-backed half of
 * AC-13/AC-15/AC-16 — the transaction, the composite primary key, the cascade —
 * is deliberately NOT claimed here; what these cases prove is the CALL SHAPE the
 * service asks the store for.
 *
 * Four choices carry more than their length:
 *
 *  - **Every store method throws until a case opts in**, the shape
 *    `blast-service.test.ts` set. An edit that starts walking the clone before
 *    the workspace check fails loudly here instead of silently succeeding.
 *  - **The deps sit behind a `Proxy` that throws on any key but the two ports.**
 *    AC-24 ("no model call") and AC-27 ("no background job") are then measured
 *    rather than asserted in prose: reaching for `jobs`, `llm` or `db` is a test
 *    failure.
 *  - **`ProjectDocList.parse` on the assembled envelope.** No route in this
 *    server declares a `response:` schema, so the contract is otherwise a
 *    compile-time claim only — and this codebase has already shipped a
 *    cast-not-parsed response that reached the client as `$NaN`
 *    (`server/INSIGHTS.md`, 2026-08-02).
 *  - **The token fixture is multi-byte on purpose.** A document of ten `á`
 *    characters is twenty bytes; `ceil(chars/4)` is 3 and `ceil(bytes/4)` is 5,
 *    so the assertion distinguishes AC-4's rule from the cheaper one that reads
 *    the same for ASCII (EC-16).
 */

const WORKSPACE = 'ws-1';
const OTHER_WORKSPACE = 'ws-2';
const REPO = 'repo-1';
const AGENT = 'agent-1';
const SKILL = 'skill-1';

const REPO_ROW = {
  id: REPO,
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  clonePath: '/clones/acme/payments-api',
};

/** Ten multi-byte characters: 10 chars, 20 bytes — see the file doc-comment. */
const MULTIBYTE_DOC = 'á'.repeat(10);

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

/** A store whose every method throws until the case opts in to it. */
function store(over: Partial<ProjectContextStore> = {}): ProjectContextStore {
  return {
    getContextRootsSetting: unreachable('getContextRootsSetting'),
    getRepo: unreachable('getRepo'),
    getRepoById: unreachable('getRepoById'),
    agentExists: unreachable('agentExists'),
    skillExists: unreachable('skillExists'),
    listAgentAttachments: unreachable('listAgentAttachments'),
    listSkillAttachments: unreachable('listSkillAttachments'),
    listInheritedAttachments: unreachable('listInheritedAttachments'),
    setAgentAttachments: unreachable('setAgentAttachments'),
    setSkillAttachments: unreachable('setSkillAttachments'),
    countAgentsByPath: unreachable('countAgentsByPath'),
    repoNames: unreachable('repoNames'),
    ...over,
  };
}

/** A document reader whose every method throws until the case opts in to it. */
function reader(over: Partial<ProjectContextDocReader> = {}): ProjectContextDocReader {
  return {
    read: unreachable('repoDocs.read'),
    list: unreachable('repoDocs.list'),
    ...over,
  };
}

/**
 * Deps behind a `Proxy` that throws on any key other than the two ports.
 *
 * This is the "structurally incapable of a model call or a job" claim, enforced.
 */
function deps(value: ProjectContextDeps): ProjectContextDeps {
  return new Proxy(value, {
    get(target, prop) {
      if (prop === 'store') return target.store;
      if (prop === 'repoDocs') return target.repoDocs;
      // A symbol lookup is a runtime formality (`Symbol.toStringTag` and
      // friends), never the service asking for a capability.
      if (typeof prop === 'symbol') return undefined;
      throw new Error(`the service reached for \`${prop}\`, which it must not have`);
    },
  });
}

describe('ProjectContextService — the document list', () => {
  it('answers the envelope, one counting rule, and the agent count — with no write anywhere', async () => {
    const calls: string[] = [];
    const service = new ProjectContextService(
      deps({
        store: store({
          getRepo: async (ws, id) => {
            calls.push('getRepo');
            return ws === WORKSPACE && id === REPO ? REPO_ROW : undefined;
          },
          getContextRootsSetting: async () => {
            calls.push('getContextRootsSetting');
            // Nothing has ever validated this key — it rides the settings
            // `passthrough()`. A garbage value must fall back, not throw.
            return { not: 'an array of roots' };
          },
          countAgentsByPath: async () => {
            calls.push('countAgentsByPath');
            return new Map([['specs/api.md', 3]]);
          },
        }),
        repoDocs: reader({
          list: async (repo, options) => {
            calls.push('list');
            expect(repo).toEqual({ owner: 'acme', name: 'payments-api' });
            // AC-2: no configured roots (the garbage above), so the defaults.
            expect(options.roots).toEqual(['specs/', 'docs/', 'insights/']);
            // AC-7 is the adapter's to enforce, but the nine names are ours to
            // pass — including `.pnpm-store`, which no existing list carries.
            expect(options.excludedDirs).toContain('.pnpm-store');
            expect(options.limit).toBe(500);
            return {
              ok: true,
              docs: [
                {
                  path: 'docs/architecture.md',
                  size: 20,
                  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
                },
                { path: 'specs/api.md', size: 8, updatedAt: null },
                { path: 'pkg/INSIGHTS.md', size: 12, updatedAt: null },
              ],
              total: 3,
              truncated: false,
              entryBudgetExhausted: false,
            };
          },
          read: async (_repo, candidate) => {
            calls.push(`read:${candidate}`);
            if (candidate === 'docs/architecture.md') return { ok: true, text: MULTIBYTE_DOC };
            if (candidate === 'specs/api.md') return { ok: true, text: 'abcdefgh' };
            return { ok: true, text: 'x'.repeat(12) };
          },
        }),
      }),
    );

    const list = await service.listDocs(WORKSPACE, REPO);

    // The response is the contract, parsed rather than asserted field by field.
    expect(() => ProjectDocList.parse(list)).not.toThrow();

    // AC-12: the workspace lookup is the FIRST read the handler performs.
    expect(calls[0]).toBe('getRepo');

    expect(list.status).toBe('ok');
    expect(list.reason).toBeNull();
    expect(list.total).toBe(3);
    expect(list.truncated).toBe(false);
    expect(list.roots).toEqual(['specs/', 'docs/', 'insights/']);

    // AC-3: five keys per entry, and only the timestamp may be null. AC-33's
    // grouping label comes from the root, including the `INSIGHTS.md` matched
    // outside every root (EC-1).
    expect(list.docs.map((d) => [d.path, d.root, d.doc_type])).toEqual([
      ['docs/architecture.md', 'docs/', 'doc'],
      ['specs/api.md', 'specs/', 'spec'],
      ['pkg/INSIGHTS.md', 'INSIGHTS.md', 'insight'],
    ]);
    expect(list.docs[0]?.updated_at).toBe('2026-08-01T00:00:00.000Z');
    expect(list.docs[1]?.updated_at).toBeNull();
    expect(list.docs[0]?.size).toBe(20);

    // AC-4: `ceil(characters / 4)`, the same rule the client uses beside a
    // prompt slot. Deriving from the 20 BYTES of the first document would say 5.
    expect(list.docs.map((d) => d.tokens)).toEqual([3, 2, 3]);

    // AC-26: the count is per path, and a document nobody uses reports 0.
    expect(list.docs.map((d) => d.used_by_agents)).toEqual([0, 3, 0]);

    // AC-27: nothing on this path writes or enqueues. Every write method of the
    // store throws, and the deps Proxy throws on `jobs`/`db`/`llm`, so reaching
    // for one would have failed above; this asserts the positive form.
    expect(calls.filter((c) => c.startsWith('set'))).toEqual([]);
  });

  it('answers 200 with an unavailable status when the repository has no clone', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          getRepo: async () => ({ ...REPO_ROW, clonePath: null }),
          getContextRootsSetting: async () => null,
          countAgentsByPath: unreachable('countAgentsByPath'),
        }),
        repoDocs: reader({
          list: async () => ({ ok: false, note: 'the repository has no local clone' }),
        }),
      }),
    );

    // AC-11: not an error. An empty list plus a status is what separates "no
    // documents" from "nothing was searched".
    const list = await service.listDocs(WORKSPACE, REPO);
    expect(list).toEqual({
      docs: [],
      roots: ['specs/', 'docs/', 'insights/'],
      total: 0,
      truncated: false,
      status: 'unavailable',
      reason: 'the repository has no local clone',
    });
  });

  it('reports a capped or budget-stopped walk as partial, naming which', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          getRepo: async () => REPO_ROW,
          getContextRootsSetting: async () => ['specs/'],
          countAgentsByPath: async () => new Map(),
        }),
        repoDocs: reader({
          list: async () => ({
            ok: true,
            docs: [{ path: 'specs/a.md', size: 4, updatedAt: null }],
            total: 501,
            truncated: true,
            // The only signal the 20 000-entry budget was spent; ignoring it
            // makes a walk that stopped early look complete.
            entryBudgetExhausted: true,
          }),
          read: async () => ({ ok: true, text: 'abcd' }),
        }),
      }),
    );

    const list = await service.listDocs(WORKSPACE, REPO);
    expect(list.status).toBe('partial');
    expect(list.total).toBe(501);
    expect(list.reason).toContain('501');
    expect(list.reason).toContain('directory entries');
  });

  it('404s a repository outside the caller workspace before touching the clone', async () => {
    const service = new ProjectContextService(
      deps({
        // Every other method throws, so a filesystem read before the workspace
        // check is a failure rather than a silent success.
        store: store({ getRepo: async () => undefined }),
        repoDocs: reader(),
      }),
    );

    // AC-12: the same id answers 200 for its own workspace (the first case) and
    // 404 for another.
    await expect(service.listDocs(OTHER_WORKSPACE, REPO)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProjectContextService — one document', () => {
  it('answers the full text, and a refusal as a value rather than a throw', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({ getRepo: async () => REPO_ROW }),
        repoDocs: reader({
          read: async (_repo, candidate) =>
            candidate === 'specs/api.md'
              ? { ok: true, text: '# API\n\nbody\n' }
              : { ok: false, note: 'outside the repository' },
        }),
      }),
    );

    // AC-9: byte-equal to the file on disk.
    const doc = await service.readDoc(WORKSPACE, REPO, 'specs/api.md');
    expect(doc.content).toBe('# API\n\nbody\n');
    expect(doc.size).toBe(12);
    expect(doc.reason).toBeNull();

    // AC-10: a traversal attempt is a 200 carrying the reason, and the process
    // stays up — the refusal never becomes an exception.
    const refused = await service.readDoc(WORKSPACE, REPO, '../../../etc/passwd');
    expect(refused.content).toBeNull();
    expect(refused.reason).toBe('outside the repository');
  });
});

describe('ProjectContextService — attachments', () => {
  it('replaces an agent set for one repository, in the order received', async () => {
    const written: Array<{ agentId: string; repoId: string; paths: string[] }> = [];
    let rows = [
      { repoId: REPO, path: 'specs/a.md', order: 0 },
      { repoId: REPO, path: 'specs/b.md', order: 1 },
    ];

    const service = new ProjectContextService(
      deps({
        store: store({
          agentExists: async (ws, id) => ws === WORKSPACE && id === AGENT,
          getRepo: async () => REPO_ROW,
          setAgentAttachments: async (agentId, repoId, paths) => {
            written.push({ agentId, repoId, paths });
            rows = paths.map((path, order) => ({ repoId, path, order }));
          },
          listAgentAttachments: async () => rows,
        }),
        repoDocs: reader(),
      }),
    );

    // AC-13: the body is the COMPLETE ordered list, and re-reading returns it.
    // A duplicate is dropped rather than sent twice — the composite primary key
    // (owner, repo, path) would otherwise turn a reorder into a 500.
    const after = await service.setAgentDocs(WORKSPACE, AGENT, {
      repo_id: REPO,
      paths: ['specs/b.md', 'specs/a.md', 'specs/b.md'],
    });

    expect(written).toEqual([
      { agentId: AGENT, repoId: REPO, paths: ['specs/b.md', 'specs/a.md'] },
    ]);
    expect(after.map((a) => a.path)).toEqual(['specs/b.md', 'specs/a.md']);
    expect(after.map((a) => a.order)).toEqual([0, 1]);
    expect(after[0]?.repo_id).toBe(REPO);

    // AC-16: no version is bumped and no version row is written. The store this
    // service is given has no method that could — every one of its members is
    // listed in `store()` above, and none of them touches `agents.version` or
    // `agent_versions`.
    expect(Object.keys(store())).not.toContain('bumpVersion');
  });

  it('replaces a skill set the same way, and 404s an owner outside the workspace', async () => {
    const written: Array<{ skillId: string; repoId: string; paths: string[] }> = [];
    const service = new ProjectContextService(
      deps({
        store: store({
          skillExists: async (ws, id) => ws === WORKSPACE && id === SKILL,
          getRepo: async () => REPO_ROW,
          setSkillAttachments: async (skillId, repoId, paths) => {
            written.push({ skillId, repoId, paths });
          },
          listSkillAttachments: async () => [{ repoId: REPO, path: 'docs/x.md', order: 0 }],
        }),
        repoDocs: reader(),
      }),
    );

    // AC-15: as AC-13, against a skill.
    const after = await service.setSkillDocs(WORKSPACE, SKILL, {
      repo_id: REPO,
      paths: ['docs/x.md'],
    });
    expect(written).toEqual([{ skillId: SKILL, repoId: REPO, paths: ['docs/x.md'] }]);
    expect(after).toEqual([{ repo_id: REPO, path: 'docs/x.md', order: 0 }]);

    // A skill in another workspace is not merely empty — it does not exist.
    await expect(service.listSkillDocs(OTHER_WORKSPACE, SKILL)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses to attach documents to a repository outside the caller workspace', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          agentExists: async () => true,
          // The repository id in the BODY is client-supplied and is scoped the
          // same way the one in the path is; without this an agent could be
          // pointed at another tenant's repository.
          getRepo: async () => undefined,
          setAgentAttachments: unreachable('setAgentAttachments'),
        }),
        repoDocs: reader(),
      }),
    );

    await expect(
      service.setAgentDocs(WORKSPACE, AGENT, { repo_id: 'repo-elsewhere', paths: ['a.md'] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
