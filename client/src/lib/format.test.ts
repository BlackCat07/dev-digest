import { describe, it, expect } from "vitest";
import { formatCost, formatTokenFlow, formatTokenTotal } from "./format";

describe("formatCost", () => {
  it('renders absent data as "—", never as a number', () => {
    // The whole point of the dash: a provider that reported no cost is not the
    // same as a run that was free, and "$0.00" would claim the latter.
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(NaN)).toBe("—");
    expect(formatCost(Infinity)).toBe("—");
  });

  it('renders a genuinely free run as "$0"', () => {
    // pricing.ts lists z-ai/glm-4.7-flash at {in: 0, out: 0}, so cost_usd = 0 is
    // a real stored value. Without this branch the adaptive rule would print the
    // unreadable "$0.0000".
    expect(formatCost(0)).toBe("$0");
  });

  it("uses 4dp below a cent", () => {
    expect(formatCost(0.0004)).toBe("$0.0004");
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.009999)).toBe("$0.0100");
  });

  it("uses 3dp below a dollar", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.06)).toBe("$0.060");
    expect(formatCost(0.999)).toBe("$0.999");
  });

  it("uses 2dp from a dollar up", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.2449)).toBe("$1.24");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("formatTokenTotal", () => {
  it("sums in+out and groups thousands", () => {
    expect(formatTokenTotal(8200, 919)).toBe("9,119 tok");
    expect(formatTokenTotal(12011, 0)).toBe("12,011 tok");
    expect(formatTokenTotal(0, 0)).toBe("0 tok");
  });

  it("treats one missing half as zero, but both missing as absent", () => {
    expect(formatTokenTotal(8200, null)).toBe("8,200 tok");
    expect(formatTokenTotal(null, 919)).toBe("919 tok");
    expect(formatTokenTotal(null, null)).toBe("—");
    expect(formatTokenTotal(undefined, undefined)).toBe("—");
  });
});

describe("formatTokenFlow", () => {
  it("scales to thousands and trims a trailing .0", () => {
    expect(formatTokenFlow(8200, 1300)).toBe("8.2K→1.3K");
    expect(formatTokenFlow(12000, 1500)).toBe("12K→1.5K");
    expect(formatTokenFlow(15000, 1200)).toBe("15K→1.2K");
  });

  it('renders "—" when either half is missing', () => {
    expect(formatTokenFlow(8200, null)).toBe("—");
    expect(formatTokenFlow(null, 1300)).toBe("—");
    expect(formatTokenFlow(undefined, undefined)).toBe("—");
  });
});
