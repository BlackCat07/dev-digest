/**
 * `activeKeyFor` — which sidebar entry the current pathname lights up.
 *
 * Covers AC-32 of `specs/onboarding-generator.md`. The helper had no test at
 * all before this file, and its only consumer is
 * `components/app-shell/hooks/useShellContext.ts`.
 *
 * EC-25 is the whole reason the criterion exists: `/onboarding` is the
 * ADD-A-REPOSITORY screen (`src/app/onboarding/page.tsx`), and a
 * `pathname.includes("/onboarding")` clause marked the Onboarding Tour entry
 * active on it. The two cases below are the pair — the repo-scoped route lights
 * the entry up, the add-repository route does not — and asserting either alone
 * would be satisfied by the wrong implementation.
 */
import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("marks the Onboarding Tour entry active only on the repo-scoped tour route (AC-32)", () => {
    expect(activeKeyFor("/repos/r1/onboarding")).toBe("onboarding-tour");
    // A repo id is any single segment, and a deeper path under the route still
    // belongs to it.
    expect(activeKeyFor("/repos/acme%2Fpayments-api/onboarding")).toBe("onboarding-tour");
    expect(activeKeyFor("/repos/r1/onboarding/anything")).toBe("onboarding-tour");

    // EC-25: the add-a-repository screen. Adding a repository is not a WORKSPACE
    // screen, so NO entry is active there — asserted as the empty key rather
    // than merely "not onboarding-tour", because falling through to some other
    // entry would be a different bug with the same passing assertion.
    expect(activeKeyFor("/onboarding")).toBe("");
    expect(activeKeyFor("/onboarding/step-2")).toBe("");
  });

  it("leaves the rest of the first-match-wins ladder alone", () => {
    // The clause AC-32 replaced sits above these, so a regression in it would
    // silently capture them: `/repos/r1/context` contains no "/onboarding", but
    // an over-broad new pattern (say, one anchored only on `/repos/`) would.
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/pulls/482")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/context")).toBe("context");
    expect(activeKeyFor("/repos/r1/conventions")).toBe("conventions");
    expect(activeKeyFor("/settings/models")).toBe("settings");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents/a1")).toBe("agents");
    expect(activeKeyFor("/")).toBe("");
  });
});
