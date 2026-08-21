/**
 * The Smart Diff role boundary, and the two steps that turn a changed-file list
 * into the one the model input carries — pure. No clock, no I/O, no `this`.
 *
 * WHY THIS FILE EXISTS AT ALL. The role of a changed file is decided by
 * `modules/smart-diff/classify.ts`, which publishes nothing outside its own
 * module. Calling that function from here would compile, pass every test and
 * produce correct output; the only thing that would notice is `depcruise`,
 * because a module reaching into a sibling is a `no-cross-module-internals`
 * violation and `import type` does not exempt it — measured at 22 warnings going
 * to 24 when the blast module did exactly this (`server/INSIGHTS.md`,
 * 2026-08-14). So the CONSUMER declares the narrow shape it needs
 * ({@link FileRoleClassifier}) and the composition root binds an implementation
 * that satisfies it structurally, with no `implements` clause — the
 * `platform/container.ts` `fileRole` arrow property. Nothing here imports a
 * sibling module, an adapter, or anything from `src/db/`.
 *
 * ORDER FIRST, CAP SECOND — never the reverse, and that is the whole point of
 * having two functions instead of one. Capping an unordered list spends the
 * budget on whatever `pr_files` returned, which on a large pull request is
 * dominated by generated and vendored files; the precedent is in the very
 * feature that supplies the ordering, where a split suggestion ranked its
 * buckets by size and advised a too-big pull request to split its LOCK FILE out
 * first (`server/INSIGHTS.md`, 2026-08-11). See `specs/pr-brief.md` AC-60 for
 * the ordering and AC-17 for the cap.
 */
import type { SmartDiffRole } from '@devdigest/shared';

/**
 * The role of one changed file, from its path alone — declared by the consumer.
 *
 * A bare call signature rather than an interface with a method, so the
 * composition root's arrow property satisfies it directly and carries its `this`
 * with it wherever the container is destructured. `featureModel` in that same
 * file has the identical shape for the identical reason.
 *
 * Total, and that is load-bearing: it returns a role for every path, including
 * one that no rule recognises (which is `core`). The classification needs no
 * model call, no index, no clone read and never opens the patch, so there is no
 * state in which a role is unavailable — which is why this ordering has no
 * degraded path and is not a droppable input under AC-14.
 */
export type FileRoleClassifier = (path: string) => SmartDiffRole;

/**
 * Reading order of the roles: the substance of the change first, the machinery
 * that carries it next, the noise last.
 *
 * Declared here rather than imported from the classifier's module, for the
 * reason the file header gives. It has to cover EVERY member of
 * `SmartDiffRole`: a role added to the contract and not added here would drop
 * its files out of the ordered list silently, so `test/brief-file-roles.test.ts`
 * asserts the partition — output length equals input length — rather than
 * trusting this list to stay complete.
 */
const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** The kept head of a capped list, and how many entries it left behind. */
export interface CappedFileList<T> {
  readonly kept: readonly T[];
  /** How many the cap dropped. Reported alongside the list, per AC-17. */
  readonly omitted: number;
}

/**
 * Every `core` file, then every `wiring` file, then every `boilerplate` file,
 * with the input's own order preserved WITHIN each role.
 *
 * Preserving the within-role order is deliberate rather than incidental: this is
 * the list the model reads, and `getPrFiles` issues no `ORDER BY`, so the input
 * arrives in physical heap order. Re-sorting it here — by churn, by path — would
 * be a second ordering opinion for the assembly to disagree with, and the one
 * ordering the requirement names is the role.
 *
 * Generic in the caller's own row type so `additions` and `deletions` travel
 * through untouched (the model input names them per file, AC-2) without this
 * file declaring a row shape it does not itself read. It reads `path`, and
 * nothing else.
 *
 * The classifier is called exactly ONCE per file, not once per role: it is a
 * port, so its cost is not this function's to assume.
 */
export function orderChangedFilesByRole<T extends { readonly path: string }>(
  files: readonly T[],
  classify: FileRoleClassifier,
): T[] {
  const classified = files.map((file) => ({ file, role: classify(file.path) }));

  return ROLE_ORDER.flatMap((role) =>
    classified.filter((entry) => entry.role === role).map((entry) => entry.file),
  );
}

/**
 * The first `cap` entries of an already-ordered list, and the count of what was
 * left off.
 *
 * The cap is a PARAMETER and not a constant read from here: every figure the
 * spec fixes lives together in the module's `constants.ts` (`MAX_PROMPT_PATHS`),
 * and passing it in keeps this file free of the spec's numbers and trivially
 * testable at a small one.
 *
 * Applied to the output of {@link orderChangedFilesByRole} and never to a raw
 * `pr_files` list — see the file header for what that inversion costs.
 */
export function capFileList<T>(ordered: readonly T[], cap: number): CappedFileList<T> {
  const limit = Math.max(0, Math.trunc(cap));

  if (ordered.length <= limit) return { kept: ordered, omitted: 0 };

  return { kept: ordered.slice(0, limit), omitted: ordered.length - limit };
}
