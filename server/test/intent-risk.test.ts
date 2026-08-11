import { describe, it, expect } from 'vitest';
import type { Risk } from '@devdigest/shared';
import { groundRiskAreas } from '../src/modules/intent/risks.js';
import {
  MAX_RISK_AREAS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_TITLE_CHARS,
} from '../src/modules/intent/constants.js';

/**
 * L03 — the evidence gate for risk areas.
 *
 * The classifier is shown file PATHS and `@@` headers, never diff bodies, and
 * "where might this hurt?" is the question it is most tempted to answer with a
 * confident-looking citation. A chip pointing at a file the PR never touched
 * reads as a finding, so it is worse than one fewer chip.
 *
 * Every case below therefore asserts on WHICH refs survived, not merely on the
 * count: dropping the right number of wrong things by accident is not the
 * property under test.
 */

const CHANGED = ['src/middleware/ratelimit.ts', 'src/api/public/webhooks.ts', 'package.json'];

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'security',
    title: 'Auth surface touched',
    explanation: 'The limiter decides who reaches the public API.',
    severity: 'high',
    file_refs: ['src/middleware/ratelimit.ts'],
    ...over,
  };
}

describe('groundRiskAreas — citations', () => {
  it('keeps a reference to a file the PR really changed', () => {
    const [kept] = groundRiskAreas([risk()], CHANGED);
    expect(kept?.file_refs).toEqual(['src/middleware/ratelimit.ts']);
  });

  it('keeps a `path:lines` reference, matching on the path and preserving the suffix', () => {
    // The model is asked for bare paths and routinely appends a line range
    // anyway. Rejecting those would drop almost every true reference.
    const [kept] = groundRiskAreas(
      [risk({ file_refs: ['src/middleware/ratelimit.ts:12-18'] })],
      CHANGED,
    );
    expect(kept?.file_refs).toEqual(['src/middleware/ratelimit.ts:12-18']);
  });

  it('drops an invented reference while keeping the real sibling', () => {
    const [kept] = groundRiskAreas(
      [risk({ file_refs: ['src/does/not/exist.ts', 'src/api/public/webhooks.ts'] })],
      CHANGED,
    );
    expect(kept?.file_refs).toEqual(['src/api/public/webhooks.ts']);
  });

  it('drops the whole risk when every reference it offered was invented', () => {
    // It cited files and got all of them wrong, so it has not shown it can locate
    // anything — there is nothing left of the claim to trust.
    expect(
      groundRiskAreas([risk({ file_refs: ['a.ts', 'b.ts'] })], CHANGED),
    ).toEqual([]);
  });

  it('keeps a risk that cites nothing at all', () => {
    // A whole-PR observation ("the auth surface is touched") is legitimate and
    // the model was never required to cite. Only a WRONG citation is fatal.
    const kept = groundRiskAreas([risk({ file_refs: [] })], CHANGED);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.file_refs).toEqual([]);
  });

  it('drops every risk when the PR has no changed files at all', () => {
    expect(groundRiskAreas([risk()], [])).toEqual([]);
  });
});

describe('groundRiskAreas — bounds and hygiene', () => {
  it('caps the reference list per risk', () => {
    const many = Array.from({ length: MAX_RISK_FILE_REFS + 3 }, () => CHANGED[0]!);
    const [kept] = groundRiskAreas([risk({ file_refs: many })], CHANGED);
    expect(kept?.file_refs).toHaveLength(MAX_RISK_FILE_REFS);
  });

  it('caps the number of risks', () => {
    const lots = Array.from({ length: MAX_RISK_AREAS + 4 }, (_, i) =>
      risk({ title: `Risk ${i}` }),
    );
    expect(groundRiskAreas(lots, CHANGED)).toHaveLength(MAX_RISK_AREAS);
  });

  it('truncates an over-long title and explanation instead of dropping the risk', () => {
    const [kept] = groundRiskAreas(
      [risk({ title: 'T'.repeat(MAX_RISK_TITLE_CHARS + 50), explanation: 'E'.repeat(MAX_RISK_EXPLANATION_CHARS + 200) })],
      CHANGED,
    );
    expect(kept?.title).toHaveLength(MAX_RISK_TITLE_CHARS);
    expect(kept?.explanation).toHaveLength(MAX_RISK_EXPLANATION_CHARS);
  });

  it('drops a risk with no usable title — an unlabelled chip cannot be rendered', () => {
    expect(groundRiskAreas([risk({ title: '   ' })], CHANGED)).toEqual([]);
  });

  it('preserves kind and severity verbatim, including a kind outside the classifier enum', () => {
    // The stored contract's `kind` is an open string on purpose; grounding is
    // about evidence, not about policing the vocabulary.
    const [kept] = groundRiskAreas(
      [risk({ kind: 'quantum_entanglement', severity: 'medium' })],
      CHANGED,
    );
    expect(kept?.kind).toBe('quantum_entanglement');
    expect(kept?.severity).toBe('medium');
  });

  it('does not mutate its input', () => {
    const input = [risk({ file_refs: ['src/does/not/exist.ts', 'package.json'] })];
    const snapshot = structuredClone(input);
    groundRiskAreas(input, CHANGED);
    expect(input).toEqual(snapshot);
  });

  it('returns an empty list for empty input', () => {
    expect(groundRiskAreas([], CHANGED)).toEqual([]);
  });
});

describe('groundRiskAreas — kind inferred from the cited paths', () => {
  // WHY this exists: the classifier reaches for `other` constantly (measured: all
  // five risks on a 100-file PR), and on the card every `other` draws the same
  // fallback icon, so the chip row stops distinguishing anything. For these
  // categories the PATH is the evidence, and we have the paths, so the kind is
  // corrected deterministically. It only ever upgrades AWAY from `other`.

  it.each([
    ['package.json', 'deps'],
    ['pnpm-lock.yaml', 'deps'],
    ['src/db/migrations/0016_thing.sql', 'db_migration'],
    ['src/middleware/ratelimit.ts', 'security'],
    ['src/api/public/webhooks.ts', 'breaking_api'],
  ])('infers %s → %s', (path, expected) => {
    const [kept] = groundRiskAreas(
      [risk({ kind: 'other', file_refs: [path] })],
      [path],
    );
    expect(kept?.kind).toBe(expected);
  });

  it('never overrides a kind the model chose itself', () => {
    // A definite answer may rest on something in the description that no path
    // reveals; second-guessing it with a regex would be worse than trusting it.
    const [kept] = groundRiskAreas(
      [risk({ kind: 'perf', file_refs: ['package.json'] })],
      ['package.json'],
    );
    expect(kept?.kind).toBe('perf');
  });

  it('leaves `other` alone when no cited path implies a category', () => {
    const [kept] = groundRiskAreas(
      [risk({ kind: 'other', file_refs: ['client/messages/en/skills.json'] })],
      ['client/messages/en/skills.json'],
    );
    expect(kept?.kind).toBe('other');
  });

  it('infers only from GROUNDED paths, so an invented path cannot pick the category', () => {
    // `package.json` was never changed by this PR, so it is dropped before the
    // inference runs and must not turn this into a `deps` risk.
    const [kept] = groundRiskAreas(
      [risk({ kind: 'other', file_refs: ['package.json', 'client/messages/en/a.json'] })],
      ['client/messages/en/a.json'],
    );
    expect(kept?.file_refs).toEqual(['client/messages/en/a.json']);
    expect(kept?.kind).toBe('other');
  });
});
