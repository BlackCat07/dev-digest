import type { InsightWindow } from '@devdigest/shared';

/**
 * Wall-clock window boundaries.
 *
 * Windows are aligned to the hour so two passes started a minute apart agree on
 * which window they are closing, which is what makes the closed flag meaningful.
 */
export class HourAlignedWindowClock {
  constructor(private readonly windowHours: number) {}

  currentWindow(repoId: string): InsightWindow {
    const now = new Date();
    const to = new Date(now);
    to.setMinutes(0, 0, 0);
    const from = new Date(to.getTime() - this.windowHours * 3_600_000);

    return {
      repoId,
      from: from.toISOString(),
      to: to.toISOString(),
      weights: {},
    };
  }
}
