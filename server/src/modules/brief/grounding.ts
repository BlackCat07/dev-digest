/**
 * The evidence gate: nothing the model invented survives to storage — pure.
 *
 * Everything arrives as an argument. No clock, no database, no clone read and no
 * provider is in reach, so every rule below is testable against a plain object,
 * which is what `test/brief-grounding.test.ts` does.
 *
 * **THE MODEL'S OWN OUTPUT IS UNTRUSTED, and this is the half specific to this
 * feature.** The wrapping in `prompt.ts` defends the way IN; this file defends the
 * way OUT. A review-focus row pointing at a file the pull request never touched is
 * not a quality problem — it is a link a reviewer clicks that goes nowhere — and
 * the intent layer already records that reasoning for its own risk chips
 * (`modules/intent/risks.ts`, `groundRiskAreas`, whose two rules this file
 * extends rather than reinvents).
 *
 * **GROUND AGAINST THE PATHS THE MODEL WAS SHOWN, never the whole changed set.**
 * The caller passes `AssembledInput.groundingPaths`, which is the LISTED subset
 * after the role ordering and the 200-path cap. Grounding asks whether the model
 * could have known about a path, and a path the cap left out was never in front of
 * it — so grounding against the full changed set would accept a citation the model
 * could not have made honestly. Those paths also arrive in the exact form
 * `pr_files` recorded: the classifier's folded, lowercased form never leaves it,
 * because a case-folded path in the allowed set would silently widen it (EC-36).
 *
 * **THREE RULES, BECAUSE THEY FAIL SEPARATELY.**
 *
 *  - A risk's citation may name a path the model was shown OR a file the blast map
 *    referenced, compared on the path only, with a trailing `:line` or
 *    `:line-line` suffix KEPT FOR DISPLAY (AC-22). The model is told to cite bare
 *    paths and routinely appends a range; rejecting those would drop almost every
 *    true reference.
 *  - A review-focus row's `path` may name only a path the model was shown — never
 *    the blast radius (AC-24, OQ-3). Its whole contract is that it navigates into
 *    a tab that renders changed files, so a row that cannot navigate is worse than
 *    a missing row.
 *  - An endpoint a surviving item names must appear among the blast map's impacted
 *    endpoints (AC-25). Its own rule because a path comparison cannot see an
 *    endpoint string: `GET /api/does-not-exist` contains no separator a path
 *    matcher would recognise and would otherwise sail through as an unmatched
 *    "path" and be dropped for the wrong reason — or, worse, kept.
 *
 * **A RISK CITING NOTHING IS KEPT.** "The auth surface is touched" is a legitimate
 * whole-pull-request observation and the model was not required to cite anything.
 * A risk whose every OFFERED citation was dropped is dropped with them: the claim
 * rested on material that does not exist here, so there is nothing left of it to
 * trust (AC-23).
 *
 * **THE LEVEL IS DERIVED, NEVER TAKEN.** Highest severity among the risks that
 * survived, `low` when none did (AC-26, EC-15). The draft has no field for a level
 * at all — see `schemas.ts`.
 *
 * **EVERYTHING OVER A CAP IS DISCARDED WHOLE.** A seventh risk is dropped, not
 * summarised; a fourth citation is dropped, not merged. Only the free-text fields
 * are cut to a character cap, and a cut sentence is still a true sentence while
 * half a risk is not (EC-16).
 */
import type { Risk, ReviewFocusItem, RiskLevel } from '@devdigest/shared';
import {
  MAX_FOCUS_REASON_CHARS,
  MAX_REVIEW_FOCUS,
  MAX_RISKS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_FILE_REFS,
  MAX_RISK_TITLE_CHARS,
  MAX_WHAT_CHARS,
  MAX_WHY_CHARS,
} from './constants.js';
import type { DraftReviewFocus, DraftRisk, PrBriefDraft } from './schemas.js';
import type { BriefBlastFacts } from './types.js';

/**
 * What the grounding is checked against, and the one string it compares the
 * `what` to.
 *
 * `listedPaths` is `AssembledInput.groundingPaths` and nothing else — see the file
 * header for why it is not `changedPaths`.
 */
export interface GroundingContext {
  /** The pull request's title, for AC-27's restatement check. */
  title: string;
  /** The paths the model was actually shown, in the form `pr_files` recorded. */
  readonly listedPaths: readonly string[];
  /** Every file the blast map referenced. Allowed for a risk, never for a focus row. */
  readonly blastFiles: readonly string[];
  /** Every endpoint and scheduled job label the blast map reported as impacted. */
  readonly blastEndpoints: readonly string[];
}

/** The brief as it will be stored: claims that survived, and the level they imply. */
export interface GroundedBrief {
  /** Null when the model produced nothing usable, or only restated the title. */
  what: string | null;
  why: string | null;
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  /** Derived from {@link risks}; `low` when none survived. Never the model's. */
  riskLevel: RiskLevel;
  /**
   * True when the `what` was dropped because it restated the title (AC-27).
   *
   * Reported rather than acted on: the brief is marked `partial` with reason
   * `restates_title` by the caller, which is the ring that owns the brief's
   * status. It is NOT reprompted — a second round-trip would contradict AC-19.
   */
  restatedTitle: boolean;
}

/**
 * Every file the blast map referenced, and every endpoint it reported.
 *
 * Exported because the caller assembles the {@link GroundingContext} and this is
 * the one part of it that is a derivation rather than a value it already holds —
 * and because a test can then check the derivation without going through a
 * generation. `changed_files` is included: the map computes over the paths
 * `pr_files` recorded, and a path that was dropped by the 200-path cap is still a
 * legitimate citation for a RISK even though it is not one for a focus row.
 */
export function blastReferences(blast: BriefBlastFacts): {
  files: string[];
  endpoints: string[];
} {
  const files = new Set<string>(blast.changed_files);
  for (const symbol of blast.changed_symbols) files.add(symbol.file);
  for (const impact of blast.downstream) {
    files.add(impact.file);
    for (const caller of impact.callers) files.add(caller.file);
  }
  for (const endpoint of blast.impacted) files.add(endpoint.file);

  return {
    files: [...files],
    endpoints: blast.impacted.map((endpoint) => endpoint.label),
  };
}

/**
 * Turn one draft into the brief that will be stored.
 *
 * Order matters in one place only: the risks are grounded before the level is
 * derived, because the level is a property of the SURVIVORS. Everything else is
 * independent.
 */
export function groundBriefDraft(
  draft: PrBriefDraft,
  context: GroundingContext,
): GroundedBrief {
  const listed = new Set(context.listedPaths);
  // A risk may cite either set; a focus row may cite only the listed paths.
  const citable = new Set([...context.listedPaths, ...context.blastFiles]);
  const endpoints = new Set(context.blastEndpoints);

  const risks = groundRisks(draft.risks, citable, endpoints);
  const what = groundWhat(draft.what, context.title);

  return {
    what: what.text,
    why: capped(draft.why, MAX_WHY_CHARS),
    risks,
    reviewFocus: groundReviewFocus(draft.review_focus, listed),
    riskLevel: highestSeverity(risks),
    restatedTitle: what.restatedTitle,
  };
}

/**
 * The `what`, unless it only restated the title.
 *
 * "After case and whitespace normalisation" is taken literally and nothing more:
 * lowercase, collapse runs of whitespace, trim. Punctuation is deliberately NOT
 * stripped — a `what` that adds even a clause is a different sentence, and a
 * looser comparison would start discarding real answers, which is the expensive
 * direction here (a null `what` renders as a missing region on the card).
 *
 * An empty answer becomes null too, but is not reported as a restatement: nothing
 * was restated, there was simply nothing to store, and labelling it
 * `restates_title` would put a wrong reason on the card.
 */
function groundWhat(
  what: string,
  title: string,
): { text: string | null; restatedTitle: boolean } {
  const text = capped(what, MAX_WHAT_CHARS);
  if (text == null) return { text: null, restatedTitle: false };
  if (normalise(text) === normalise(title)) return { text: null, restatedTitle: true };
  return { text, restatedTitle: false };
}

/** Case and whitespace, and nothing else (AC-27). */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The risks that survived, capped, with their citations checked.
 *
 * A title is required because a chip with no label cannot be rendered or clicked
 * — the one rule `groundRiskAreas` applies that has nothing to do with citations,
 * kept here for the same reason.
 *
 * `kind` is stored exactly as the model chose it. The intent layer corrects a
 * vague `other` from the cited paths (`kindFromPaths`), and that is deliberately
 * NOT copied: this feature's card renders a neutral icon for an unrecognised kind
 * and a second, path-shaped opinion about a category would be a rule nobody asked
 * for here.
 */
function groundRisks(
  risks: readonly DraftRisk[],
  citable: ReadonlySet<string>,
  endpoints: ReadonlySet<string>,
): Risk[] {
  const kept: Risk[] = [];

  for (const risk of risks) {
    if (kept.length >= MAX_RISKS) break;

    const refs = groundRefs(risk.file_refs, citable, endpoints);
    // Every citation it offered was invented ⇒ the risk itself is unsupported.
    if (risk.file_refs.length > 0 && refs.length === 0) continue;

    const title = capped(risk.title, MAX_RISK_TITLE_CHARS);
    if (title == null) continue;

    kept.push({
      kind: risk.kind,
      title,
      explanation: capped(risk.explanation, MAX_RISK_EXPLANATION_CHARS) ?? '',
      severity: risk.severity,
      file_refs: refs,
    });
  }

  return kept;
}

/**
 * The citations that name something the model was actually shown.
 *
 * A reference is tried as an ENDPOINT first and as a path second, because the two
 * vocabularies overlap on nothing and the endpoint form is the exact one: a label
 * is matched whole (`GET /pulls/:id` carries a space and a colon, which a path
 * matcher would split at the wrong place and then fail to find). Only if the whole
 * string is not a known endpoint is it treated as a path, whose `:line` suffix is
 * dropped for the comparison and kept in what is stored, because the reader is
 * shown the reference and the range is the useful half of it.
 */
function groundRefs(
  refs: readonly string[],
  citable: ReadonlySet<string>,
  endpoints: ReadonlySet<string>,
): string[] {
  const kept: string[] = [];

  for (const raw of refs) {
    if (kept.length >= MAX_RISK_FILE_REFS) break;
    const ref = raw.trim();
    if (ref.length === 0) continue;
    if (endpoints.has(ref) || citable.has(pathOf(ref))) kept.push(ref);
  }

  return kept;
}

/**
 * The review-focus rows that can actually navigate, capped.
 *
 * The path is stored BARE even when the model appended a `:line` suffix: the
 * contract says so in as many words, because this value is handed to the diff tab
 * as a file target and a display form would match no file. The suffix's line
 * number is not adopted as `line` — the model has a field for that and inferring
 * one from a citation would be a second, unasked-for source for a value AC-24
 * deliberately leaves ungrounded.
 */
function groundReviewFocus(
  items: readonly DraftReviewFocus[],
  listed: ReadonlySet<string>,
): ReviewFocusItem[] {
  const kept: ReviewFocusItem[] = [];

  for (const item of items) {
    if (kept.length >= MAX_REVIEW_FOCUS) break;

    const path = pathOf(item.path);
    if (!listed.has(path)) continue;

    const reason = capped(item.reason, MAX_FOCUS_REASON_CHARS);
    if (reason == null) continue;

    kept.push({ path, line: item.line, reason });
  }

  return kept;
}

/**
 * The level the surviving risks imply (AC-26).
 *
 * `low` when none survived, which is a CLAIM rather than an absence: a brief that
 * found nothing worth flagging says so. Only a brief nobody generated has a null
 * level, and that is the caller's to write.
 */
function highestSeverity(risks: readonly Risk[]): RiskLevel {
  if (risks.some((risk) => risk.severity === 'high')) return 'high';
  if (risks.some((risk) => risk.severity === 'medium')) return 'medium';
  return 'low';
}

/** Trimmed and cut to `max`, or null when nothing is left. Never mid-item. */
function capped(text: string, max: number): string | null {
  const trimmed = text.trim().slice(0, max).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** `src/a.ts:12-18` → `src/a.ts`; anything without a suffix is returned as-is. */
function pathOf(ref: string): string {
  const trimmed = ref.trim();
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}
