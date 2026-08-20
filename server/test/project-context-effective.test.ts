import { describe, it, expect } from 'vitest';
import {
  ProjectContextService,
  applyTokenBudget,
  classifyDoc,
  mergeEffectiveAttachments,
} from '../src/modules/project-context/service.js';
import type {
  AttachmentRow,
  InheritedAttachmentRow,
  ProjectContextDeps,
  ProjectContextDocReader,
  ProjectContextStore,
} from '../src/modules/project-context/types.js';

/**
 * L05 — the effective document set of a run, and the token budget applied to it.
 *
 * Both are exported as PURE functions and tested as such, because both are rules
 * about ordering rather than about storage, and neither needs a database to be
 * wrong. Docker is not authorised on this run; a `.it.test.ts` here would be
 * written and never executed.
 *
 * The order under test is AC-19's, in full: the agent's own attachments in their
 * order, then each ENABLED skill's in skill-link order and, within a skill, in
 * that skill's attachment order — deduplicated by path with the first occurrence
 * winning, and restricted to the repository of the pull request under review.
 *
 * The budget under test is AC-23's, and its shape is the requirement rather than
 * an optimisation: skip-and-continue, never stop-at-first-overflow. One
 * oversized document early in the order must not silently discard every smaller
 * one behind it.
 */

const REPO = 'repo-under-review';
const OTHER_REPO = 'repo-elsewhere';

function own(path: string, order: number, repoId = REPO): AttachmentRow {
  return { repoId, path, order };
}

function inherited(
  path: string,
  skill: { id: string; name: string; linkOrder: number; enabled?: boolean },
  order = 0,
  repoId = REPO,
): InheritedAttachmentRow {
  return {
    repoId,
    path,
    order,
    skillId: skill.id,
    skillName: skill.name,
    linkOrder: skill.linkOrder,
    enabled: skill.enabled ?? true,
  };
}

describe('mergeEffectiveAttachments — AC-19', () => {
  it('keeps the agent position for a document its skills also carry', () => {
    const merged = mergeEffectiveAttachments(
      [own('specs/shared.md', 0), own('specs/own.md', 1)],
      [
        inherited('specs/shared.md', { id: 's1', name: 'Security', linkOrder: 0 }),
        inherited('specs/shared.md', { id: 's2', name: 'Style', linkOrder: 1 }),
      ],
      REPO,
    );

    // EC-9: attached to the agent and to two of its skills, present ONCE, at the
    // agent's position, sourced to the agent.
    expect(merged.effective.map((d) => d.path)).toEqual(['specs/shared.md', 'specs/own.md']);
    expect(merged.effective[0]?.source).toEqual({ kind: 'agent' });
    expect(merged.effective.map((d) => d.order)).toEqual([0, 1]);
  });

  it('orders the first-linked skill ahead of the second, and labels each row', () => {
    const merged = mergeEffectiveAttachments(
      [],
      [
        // Deliberately supplied in link order, which is the order the store
        // promises: link order, then skill name, then the document's own order.
        inherited('docs/first-a.md', { id: 's1', name: 'Alpha', linkOrder: 0 }, 0),
        inherited('docs/first-b.md', { id: 's1', name: 'Alpha', linkOrder: 0 }, 1),
        inherited('docs/second.md', { id: 's2', name: 'Beta', linkOrder: 1 }, 0),
      ],
      REPO,
    );

    expect(merged.effective.map((d) => d.path)).toEqual([
      'docs/first-a.md',
      'docs/first-b.md',
      'docs/second.md',
    ]);
    // A row inherited from a skill names it, so the tab can label it and offer
    // neither a detach control nor a drag handle (AC-45).
    expect(merged.effective[2]?.source).toEqual({
      kind: 'skill',
      skill_id: 's2',
      skill_name: 'Beta',
    });
  });

  it('excludes a disabled skill and reports another repository by name-able id', () => {
    const merged = mergeEffectiveAttachments(
      [own('specs/here.md', 0), own('specs/there.md', 0, OTHER_REPO)],
      [
        inherited('docs/off.md', { id: 's3', name: 'Retired', linkOrder: 0, enabled: false }),
        inherited('docs/on.md', { id: 's4', name: 'Active', linkOrder: 1 }),
      ],
      REPO,
    );

    // EC-22: a linked but disabled skill contributes nothing — and it is not
    // reported as a skip either, because nothing about it was attempted.
    expect(merged.effective.map((d) => d.path)).toEqual(['specs/here.md', 'docs/on.md']);

    // EC-8 / AC-22: an attachment naming another repository is skipped, and the
    // repository it belongs to travels with it so the run log can name it.
    expect(merged.foreign).toEqual([{ path: 'specs/there.md', repoId: OTHER_REPO }]);
  });

  it('does not report a foreign attachment whose path arrived from this repository', () => {
    const merged = mergeEffectiveAttachments(
      [own('specs/x.md', 0), own('specs/x.md', 1, OTHER_REPO)],
      [],
      REPO,
    );

    // The document IS in the prompt, so a log line saying it was skipped would
    // contradict its own `specs_read` entry.
    expect(merged.effective.map((d) => d.path)).toEqual(['specs/x.md']);
    expect(merged.foreign).toEqual([]);
  });
});

describe('classifyDoc — AC-1 (amended 2026-08-19), AC-33', () => {
  const ROOTS = ['specs/', 'docs/', 'insights/'];

  it('groups a per-package document under the root it was found in, not its package', () => {
    // The walk matches a root at any depth; this has to agree with it, or a
    // document the walk listed would report a root it was not found under.
    expect(classifyDoc('specs/public-api.md', ROOTS)).toEqual({
      root: 'specs/',
      doc_type: 'spec',
    });
    expect(classifyDoc('server/specs/README.md', ROOTS)).toEqual({
      root: 'specs/',
      doc_type: 'spec',
    });
    expect(classifyDoc('client/docs/deep/note.md', ROOTS)).toEqual({
      root: 'docs/',
      doc_type: 'doc',
    });
  });

  it('does not treat a directory that merely contains a root name as that root', () => {
    // `myspecs/` is not `specs/`. Falling through to the filename rule is the
    // correct outcome, not a match on the nearest-looking root.
    expect(classifyDoc('myspecs/a.md', ROOTS).root).not.toBe('specs/');
    expect(classifyDoc('a/specsuite/b.md', ROOTS).root).not.toBe('specs/');
  });

  it('reports an INSIGHTS.md outside every root as its own group', () => {
    // EC-1: this repository keeps insights at each package root rather than in
    // an `insights/` directory, so this is the normal case here.
    expect(classifyDoc('server/INSIGHTS.md', ROOTS)).toEqual({
      root: 'INSIGHTS.md',
      doc_type: 'insight',
    });
  });
});

describe('applyTokenBudget — AC-23', () => {
  it('skips the document that would overflow and continues with the rest', () => {
    const { kept, skipped } = applyTokenBudget(
      [
        { path: 'a.md', text: 'a', tokens: 60 },
        { path: 'b.md', text: 'b', tokens: 60 },
        { path: 'c.md', text: 'c', tokens: 10 },
      ],
      100,
    );

    // The spec's own observable: 60 / 60 / 10 against 100 carries the first and
    // the THIRD. Stop-at-first-overflow would drop `c.md` for no reason.
    expect(kept.map((d) => d.path)).toEqual(['a.md', 'c.md']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.path).toBe('b.md');
    expect(skipped[0]?.reason).toContain('100');
  });

  it('keeps a document that exactly fills the budget', () => {
    const { kept, skipped } = applyTokenBudget([{ path: 'a.md', text: 'a', tokens: 100 }], 100);
    expect(kept.map((d) => d.path)).toEqual(['a.md']);
    expect(skipped).toEqual([]);
  });
});

/* ─── the same rules, seen through the service the executor calls ─────────── */

function unreachable(name: string) {
  return (): never => {
    throw new Error(`${name} must not be reached in this case`);
  };
}

function store(over: Partial<ProjectContextStore>): ProjectContextStore {
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

function reader(over: Partial<ProjectContextDocReader>): ProjectContextDocReader {
  return { read: unreachable('read'), list: unreachable('list'), ...over };
}

function deps(value: ProjectContextDeps): ProjectContextDeps {
  return value;
}

describe('ProjectContextService.resolveForRun', () => {
  it('returns raw text with its paths, and every skip with its reason', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          listAgentAttachments: async () => [
            own('specs/present.md', 0),
            own('specs/gone.md', 1),
            own('specs/elsewhere.md', 2, OTHER_REPO),
          ],
          listInheritedAttachments: async () => [],
          getRepoById: async () => ({
            id: REPO,
            owner: 'acme',
            name: 'payments-api',
            fullName: 'acme/payments-api',
            clonePath: '/clones/acme/payments-api',
          }),
          repoNames: async (ids) => {
            expect(ids).toEqual([OTHER_REPO]);
            return [{ repoId: OTHER_REPO, fullName: 'acme/billing' }];
          },
        }),
        repoDocs: reader({
          read: async (_repo, candidate) =>
            candidate === 'specs/present.md'
              ? { ok: true, text: 'the text' }
              : { ok: false, note: 'no such file in the repository' },
        }),
      }),
    );

    const resolved = await service.resolveForRun('agent-1', REPO);

    // AC-20: `paths` is exactly what reached the prompt, index-aligned with the
    // text, so `specs_read` cannot drift from the assembled block.
    expect(resolved.paths).toEqual(['specs/present.md']);
    // AC-18: raw and unwrapped — the engine wraps this slot itself. A
    // `<untrusted` here would double-wrap.
    expect(resolved.texts).toEqual(['the text']);
    expect(resolved.texts[0]).not.toContain('<untrusted');

    // AC-21 / AC-22: the run keeps going, and every absence is explained by path
    // and reason — the cross-repository one naming the repository it belongs to,
    // so a document silently missing from a review is never indistinguishable
    // from one that was never attached.
    const byPath = Object.fromEntries(resolved.skipped.map((s) => [s.path, s.reason]));
    expect(Object.keys(byPath).sort()).toEqual(['specs/elsewhere.md', 'specs/gone.md']);
    expect(byPath['specs/elsewhere.md']).toContain('acme/billing');
    expect(byPath['specs/gone.md']).toBe('no such file in the repository');
  });

  it('resolves to nothing, and reads nothing, when the agent has no attachments', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          listAgentAttachments: async () => [],
          listInheritedAttachments: async () => [],
          // Not even the repository is looked up: with no attachments there is
          // nothing to read, which is what makes AC-25's byte-identical prompt
          // cheap as well as true.
          getRepoById: unreachable('getRepoById'),
        }),
        repoDocs: reader({}),
      }),
    );

    expect(await service.resolveForRun('agent-1', REPO)).toEqual({
      texts: [],
      paths: [],
      skipped: [],
      tokens: 0,
    });
  });
});

/* ─── the same set as metadata, for a caller that must read no bytes ─────── */

/**
 * One agent's attachments, shared by every case below so the two methods are
 * compared over identical input rather than over two hand-written fixtures.
 *
 * It carries every rule at once: a document attached directly AND through a
 * skill, a second document from that same skill, a document from a DISABLED
 * skill, and one belonging to another repository.
 */
const OWN_ROWS: AttachmentRow[] = [
  own('specs/shared.md', 0),
  own('specs/own.md', 1),
  own('specs/elsewhere.md', 2, OTHER_REPO),
];

const INHERITED_ROWS: InheritedAttachmentRow[] = [
  inherited('specs/shared.md', { id: 's1', name: 'Security', linkOrder: 0 }, 0),
  inherited('docs/from-skill.md', { id: 's1', name: 'Security', linkOrder: 0 }, 1),
  inherited('specs/shared.md', { id: 's2', name: 'Style', linkOrder: 1 }, 0),
  inherited('docs/off.md', { id: 's3', name: 'Retired', linkOrder: 2, enabled: false }, 0),
];

describe('ProjectContextService.listEffectiveDocs', () => {
  it('answers the same paths in the same order as resolveForRun', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          listAgentAttachments: async () => OWN_ROWS,
          listInheritedAttachments: async () => INHERITED_ROWS,
          getRepoById: async () => ({
            id: REPO,
            owner: 'acme',
            name: 'payments-api',
            fullName: 'acme/payments-api',
            clonePath: '/clones/acme/payments-api',
          }),
          repoNames: async () => [{ repoId: OTHER_REPO, fullName: 'acme/billing' }],
        }),
        // Every document reads cleanly, so `resolveForRun` drops nothing and the
        // two answers are comparable: the metadata set is what a run WOULD
        // attempt, and here the clone refuses none of it.
        repoDocs: reader({ read: async () => ({ ok: true, text: 'body' }) }),
      }),
    );

    const listed = await service.listEffectiveDocs('agent-1', REPO);
    const resolved = await service.resolveForRun('agent-1', REPO);

    // One definition of "effective set", asserted as an equality rather than as
    // two expected literals — a second definition would show up here first.
    expect(listed.map((d) => d.path)).toEqual(resolved.paths);
    expect(listed.map((d) => d.path)).toEqual([
      'specs/shared.md',
      'specs/own.md',
      'docs/from-skill.md',
    ]);
  });

  it('reads no document, and resolves no clone, to produce the set', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          listAgentAttachments: async () => OWN_ROWS,
          listInheritedAttachments: async () => INHERITED_ROWS,
          // Left unreachable on purpose: naming a repository is a run-log
          // concern, and this path resolves no clone at all.
        }),
        // The only way to prove a negative here. `reader({})` throws on both
        // `read` and `list`, so a single byte read anywhere below fails the test
        // with the name of the method that reached for it.
        repoDocs: reader({}),
      }),
    );

    const listed = await service.listEffectiveDocs('agent-1', REPO);

    // Dedup: attached directly and through two skills, present ONCE, at the
    // agent's position and sourced to the agent.
    expect(listed.map((d) => d.path)).toEqual([
      'specs/shared.md',
      'specs/own.md',
      'docs/from-skill.md',
    ]);
    expect(listed[0]?.source).toEqual({ kind: 'agent' });
    expect(listed[2]?.source).toEqual({ kind: 'skill', skill_id: 's1', skill_name: 'Security' });
    // The order is positional and gap-free, so a consumer can fingerprint the
    // set from `path` and `order` alone.
    expect(listed.map((d) => d.order)).toEqual([0, 1, 2]);

    // A disabled skill contributes nothing, and another repository's attachment
    // is not this repository's document.
    const paths = listed.map((d) => d.path);
    expect(paths).not.toContain('docs/off.md');
    expect(paths).not.toContain('specs/elsewhere.md');
  });

  it('answers an empty set for an agent with no attachments', async () => {
    const service = new ProjectContextService(
      deps({
        store: store({
          listAgentAttachments: async () => [],
          listInheritedAttachments: async () => [],
        }),
        repoDocs: reader({}),
      }),
    );

    expect(await service.listEffectiveDocs('agent-1', REPO)).toEqual([]);
  });
});
