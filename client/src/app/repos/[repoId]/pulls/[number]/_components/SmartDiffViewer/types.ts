/* Feature-local view-model types for the Smart Diff (L03b).

   These are NOT the wire contract. `SmartDiff` from `@devdigest/shared` carries
   roles, stats and `finding_lines`; `PrFile` carries the patch text; and
   `FindingRecord[]` carries severity and the accept/dismiss state. The viewer
   needs all three joined per file, and that joined shape is what lives here. */
import type { SmartDiffRole } from "@devdigest/shared";
import type { FindingRecord } from "@devdigest/shared";

/**
 * The role bucket a file is rendered under.
 *
 * `unclassified` is a fourth bucket that exists only on this side. The contract's
 * enum is frozen at three, and a file present in `pr.files` but absent from the
 * response has to go somewhere visible — see `buildViewModel` for why it must not
 * simply be dropped.
 */
export type ViewRole = SmartDiffRole | "unclassified";

/** One changed file, everything the card needs to render it. */
export interface SmartFileVm {
  path: string;
  role: ViewRole;
  additions: number;
  deletions: number;
  /** Unified-diff text from `pr.files`; null when GitHub never sent one. */
  patch: string | null;
  /** Quoted touched symbols from the server; null when there was nothing to quote. */
  summary: string | null;
  /** This file's findings, worst severity first. */
  findings: FindingRecord[];
  /** True when any finding is CRITICAL — the header's dot. */
  hasBlockers: boolean;
}

/** One rendered group: a role, its files, and the totals in its header. */
export interface SmartGroupVm {
  role: ViewRole;
  files: SmartFileVm[];
}
