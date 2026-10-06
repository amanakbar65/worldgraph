import { describe, expect, it } from "vitest";

import { formatCompact, formatMoney, formatPointChange, formatProbability } from "./format";

describe("formatProbability", () => {
  it("rounds to a whole percentage", () => {
    expect(formatProbability(0.623)).toBe("62%");
  });
  it("clamps out-of-range values", () => {
    expect(formatProbability(1.2)).toBe("100%");
    expect(formatProbability(-0.1)).toBe("0%");
  });
});

describe("formatPointChange", () => {
  it("shows an arrow and points", () => {
    expect(formatPointChange(0.08)).toBe("▲ 8");
    expect(formatPointChange(-0.12)).toBe("▼ 12");
    expect(formatPointChange(0.001)).toBe("• 0");
  });
});

describe("locale-aware numbers", () => {
  it("uses lakh/crore for Indian English", () => {
    expect(formatCompact(1_200_000, "en-IN")).toBe("12L");
    expect(formatMoney(1234567, "INR", "en-IN")).toBe("₹12,34,567.00");
  });
  it("uses thousand/million elsewhere", () => {
    expect(formatCompact(1_200_000, "en-US")).toBe("1.2M");
    expect(formatMoney(81.2, "USD", "en-US")).toBe("$81.20");
  });
});
