/**
 * applyScopeGuard — the deterministic scope floor, as a unit.
 *
 * Two properties are pinned here and they are the whole reason the guard exists:
 *
 *  1. the FLOOR — a CRITICAL finding, or a finding from a full-file scanner,
 *     cannot be labelled `out_of_scope`, so no UI filter can hide it;
 *  2. MEMBERSHIP — the guard mutates labels and only labels. Same count, same
 *     order, nothing dropped, and the caller's array and objects untouched.
 *     That is what makes running it a no-op for the grounding summary and for
 *     every score derived from these findings.
 *
 * Whether the guard runs at all is the caller's decision (no intent ⇒ it is not
 * applied); that half is pinned in `run.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, FindingKind, Severity } from '@devdigest/shared';
import { FULL_FILE_KINDS } from '../src/grounding.js';
import { applyScopeGuard } from '../src/review/scope.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    rationale: 'because',
    confidence: 0.8,
    kind: 'finding',
    ...over,
  };
}

const SEVERITIES: Severity[] = ['CRITICAL', 'WARNING', 'SUGGESTION'];

describe('applyScopeGuard — the deterministic floor', () => {
  it('forces a CRITICAL back to in_scope even when the model said out_of_scope', () => {
    const input = [finding({ severity: 'CRITICAL', scope: 'out_of_scope' })];
    const out = applyScopeGuard(input);

    expect(out.findings[0]!.scope).toBe('in_scope');
    expect(out.forced).toBe(1);
    expect(out.inScope).toBe(1);
    expect(out.outOfScope).toBe(0);
  });

  it('forces every full-file kind to in_scope at any severity', () => {
    // The list is read from the ONE definition the grounding gate uses, so a
    // new full-file kind cannot be added there and silently skipped here.
    expect([...FULL_FILE_KINDS].sort()).toEqual([
      'hook',
      'lethal_trifecta',
      'phantom',
      'secret_leak',
    ]);

    for (const kind of ['secret_leak', 'lethal_trifecta', 'phantom', 'hook'] as FindingKind[]) {
      for (const severity of SEVERITIES) {
        const out = applyScopeGuard([finding({ kind, severity, scope: 'out_of_scope' })]);
        expect(out.findings[0]!.scope, `${kind} / ${severity}`).toBe('in_scope');
        expect(out.forced, `${kind} / ${severity}`).toBe(1);
      }
    }
  });

  it("keeps the model's out_of_scope label on a WARNING the floor does not own", () => {
    const out = applyScopeGuard([finding({ severity: 'WARNING', scope: 'out_of_scope' })]);

    expect(out.findings[0]!.scope).toBe('out_of_scope');
    expect(out.forced).toBe(0);
    expect(out.inScope).toBe(0);
    expect(out.outOfScope).toBe(1);
  });

  it('normalises an unlabelled finding to in_scope without counting it as forced', () => {
    for (const unlabelled of [finding(), finding({ scope: null })]) {
      const out = applyScopeGuard([unlabelled]);
      expect(out.findings[0]!.scope).toBe('in_scope');
      // The default is not the floor: nothing was taken away from the model.
      expect(out.forced).toBe(0);
      expect(out.inScope).toBe(1);
    }
  });
});

describe('applyScopeGuard — membership is never touched', () => {
  const mixed: Finding[] = [
    finding({ id: 'a', severity: 'SUGGESTION', scope: 'out_of_scope' }),
    finding({ id: 'b', severity: 'CRITICAL', scope: 'out_of_scope' }),
    finding({ id: 'c' }),
    finding({ id: 'd', kind: 'secret_leak', severity: 'WARNING', scope: 'out_of_scope' }),
    finding({ id: 'e', severity: 'WARNING', scope: 'in_scope' }),
  ];

  it('returns the same count in the same order, for every mix of labels', () => {
    const out = applyScopeGuard(mixed);

    expect(out.findings).toHaveLength(mixed.length);
    expect(out.findings.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // a stays out (SUGGESTION), b + d are floored, c defaults, e stays in.
    expect(out.findings.map((f) => f.scope)).toEqual([
      'out_of_scope',
      'in_scope',
      'in_scope',
      'in_scope',
      'in_scope',
    ]);
    expect(out.forced).toBe(2);
    expect(out.inScope).toBe(4);
    expect(out.outOfScope).toBe(1);
    expect(out.inScope + out.outOfScope).toBe(out.findings.length);
  });

  it('preserves count and order on the empty and single-element cases', () => {
    expect(applyScopeGuard([]).findings).toHaveLength(0);
    expect(applyScopeGuard([]).forced).toBe(0);

    const one = [finding({ id: 'only' })];
    expect(applyScopeGuard(one).findings.map((f) => f.id)).toEqual(['only']);
  });

  it('mutates neither the input array nor the finding objects inside it', () => {
    const input = mixed.map((f) => ({ ...f }));
    const before = structuredClone(input);

    const out = applyScopeGuard(input);

    expect(input).toEqual(before);
    expect(input).toHaveLength(before.length);
    // Fresh objects, so a caller still holding the grounded set (the server
    // persists `ground.kept` alongside the scored review) sees no relabelling.
    for (const [i, f] of out.findings.entries()) expect(f).not.toBe(input[i]);
    // Every other field is carried through untouched — only `scope` differs.
    for (const [i, f] of out.findings.entries()) {
      expect({ ...f, scope: undefined }).toEqual({ ...input[i]!, scope: undefined });
    }
  });
});
