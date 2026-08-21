/**
 * The deterministic half of a generation: everything the tour is built from,
 * collected from the index and from nothing else.
 *
 * Pure functions plus one injected read, so the whole layer is testable with no
 * database, no clone and no provider. It runs BEFORE any model call and it is what
 * makes the honest failure modes possible: when the index has nothing to say, the
 * tour is a labelled skeleton and no model is asked to invent one (AC-16, AC-17).
 *
 * Two things this file deliberately does NOT do:
 *
 *  - It does not re-sort or re-filter the ranked paths. `getTopFilesByRank` is
 *    already rank DESC and already drops tests, specs, declarations, migrations
 *    and tool configs, so AC-5 and AC-6 are satisfied by calling it. A second
 *    filter here would be a second opinion about what "a real source file" means,
 *    which is exactly the drift AC-6 exists to prevent.
 *  - It does not touch the dependency chains. Five seeds and two hops are the
 *    index's shipped constants and AC-7 is written against that behaviour; an
 *    edgeless repository answers `[]`, which is a value and not an error (EC-4).
 */
import type {
  OnboardingFacts,
  OnboardingFileFacts,
  OnboardingIndexDegradedReason,
  OnboardingIndexReader,
  OnboardingIndexState,
} from './types.js';
import type { OnboardingReason, OnboardingStatus } from '@devdigest/shared';
import { MAX_ENDPOINT_FACTS, MAX_PROMPT_PATHS } from './constants.js';

/**
 * How much of the tour the index can support: `ok` / `partial` / `degraded`.
 *
 * A hand-written copy of the blast module's `statusOf`, with the same
 * table and the same fallbacks. Copied rather than imported ON PURPOSE — importing
 * a sibling module's internal is a `no-cross-module-internals` violation — and the
 * duplication is the price of two features telling one user the same story:
 * AC-19's whole content is that this table and blast's are the same table.
 *
 *  - `degraded` on the state means the persistent index was not usable at all, so
 *    the arrays prove nothing either way;
 *  - `partial` means the index is real but covers only some of the repository;
 *  - only `full` earns `ok`;
 *  - no status at all is treated as `partial` rather than as completeness nobody
 *    demonstrated.
 */
export function toOnboardingStatus(state: OnboardingIndexState): OnboardingStatus {
  if (state.degraded) return 'degraded';
  if (state.status === 'partial') return 'partial';
  if (state.status === 'full') return 'ok';
  return state.status == null ? 'partial' : 'degraded';
}

/**
 * The index's degraded vocabulary → this feature's.
 *
 * `no_data` is the facade's catch-all for "nothing usable was read", which from
 * the reader's side is specifically a missing index — the actionable form, since
 * the fix is an index rather than a mystery. Every other member maps across
 * unchanged, and ANYTHING unrecognised lands on `index_missing` too, so a reason
 * added to the facade later cannot leak an unknown literal onto the screen.
 *
 * The four model-side reasons (`model_failed`, `model_timeout`, `model_invalid`,
 * `no_commands_declared`) never come from here: the index knows nothing about a
 * model call, and the generation applies them itself.
 */
export function toOnboardingReason(
  reason: OnboardingIndexDegradedReason | undefined,
): OnboardingReason {
  switch (reason) {
    case 'flag_off':
      return 'flag_off';
    case 'index_failed':
      return 'index_failed';
    case 'index_partial':
      return 'index_partial';
    case 'repo_too_large':
      return 'repo_too_large';
    default:
      return 'index_missing';
  }
}

/**
 * The index state as one `{ status, reason }` pair (AC-16, AC-18, AC-19).
 *
 * `reason` is null exactly when the status is `ok`, and never otherwise: a
 * non-`ok` status with no reason is the state a screen cannot explain. When the
 * facade labelled the state itself, that label is used; when it did not, a
 * `partial` index means `index_partial` and everything else means `index_missing`
 * — the same two-step the blast module makes with `indexReason`.
 */
export function mapIndexState(state: OnboardingIndexState): {
  status: OnboardingStatus;
  reason: OnboardingReason | null;
} {
  const status = toOnboardingStatus(state);
  if (status === 'ok') return { status, reason: null };
  const labelled = state.degradedReason ?? (state.status === 'partial' ? 'index_partial' : 'no_data');
  return { status, reason: toOnboardingReason(labelled) };
}

/**
 * Collect everything a generation is allowed to know about the repository.
 *
 * The four reads are independent and run together; the fifth needs the ranked
 * paths, because endpoint facts are only interesting for files the tour might
 * actually name. Every one of them degrades to an empty value rather than
 * throwing, so a repository with no index produces a complete, empty bundle
 * labelled `degraded / index_missing` — which is what lets the caller skip the
 * model call entirely instead of discovering the emptiness afterwards.
 */
export async function collectOnboardingFacts(
  index: OnboardingIndexReader,
  repoId: string,
): Promise<OnboardingFacts> {
  const [state, rankedPaths, criticalChains, repoMap] = await Promise.all([
    index.getIndexState(repoId),
    index.getTopFilesByRank(repoId, MAX_PROMPT_PATHS),
    index.getCriticalPaths(repoId),
    // No token budget: the pipeline only ever renders and caches the facade's own
    // default, so any other number is a guaranteed miss and a degraded map.
    index.getRepoMap(repoId),
  ]);

  const facts = await index.getFileFacts(repoId, rankedPaths);
  const { status, reason } = mapIndexState(state);

  return {
    status,
    reason,
    // The empty string the facade uses for "never indexed" becomes null here, so a
    // consumer cannot render an empty SHA as a link target.
    indexedSha: state.lastIndexedSha === '' ? null : state.lastIndexedSha,
    filesIndexed: state.filesIndexed,
    filesSkipped: state.filesSkipped,
    rankedPaths,
    criticalChains,
    repoMap: repoMap.text,
    endpointFacts: rankFirstFacts(facts, rankedPaths),
  };
}

/**
 * Endpoint/cron rows in the order their files were ranked, capped.
 *
 * Two decisions, both about the cap rather than about the data. Rows carrying
 * neither an endpoint nor a cron are dropped, so the cap counts facts rather than
 * files. And the survivors are ordered by their file's position in the ranked
 * list, because the read makes no promise about row order — leaving it alone would
 * let the database's physical order decide which forty facts the model is shown.
 */
function rankFirstFacts(
  rows: readonly OnboardingFileFacts[],
  rankedPaths: readonly string[],
): OnboardingFileFacts[] {
  const rankOf = new Map(rankedPaths.map((path, i) => [path, i]));
  return rows
    .filter((row) => row.endpoints.length > 0 || row.crons.length > 0)
    .sort((a, b) => (rankOf.get(a.filePath) ?? Infinity) - (rankOf.get(b.filePath) ?? Infinity))
    .slice(0, MAX_ENDPOINT_FACTS);
}
