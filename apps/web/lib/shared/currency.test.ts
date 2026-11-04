import { describe, expect, it } from "vitest";
import { formatCurrency } from "./currency";

describe("formatCurrency", () => {
  it("formats whole dollars with no fraction digits", () => {
    expect(formatCurrency(2500)).toBe("$2,500");
  });
  it("rounds away cents (maximumFractionDigits: 0)", () => {
    expect(formatCurrency(2500.75)).toBe("$2,501");
  });
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0");
  });
  it("uses en-US grouping for large amounts", () => {
    expect(formatCurrency(1234567)).toBe("$1,234,567");
  });
});
