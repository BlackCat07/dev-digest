import { describe, it, expect } from "vitest";
import type { ConventionScan } from "@devdigest/shared";
import { compactCount, isAllDropped, relativeAge } from "./helpers";

/** Unit-private helpers behind the Conventions screen. Pure — no rendering. */

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function scan(patch: Partial<ConventionScan> = {}): ConventionScan {
  return {
    id: "scan1",
    status: "done",
    commit_sha: "deadbeef",
    eligible_files: 84,
    sampled_files: 84,
    proposed: 12,
    dropped_unverified: 4,
    dropped_low_adherence: 3,
    kept: 5,
    cost_usd: 0.14,
    started_at: "2026-08-06T11:00:00.000Z",
    finished_at: "2026-08-06T11:02:00.000Z",
    error: null,
    ...patch,
  };
}

describe("relativeAge", () => {
  it("collapses anything under a minute to 'just now'", () => {
    expect(relativeAge("2026-08-06T11:59:40.000Z", NOW)).toEqual({ key: "justNow", count: 0 });
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeAge("2026-08-06T11:20:00.000Z", NOW)).toEqual({
      key: "minutesAgo",
      count: 40,
    });
    expect(relativeAge("2026-08-06T09:00:00.000Z", NOW)).toEqual({ key: "hoursAgo", count: 3 });
    expect(relativeAge("2026-08-03T12:00:00.000Z", NOW)).toEqual({ key: "daysAgo", count: 3 });
  });

  it("does not go negative on a clock skew", () => {
    // The server stamps the timestamp; a browser a few seconds behind must not
    // render "-1m ago".
    expect(relativeAge("2026-08-06T12:00:30.000Z", NOW)).toEqual({ key: "justNow", count: 0 });
  });
});

describe("isAllDropped", () => {
  it("is true when a finished scan proposed rules and none survived", () => {
    // The most interesting result this tool produces, and the one a plain empty
    // state would hide behind "you have not scanned yet".
    expect(isAllDropped(scan({ kept: 0 }), 0)).toBe(true);
  });

  it("is false before the first scan", () => {
    expect(isAllDropped(null, 0)).toBe(false);
  });

  it("is false while a scan is still running", () => {
    expect(isAllDropped(scan({ status: "running" }), 0)).toBe(false);
  });

  it("is false when the model proposed nothing at all", () => {
    // Nothing was thrown away — the category genuinely has no convention here.
    expect(isAllDropped(scan({ proposed: 0 }), 0)).toBe(false);
  });

  it("is false as soon as one candidate is on screen", () => {
    expect(isAllDropped(scan(), 5)).toBe(false);
  });

  it("counts a capped scan as finished", () => {
    expect(isAllDropped(scan({ status: "partial" }), 0)).toBe(true);
  });
});

describe("compactCount", () => {
  it("leaves small numbers alone and rounds larger ones to thousands", () => {
    expect(compactCount(84)).toBe("84");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(95_000)).toBe("95k");
    expect(compactCount(1_400)).toBe("1k");
  });
});
