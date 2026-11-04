import { describe, expect, it } from "vitest";
import { clampInteger } from "./numbers";

describe("clampInteger", () => {
  it("uses the default for blank, nullish, boolean, and non-integer values", () => {
    expect(clampInteger("", 5, 1, 25)).toBe(5);
    expect(clampInteger("   ", 5, 1, 25)).toBe(5);
    expect(clampInteger(null, 5, 1, 25)).toBe(5);
    expect(clampInteger(undefined, 5, 1, 25)).toBe(5);
    expect(clampInteger(false, 5, 1, 25)).toBe(5);
    expect(clampInteger(true, 5, 1, 25)).toBe(5);
    expect(clampInteger("12.5", 5, 1, 25)).toBe(5);
    expect(clampInteger(Number.NaN, 5, 1, 25)).toBe(5);
  });

  it("clamps integer numbers and nonblank integer strings", () => {
    expect(clampInteger(12, 5, 1, 25)).toBe(12);
    expect(clampInteger(" 12 ", 5, 1, 25)).toBe(12);
    expect(clampInteger(999, 5, 1, 25)).toBe(25);
    expect(clampInteger("-10", 5, 1, 25)).toBe(1);
  });
});
