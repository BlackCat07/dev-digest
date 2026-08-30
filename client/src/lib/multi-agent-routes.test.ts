/* `resultsRoute` is where a reader's way into a multi-agent run is decided —
   from the picker after a fan-out, and from the pull-request header for a run
   that already exists. A miss returns null rather than the current path:
   navigating a reader back to the page they are already on reads as "the button
   did nothing", which is the failure mode this test pins.

   Moved here with the helper itself; it used to sit in `AgentPicker.test.tsx`,
   when the picker was the only consumer. */
import { describe, it, expect } from "vitest";
import { resultsRoute } from "./multi-agent-routes";

describe("resultsRoute", () => {
  it("turns a pull-request path into that pull request's results route", () => {
    expect(resultsRoute("/repos/repo-1/pulls/482")).toBe("/repos/repo-1/multi-agent/482");
    // A deeper path still resolves to the same pull request. A query string
    // cannot appear here — `usePathname` strips it — so it is not a case.
    expect(resultsRoute("/repos/repo-1/pulls/482/anything")).toBe(
      "/repos/repo-1/multi-agent/482",
    );
    expect(resultsRoute("/repos/repo-1/pulls")).toBeNull();
    expect(resultsRoute(null)).toBeNull();
    expect(resultsRoute(undefined)).toBeNull();
  });
});
