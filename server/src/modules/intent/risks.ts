import type { Risk } from '@devdigest/shared';
import {
  MAX_RISK_AREAS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_TITLE_CHARS,
} from './constants.js';

/**
 * The evidence gate for risk areas — the same idea `groundFindings` applies to a
 * review's findings, applied to the one thing the classifier is most likely to
 * invent.
 *
 * The classifier is given file PATHS and `@@` headers, never diff bodies, and a
 * model asked "where might this hurt?" will happily cite
 * `src/middleware/ratelimit.ts:12-18` because that is the shape of a good answer.
 * A chip pointing at a file the PR never touched is worse than one fewer chip: it
 * reads as a finding, the reader clicks it, and the deep link goes nowhere.
 *
 * So a reference survives only if its path is one the PR actually changed, and a
 * risk whose every reference was invented is dropped entirely — the claim rested
 * on files that do not exist in this diff, so there is nothing left of it to
 * trust. A risk with NO references at all is kept: "the auth surface is touched"
 * can be a legitimate whole-PR observation, and the model was not required to
 * cite anything.
 *
 * Comparison is on the path only. The model is told to cite bare paths, but it
 * routinely appends `:12-18`, and rejecting those would drop almost every true
 * reference — so a leading `path` segment is matched and the line suffix is kept
 * for display.
 */
export function groundRiskAreas(
  risks: readonly Risk[],
  changedPaths: readonly string[],
): Risk[] {
  const allowed = new Set(changedPaths);
  const kept: Risk[] = [];

  for (const risk of risks) {
    const refs: string[] = [];
    let invented = 0;
    for (const ref of risk.file_refs) {
      if (allowed.has(pathOf(ref))) {
        if (refs.length < MAX_RISK_FILE_REFS) refs.push(ref.trim());
      } else {
        invented += 1;
      }
    }
    // Every reference it offered was made up ⇒ the risk itself is unsupported.
    if (risk.file_refs.length > 0 && refs.length === 0 && invented > 0) continue;

    const title = risk.title.trim().slice(0, MAX_RISK_TITLE_CHARS);
    // A chip with no label cannot be rendered or clicked.
    if (title.length === 0) continue;

    kept.push({
      // Corrected from the paths when the model fell back to `other` — see
      // `kindFromPaths`. Uses the GROUNDED refs, so an invented path cannot
      // decide a category either.
      kind: kindFromPaths(risk.kind, refs),
      title,
      explanation: risk.explanation.trim().slice(0, MAX_RISK_EXPLANATION_CHARS),
      severity: risk.severity,
      file_refs: refs,
    });
    if (kept.length >= MAX_RISK_AREAS) break;
  }

  return kept;
}


/**
 * Path patterns that DETERMINE a risk's kind, whatever the model called it.
 *
 * Why this exists: the classifier reaches for `other` constantly. Measured on a
 * 100-file PR it returned `other` for all five risks, and on the card that means
 * five identical fallback icons — the block loses the one thing an icon row is
 * for, which is telling categories apart at a glance. The model is not wrong
 * exactly; it has paths and hunk headers and little else to classify from.
 *
 * But WE have the paths too, and for these categories the path IS the evidence:
 * a changed `package.json` is a dependency risk whatever prose the model wrote
 * around it. So the kind is corrected deterministically, from the same
 * already-grounded `file_refs` — no extra model call, no invention, and it stays
 * inside the no-diff-bodies rule because a path is not a diff body.
 *
 * Only ever applied to upgrade AWAY from `other`. A model that positively chose
 * `security` keeps it: it may have read something in the description that no path
 * reveals, and second-guessing a definite answer with a regex would be worse.
 */
const KIND_BY_PATH: ReadonlyArray<readonly [RegExp, Risk['kind']]> = [
  [/(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.toml|go\.mod|requirements\.txt|Gemfile)$/, 'deps'],
  [/(^|\/)(migrations?|db\/migrations)\//, 'db_migration'],
  [/\.sql$/, 'db_migration'],
  [/(^|\/)(auth|authn|authz|security|middleware|session|token|secrets?)([./]|s?\/)/, 'security'],
  [/(^|\/)(routes?|api|endpoints?|contracts?|schema)([./]|s?\/)/, 'breaking_api'],
];

/**
 * Upgrade a vague `other` to the kind the cited paths actually imply.
 *
 * Returns the original kind untouched for anything the model classified itself,
 * and for an `other` whose paths match nothing — `other` is a legitimate answer,
 * it is just a bad DEFAULT.
 */
function kindFromPaths(kind: Risk['kind'], refs: readonly string[]): Risk['kind'] {
  if (kind !== 'other') return kind;
  for (const [pattern, inferred] of KIND_BY_PATH) {
    if (refs.some((ref) => pattern.test(pathOf(ref)))) return inferred;
  }
  return kind;
}

/** `src/a.ts:12-18` → `src/a.ts`; anything without a suffix is returned as-is. */
function pathOf(ref: string): string {
  const trimmed = ref.trim();
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}
