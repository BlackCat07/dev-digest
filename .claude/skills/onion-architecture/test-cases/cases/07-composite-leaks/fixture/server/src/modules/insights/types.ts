/** The projection `snapshotsFor` returns, named so callers do not depend on the table. */
export interface InsightRow {
  repoId: string;
  runs: number;
  reliability: number;
  worstAgent: string | null;
}
