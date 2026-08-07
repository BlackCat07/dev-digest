import { describe, it, expect } from 'vitest';
import {
  adherenceRatio,
  corpusCounter,
  deriveConfidence,
  isUsablePattern,
  measure,
  passesFloor,
  splitForMeasurement,
} from '../src/modules/conventions/adherence.js';
import {
  MAX_MEASURED_CANDIDATES,
  UNMEASURED_CONFIDENCE_CEILING,
} from '../src/modules/conventions/constants.js';

/** Where confidence stops being the model's opinion. Grep is injected. */

/** A grep that answers from a fixed table, and 0 for anything else. */
function counter(table: Record<string, number>) {
  return async (pattern: string) => table[pattern] ?? 0;
}

describe('isUsablePattern', () => {
  it('rejects null, which is how a model says "unmeasurable"', () => {
    expect(isUsablePattern(null)).toBe(false);
  });

  it('rejects patterns that would match nearly every line', () => {
    expect(isUsablePattern('.')).toBe(false);
    expect(isUsablePattern('.*')).toBe(false);
    expect(isUsablePattern('.+')).toBe(false);
    expect(isUsablePattern('  ')).toBe(false);
  });

  it('rejects a pattern that does not compile', () => {
    expect(isUsablePattern('([unclosed')).toBe(false);
  });

  it('accepts a specific pattern', () => {
    expect(isUsablePattern('\\.then\\s*\\(')).toBe(true);
  });
});

describe('corpusCounter', () => {
  const corpus = [
    { source: 'const a = await one();\nconst b = await two();\nreturn c.then((r) => r);' },
    { source: 'export default thing;\nexport const other = 1;' },
  ];

  it('counts a line that matches twice only once, grep-style', async () => {
    const count = corpusCounter([{ source: 'await a(); await b();\nplain();' }]);
    expect(await count('\\bawait\\s')).toBe(1);
  });

  it('spans files', async () => {
    const count = corpusCounter(corpus);
    expect(await count('\\bawait\\s')).toBe(2);
    expect(await count('export default')).toBe(1);
  });

  it('returns zero for a pattern that does not compile, rather than throwing', async () => {
    // The pattern comes from a model. A bad one must cost the rule its
    // measurement, not the whole scan.
    const count = corpusCounter(corpus);
    expect(await count('([unclosed')).toBe(0);
  });
});

describe('measure', () => {
  it('counts both sides over the whole repository', async () => {
    const adherence = await measure(
      { match_conforming: '\\bawait\\s', match_violating: '\\.then\\s*\\(' },
      counter({ '\\bawait\\s': 312, '\\.then\\s*\\(': 4 }),
    );
    expect(adherence).toEqual({ conforming: 312, violating: 4 });
  });

  it('returns null when either pattern is missing', async () => {
    expect(
      await measure({ match_conforming: '\\bawait\\s', match_violating: null }, counter({})),
    ).toBeNull();
    expect(
      await measure({ match_conforming: null, match_violating: '\\.then\\(' }, counter({})),
    ).toBeNull();
  });

  it('returns null when an over-broad pattern was supplied', async () => {
    // Accepting `.*` would report a ratio computed from the file mix and
    // present it as a measurement of the rule.
    expect(
      await measure({ match_conforming: '.*', match_violating: '\\.then\\(' }, counter({})),
    ).toBeNull();
  });

  it('returns null when the rule is about something absent from the repo', async () => {
    const adherence = await measure(
      { match_conforming: 'useReducer\\(', match_violating: 'useState\\(' },
      counter({}),
    );
    expect(adherence).toBeNull();
  });
});

describe('adherenceRatio', () => {
  it('is the conforming share', () => {
    expect(adherenceRatio({ conforming: 312, violating: 4 })).toBeCloseTo(0.9873);
    expect(adherenceRatio({ conforming: 2, violating: 60 })).toBeCloseTo(0.0323);
  });
});

describe('deriveConfidence', () => {
  it('reports the counted ratio for a measured rule, ignoring the model', () => {
    // The model said 0.78; the repository says 3%.
    expect(deriveConfidence({ conforming: 2, violating: 60 }, 0.78)).toBeCloseTo(0.0323);
  });

  it('caps an unmeasured rule below any measured one', () => {
    expect(deriveConfidence(null, 0.99)).toBe(UNMEASURED_CONFIDENCE_CEILING);
  });

  it('keeps a modest self-estimate as it is', () => {
    expect(deriveConfidence(null, 0.4)).toBeCloseTo(0.4);
  });

  it('clamps nonsense the model may emit', () => {
    expect(deriveConfidence(null, -5)).toBe(0);
    expect(deriveConfidence(null, Number.NaN)).toBe(0);
  });
});

describe('passesFloor', () => {
  it('drops a rule the repository mostly ignores', () => {
    expect(passesFloor({ conforming: 2, violating: 60 })).toBe(false);
  });

  it('drops a perfect ratio built on too few occurrences', () => {
    // 100%, and meaningless: two coincidences.
    expect(passesFloor({ conforming: 2, violating: 0 })).toBe(false);
  });

  it('keeps a rule that is both widespread and mostly kept', () => {
    expect(passesFloor({ conforming: 312, violating: 4 })).toBe(true);
  });

  it('keeps an unmeasured rule — structural conventions have no pattern', () => {
    expect(passesFloor(null)).toBe(true);
  });

  it('honours caller-supplied floors', () => {
    expect(passesFloor({ conforming: 6, violating: 4 }, 0.5, 5)).toBe(true);
    expect(passesFloor({ conforming: 6, violating: 4 }, 0.9, 5)).toBe(false);
  });
});

describe('splitForMeasurement', () => {
  it('measures up to the cap and defers the rest rather than dropping them', () => {
    const candidates = Array.from({ length: MAX_MEASURED_CANDIDATES + 7 }, (_, i) => i);
    const { measured, deferred } = splitForMeasurement(candidates);
    expect(measured).toHaveLength(MAX_MEASURED_CANDIDATES);
    expect(deferred).toHaveLength(7);
  });

  it('defers nothing when everything fits', () => {
    const { measured, deferred } = splitForMeasurement([1, 2, 3]);
    expect(measured).toHaveLength(3);
    expect(deferred).toEqual([]);
  });
});
