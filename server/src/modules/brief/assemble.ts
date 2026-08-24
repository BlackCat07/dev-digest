/**
 * The model input: the eight sources of AC-10, and nothing else — pure.
 *
 * Everything arrives as an argument. There is no clock, no database, no clone
 * read and no provider in reach here, which is what makes the whole of the
 * budget arithmetic and the shedding order testable at a budget of a hundred
 * tokens.
 *
 * THE EIGHT SOURCES ARE THE WHOLE SET. Title (with branch and base), the changed
 * -file list, the intent record, the blast facts, the description, the linked
 * issue, the overlapping prior pull requests, and the effective documents' text.
 * Every string in the assembled blocks traces to one of those or to a heading
 * this server wrote (AC-10, AC-11).
 *
 * **NO DIFF HUNK BODY, ON ANY PATH.** Not by a rule remembered here but by
 * absence: `BriefPrFile` has no `patch` field at all, because the repository
 * selects three columns, so nothing above it has a patch to leak. That absence
 * is what the token budget rests on. A test can still prove it honestly by
 * handing in a row carrying an extra `patch` property — structurally harmless —
 * and asserting no substring of it reaches the blocks.
 *
 * **THE NORMALISED PATH FORM NEVER LEAVES THE CLASSIFIER.** `classifyPath` folds
 * separators, drops a leading `./` and lowercases; every path this file places in
 * a block or hands back as the grounding set is the one `pr_files` recorded. The
 * two are one careless assignment apart, and a case-folded path reaching the
 * grounding set would silently WIDEN it — `SRC/a.ts` would ground a citation of
 * `src/a.ts` (EC-36). `orderChangedFilesByRole` is generic over the caller's own
 * row type for exactly this reason: the rows pass through by identity and the
 * classifier's view of a path never escapes it.
 *
 * **ORDER FIRST, CAP SECOND.** The two steps are two functions in
 * `file-roles.ts` precisely so they cannot be fused the wrong way round: capping
 * an unordered list spends the whole path budget on whatever `pr_files` returned,
 * which on a large pull request is dominated by generated and vendored files
 * (OQ-7, AC-60, AC-17).
 *
 * **THIS MEASUREMENT IS NOT THE FINAL ONE.** Sizing here is over the raw block
 * text plus the heading; AC-12 defines the budget over the system and user
 * messages EXACTLY AS SENT, which is after `wrapUntrusted` has added a delimiter
 * pair per block and after the system template has been rendered. Neither is
 * available in this file — the template is loaded by `prompt.ts` and the wrapping
 * is its job — so `prompt.ts` re-measures before it returns, and a margin case
 * that fits here can still fail there. Nothing in this file may be read as proof
 * that the 8 000-token ceiling holds.
 *
 * **WHOLE SOURCES ARE SHED, NEVER TRIMMED.** Half a blast map reads to a model
 * as a complete one and is worse than its absence, so a source over budget is
 * dropped entirely and recorded as `dropped_over_budget` (AC-14, AC-33). The
 * core — title, changed-file list, intent — is never dropped, because grounding
 * is DEFINED against the changed-file list and a call made without it cannot
 * produce a checkable answer; if the core alone overruns, this file says so and
 * no model call is made (AC-15, AC-16).
 */
import type {
  BriefDiffStats,
  BriefSource,
  BriefSourceKind,
  BriefSourceStatus,
} from '@devdigest/shared';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import { dedupeFilesByPath } from './cache-key.js';
import {
  CORE_SOURCES,
  MAX_BODY_CHARS,
  MAX_PRIOR_PRS,
  MAX_PROMPT_PATHS,
  MAX_PROMPT_TOKENS,
  MAX_SOURCE_CHARS,
  SHED_ORDER,
} from './constants.js';
import type { LoadedDoc } from './documents.js';
import { capFileList, orderChangedFilesByRole } from './file-roles.js';
import type {
  BriefBlastFacts,
  BriefIntentFacts,
  BriefPrFile,
  BriefPriorPr,
  BriefPriorPrsFacts,
  BriefPull,
  FileRoleClassifier,
} from './types.js';

/**
 * Every `BriefSourceKind` is either core or droppable, and none is both.
 *
 * A compile-time assertion rather than a runtime one, and it lives HERE rather
 * than in `constants.ts` because this is the file that would silently misbehave:
 * a kind added to the contract and to neither list would become undroppable, so
 * an over-budget input would shed everything it could and still make the call.
 * `[X] extends [never]` rather than `X extends never`, so nothing distributes.
 */
type Classified = (typeof SHED_ORDER)[number] | (typeof CORE_SOURCES)[number];
type Unclassified = Exclude<BriefSourceKind, Classified>;
type BothWays = Extract<(typeof SHED_ORDER)[number], (typeof CORE_SOURCES)[number]>;
const _everyKindIsClassified: [Unclassified] extends [never] ? true : never = true;
const _noKindIsBoth: [BothWays] extends [never] ? true : never = true;

/**
 * One labelled section of the user message.
 *
 * `heading` is ours and stays OUTSIDE the untrusted delimiters; `label` is the
 * `source=` attribute on them; `text` is the foreign content that goes inside.
 * The split is `modules/intent/sources.ts`'s `IntentBlock`, deliberately — two
 * features assembling a prompt should not have two shapes for a block — with
 * `untrusted` dropped, because every block this feature produces is foreign text
 * and a boolean nobody ever sets to false is a trap rather than an option.
 */
export interface BriefBlock {
  kind: BriefSourceKind;
  heading: string;
  label: string;
  text: string;
}

/** The linked issue, fetched or refused. Never a throw. */
export type BriefIssueSource =
  | { ref: string; ok: true; title: string; body: string | null }
  | { ref: string; ok: false; note: string };

/**
 * Everything the assembly is given. Nothing here is fetched by this file.
 *
 * `intent` and `priorPrs` are `undefined` when the derivation has none to give —
 * a missing intent makes the brief partial (AC-31) and is a normal state, not an
 * error. `blast` is always present because the map is derived fresh on every
 * read and reports its own `status`.
 */
export interface AssembleInput {
  pull: BriefPull;
  /** Raw `pr_files` rows, in any order and possibly with a duplicate path. */
  files: readonly BriefPrFile[];
  intent: BriefIntentFacts | undefined;
  blast: BriefBlastFacts;
  priorPrs: BriefPriorPrsFacts | undefined;
  /** Undefined when the description referenced no issue of this repository. */
  issue: BriefIssueSource | undefined;
  /** One entry per document of the effective set, read or refused. */
  docs: readonly LoadedDoc[];
  fileRole: FileRoleClassifier;
  /** Defaults to `MAX_PROMPT_TOKENS`. A parameter so the shedding is testable. */
  budget?: number;
  /** Defaults to `MAX_PROMPT_PATHS`. */
  maxPaths?: number;
}

export interface AssembledInput {
  /** In the order they belong in the user message: core first, then the rest. */
  blocks: BriefBlock[];
  /** One entry per input the generation was offered, whatever became of it (AC-33). */
  sources: BriefSource[];
  diffStats: BriefDiffStats;
  /**
   * Every changed path recorded for the pull request, deduplicated, in
   * `pr_files` order and in the form `pr_files` recorded.
   */
  changedPaths: string[];
  /**
   * The paths the model was actually shown — the set a citation is grounded
   * against (AC-22, AC-24).
   *
   * The LISTED subset and not `changedPaths`, because grounding asks whether the
   * model could have known about a path, and a path the cap left out was never in
   * front of it.
   */
  groundingPaths: string[];
  /** How many changed paths the cap left out. Reported on the card (AC-17). */
  omittedPaths: number;
  /**
   * `sum of ceil(characters / 4)` over the kept blocks and their headings — the
   * pre-wrap figure the shedding decided on. See the file header: this is not
   * AC-12's measurement.
   */
  tokens: number;
  /**
   * True when the core alone is over budget, in which case NO MODEL CALL is made
   * and the brief is stored `degraded` with reason `inputs_too_large` (AC-16).
   */
  coreOverBudget: boolean;
  /** The kinds shed, in the order they were shed. */
  dropped: BriefSourceKind[];
}

/**
 * Assemble the one model input for a pull request.
 *
 * The block ORDER is core-first — title, changed files, intent — then blast,
 * description, linked issue, prior pull requests, documents. It is not the shed
 * order reversed and it is not accidental: what survives every budget is what the
 * model reads first, so a shed input reads as a shorter version of the same
 * prompt rather than as a differently-shaped one.
 */
export function assembleBriefInput(input: AssembleInput): AssembledInput {
  const budget = input.budget ?? MAX_PROMPT_TOKENS;
  const maxPaths = input.maxPaths ?? MAX_PROMPT_PATHS;

  // EC-4: deduplicated ONCE, before both the list the model reads and the counts
  // the card reports. The cache key deduplicates too, with the same idempotent
  // helper, so the two lists cannot describe different sets of paths.
  const files = dedupeFilesByPath(input.files);
  const ordered = orderChangedFilesByRole(files, input.fileRole);
  const capped = capFileList(ordered, maxPaths);

  const blocks: BriefBlock[] = [];
  const sources: BriefSource[] = [];

  // ---- pr_title (core) ----------------------------------------------------
  const titleText = renderTitle(input.pull);
  blocks.push({
    kind: 'pr_title',
    heading: 'Pull request',
    label: 'pr:title',
    text: titleText,
  });
  sources.push(used('pr_title', `pull/${input.pull.number}`, titleText.length, null));

  // ---- file_list (core) ---------------------------------------------------
  // The omitted count goes in the HEADING, which stays outside the untrusted
  // delimiters: "you are seeing 200 of 400 files" is this server's statement
  // about the prompt, and a statement placed inside the block would be data the
  // model may discount.
  if (capped.kept.length > 0) {
    const fileText = capped.kept
      .map((file) => `${file.path} +${file.additions}/-${file.deletions}`)
      .join('\n');
    blocks.push({
      kind: 'file_list',
      heading:
        capped.omitted > 0
          ? `Changed files — ${capped.kept.length} of ${files.length}, ordered core then wiring then boilerplate`
          : 'Changed files, ordered core then wiring then boilerplate',
      label: 'pr:files',
      text: fileText,
    });
    sources.push(
      used(
        'file_list',
        `pull/${input.pull.number}/files`,
        fileText.length,
        capped.omitted > 0 ? `${capped.omitted} further changed files are not listed` : null,
      ),
    );
  } else {
    // Not an exotic case: `pr_files` is written only by `GET /pulls/:id`, so a
    // pull request nobody has opened has no rows at all — measured at 10 of 14
    // in a live workspace (`server/INSIGHTS.md`, 2026-08-11 and 2026-08-15). The
    // service turns this into `no_changed_files` and makes no call (AC-28); the
    // entry is here so the stored brief says which input was missing.
    sources.push(
      unfetched(
        'file_list',
        `pull/${input.pull.number}/files`,
        'no changed file is recorded for this pull request',
      ),
    );
  }

  // ---- intent (core) ------------------------------------------------------
  if (input.intent && input.intent.status !== 'failed' && input.intent.intent) {
    const intentText = renderIntent(input.intent);
    blocks.push({
      kind: 'intent',
      heading: 'Derived intent of this pull request',
      label: 'pr:intent',
      text: intentText,
    });
    sources.push(used('intent', `pull/${input.pull.number}/intent`, intentText.length, null));
  } else {
    sources.push(
      unfetched(
        'intent',
        `pull/${input.pull.number}/intent`,
        input.intent
          ? `the stored intent is ${input.intent.status}`
          : 'no intent has been derived for this pull request',
      ),
    );
  }

  // ---- blast --------------------------------------------------------------
  // Always offered, and its own `status` and `reason` travel INTO the block: a
  // model shown an empty impact map without being told the index is partial will
  // read the emptiness as a finding. The brief carries the map's own reason
  // rather than re-deriving one (AC-32).
  const blastText = renderBlast(input.blast);
  blocks.push({
    kind: 'blast',
    heading: 'Blast radius, from the code index',
    label: 'pr:blast',
    text: blastText,
  });
  sources.push(
    used(
      'blast',
      `pull/${input.pull.number}/blast`,
      blastText.length,
      input.blast.status === 'ok' ? null : `index ${input.blast.status}: ${input.blast.reason ?? 'unknown'}`,
    ),
  );

  // ---- pr_body ------------------------------------------------------------
  // A pull request with no description is a normal state, so nothing is recorded
  // for it: there was nothing to fetch, and an `unfetched` entry would read as a
  // failure. The precedent is `modules/intent/sources.ts`, which states the same
  // reason.
  const body = (input.pull.body ?? '').trim();
  if (body.length > 0) {
    const description = truncate(body, MAX_BODY_CHARS);
    blocks.push({
      kind: 'pr_body',
      heading: 'Pull request description, written by the author',
      label: 'pr:body',
      text: description.text,
    });
    sources.push(
      used(
        'pr_body',
        `pull/${input.pull.number}#description`,
        description.text.length,
        description.note,
      ),
    );
  }

  // ---- linked_issue -------------------------------------------------------
  if (input.issue) {
    if (input.issue.ok) {
      const issueText = truncate(
        [input.issue.title, input.issue.body ?? ''].join('\n').trim(),
        MAX_SOURCE_CHARS,
      );
      blocks.push({
        kind: 'linked_issue',
        heading: `Linked issue ${input.issue.ref}`,
        label: `issue:${input.issue.ref}`,
        text: issueText.text,
      });
      sources.push(used('linked_issue', input.issue.ref, issueText.text.length, issueText.note));
    } else {
      sources.push(unfetched('linked_issue', input.issue.ref, input.issue.note));
    }
  }

  // ---- prior_prs ----------------------------------------------------------
  // An empty overlap and an unsearchable repository are the same empty array, so
  // the status is read rather than inferred: `pr_files` is sparse on every real
  // workspace (`server/INSIGHTS.md`, 2026-08-15). A successful read with no
  // overlap offers nothing and records nothing; a read that could not see the
  // history records why.
  if (input.priorPrs) {
    const kept = input.priorPrs.prs.slice(0, MAX_PRIOR_PRS);
    if (kept.length > 0) {
      const priorText = renderPriorPrs(kept);
      blocks.push({
        kind: 'prior_prs',
        heading: `Earlier pull requests touching these files (${kept.length} of ${input.priorPrs.total})`,
        label: 'pr:prior',
        text: priorText,
      });
      sources.push(
        used(
          'prior_prs',
          `pull/${input.pull.number}/prior-prs`,
          priorText.length,
          input.priorPrs.status === 'ok'
            ? null
            : `history ${input.priorPrs.status}: ${input.priorPrs.reason ?? 'unknown'}`,
        ),
      );
    } else if (input.priorPrs.status !== 'ok') {
      sources.push(
        unfetched(
          'prior_prs',
          `pull/${input.pull.number}/prior-prs`,
          `history ${input.priorPrs.status}: ${input.priorPrs.reason ?? 'unknown'}`,
        ),
      );
    }
  }

  // ---- repo_doc -----------------------------------------------------------
  // One block and one source entry per document of the effective set, in
  // effective order. A document that could not be read is recorded rather than
  // omitted: the set is what a person said was relevant, and its absence is a
  // fact about the brief.
  for (const doc of input.docs) {
    if (!doc.ok) {
      sources.push(unfetched('repo_doc', doc.path, doc.note));
      continue;
    }
    const text = truncate(doc.text.trim(), MAX_SOURCE_CHARS);
    if (text.text.length === 0) {
      sources.push(unfetched('repo_doc', doc.path, 'the document is empty'));
      continue;
    }
    blocks.push({
      kind: 'repo_doc',
      heading: `Repository document ${doc.path}`,
      label: `repo-doc:${doc.path}`,
      text: text.text,
    });
    // Both notes can apply at once — a document may be truncated AND have gone
    // unsized by the walk — so they are joined rather than one overwriting the
    // other.
    const notes = [text.note, doc.note].filter((note) => note != null);
    sources.push(
      used('repo_doc', doc.path, text.text.length, notes.length > 0 ? notes.join('; ') : null),
    );
  }

  const shed = shedToBudget(blocks, sources, budget);

  return {
    blocks: shed.blocks,
    sources,
    diffStats: {
      files_changed: files.length,
      files_listed: capped.kept.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      // AC-30: the blast map's own counts, taken from the object `renderBlast`
      // prints above rather than recomputed from `input.blast.changed_symbols` /
      // `.impacted` — the map counts its endpoints DISTINCT by label
      // (`modules/blast/service.ts`, `count`), so a length here would quietly be
      // a different figure from the one the Blast Radius card shows.
      symbols: input.blast.counts.symbols,
      endpoints: input.blast.counts.endpoints,
    },
    changedPaths: files.map((file) => file.path),
    groundingPaths: capped.kept.map((file) => file.path),
    omittedPaths: capped.omitted,
    tokens: shed.tokens,
    coreOverBudget: shed.overBudget,
    dropped: shed.dropped,
  };
}

/**
 * The pre-wrap size of the kept blocks, as the shedding measures it.
 *
 * `ceil(characters / 4)` per rendered block, the repository's own `approxTokens`
 * rule, so this feature's figure and Project Context's are comparable rather
 * than merely similarly named.
 */
export function blockTokens(blocks: readonly BriefBlock[]): number {
  return blocks.reduce((sum, block) => sum + approxTokens(renderBlock(block)), 0);
}

/** A block as it will appear, minus the untrusted delimiters `prompt.ts` adds. */
function renderBlock(block: BriefBlock): string {
  return `## ${block.heading}\n${block.text}`;
}

/**
 * Drop whole optional sources in `SHED_ORDER` until the input fits.
 *
 * Each dropped block's own source entry is rewritten in place from `used` to
 * `dropped_over_budget` with its `chars` cleared, so a deliberately shorter
 * prompt never reads as a broken one and the card can say why (AC-33). The entry
 * is mutated rather than replaced because a source list carries one entry per
 * OFFERED input — a second entry for the same document would double-count it.
 */
function shedToBudget(
  blocks: readonly BriefBlock[],
  sources: BriefSource[],
  budget: number,
): { blocks: BriefBlock[]; tokens: number; overBudget: boolean; dropped: BriefSourceKind[] } {
  let kept = [...blocks];
  let tokens = blockTokens(kept);
  const dropped: BriefSourceKind[] = [];

  for (const kind of SHED_ORDER) {
    if (tokens <= budget) break;
    if (!kept.some((block) => block.kind === kind)) continue;

    const droppedBlocks = kept.filter((block) => block.kind === kind);
    kept = kept.filter((block) => block.kind !== kind);
    dropped.push(kind);
    tokens = blockTokens(kept);

    for (const block of droppedBlocks) {
      const entry = sources.find(
        (source) => source.kind === kind && source.status === 'used' && matchesBlock(source, block),
      );
      if (!entry) continue;
      entry.status = 'dropped_over_budget';
      entry.chars = null;
      entry.note = `dropped to fit the ${budget}-token input budget`;
    }
  }

  // The core is never dropped, so being over budget here means the core alone
  // overruns: no call is made and nothing is charged for an answer that could
  // not have been grounded (AC-15, AC-16).
  return { blocks: kept, tokens, overBudget: tokens > budget, dropped };
}

/**
 * Which source entry belongs to which block, for the kinds that have more than
 * one.
 *
 * Only `repo_doc` does, and its `ref` is the document's path — which is also the
 * tail of the block's label. Every other kind has exactly one block and one
 * entry, so the kind alone identifies it.
 */
function matchesBlock(source: BriefSource, block: BriefBlock): boolean {
  return block.kind === 'repo_doc' ? block.label === `repo-doc:${source.ref}` : true;
}

/** Title, branch and base — one block, because they are one fact about the change. */
function renderTitle(pull: BriefPull): string {
  return [
    `#${pull.number} ${pull.title}`,
    `Branch: ${pull.branch}`,
    `Merging into: ${pull.base}`,
  ].join('\n');
}

/** The stored intent as the model reads it — no confidence, no provenance. */
function renderIntent(intent: BriefIntentFacts): string {
  const lines = [`Intent: ${intent.intent ?? 'not derived'}`];
  if (intent.in_scope.length > 0) lines.push(`In scope: ${intent.in_scope.join('; ')}`);
  if (intent.out_of_scope.length > 0) lines.push(`Out of scope: ${intent.out_of_scope.join('; ')}`);
  for (const risk of intent.risk_areas) {
    lines.push(`Risk area (${risk.severity}): ${risk.title} — ${risk.explanation}`);
  }
  if (intent.status !== 'ok') lines.push(`This intent is ${intent.status}.`);
  return lines.join('\n');
}

/**
 * The blast map's facts, including the ones that qualify them.
 *
 * No per-block character cap: every list here is already bounded by the indexer's
 * own caps, and a truncated impact map would read as a complete one — which is
 * the same reason a source is shed whole rather than trimmed. If the map is big
 * enough to matter to the budget, the shed loop drops it entirely.
 */
function renderBlast(blast: BriefBlastFacts): string {
  const lines = [
    `Index status: ${blast.status}${blast.reason ? ` (${blast.reason})` : ''}`,
    `Indexed at commit: ${blast.indexed_sha ?? 'unknown'}`,
    `Changed symbols: ${blast.counts.symbols}; callers: ${blast.counts.callers}; endpoints: ${blast.counts.endpoints}; scheduled jobs: ${blast.counts.crons}`,
  ];

  for (const symbol of blast.changed_symbols) {
    lines.push(`Symbol ${symbol.name} (${symbol.kind}) in ${symbol.file}`);
  }
  for (const impact of blast.downstream) {
    const callers = impact.callers.map((caller) => `${caller.name} in ${caller.file}`);
    if (callers.length > 0) lines.push(`Callers of ${impact.symbol}: ${callers.join('; ')}`);
  }
  for (const endpoint of blast.impacted) {
    lines.push(`Reachable ${endpoint.kind}: ${endpoint.label} (declared in ${endpoint.file}, ${endpoint.depth} hops)`);
  }
  return lines.join('\n');
}

/** One line per prior pull request: number, title, when, and what it overlapped. */
function renderPriorPrs(prs: readonly BriefPriorPr[]): string {
  return prs
    .map((pr) => {
      const when = pr.updated_at ?? 'date unknown';
      const overlap =
        pr.shared_files.length > 0
          ? `${pr.shared_files.join(', ')}${
              pr.shared_file_count > pr.shared_files.length
                ? ` (+${pr.shared_file_count - pr.shared_files.length} more)`
                : ''
            }`
          : 'no overlapping files recorded';
      return `#${pr.number} ${pr.title} (${when}) — overlaps: ${overlap}`;
    })
    .join('\n');
}

/** Cut to `max` characters, and say so. Never mid-item for a list source. */
function truncate(text: string, max: number): { text: string; note: string | null } {
  if (text.length <= max) return { text, note: null };
  return { text: text.slice(0, max), note: `truncated to ${max} characters` };
}

function source(
  kind: BriefSourceKind,
  ref: string,
  status: BriefSourceStatus,
  chars: number | null,
  note: string | null,
): BriefSource {
  return { kind, ref, status, chars, note };
}

function used(
  kind: BriefSourceKind,
  ref: string,
  chars: number,
  note: string | null,
): BriefSource {
  return source(kind, ref, 'used', chars, note);
}

/** `chars` is null: nothing reached the prompt, and a size would imply otherwise. */
function unfetched(kind: BriefSourceKind, ref: string, note: string): BriefSource {
  return source(kind, ref, 'unfetched', null, note);
}
