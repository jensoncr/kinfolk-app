import { describe, expect, it } from "vitest";
import { scoreFallbackRent } from "./listing-fallback-rent";

describe("scoreFallbackRent", () => {
  it("never penalizes low per-person rents from large-group splits", () => {
    expect(scoreFallbackRent(700)).toBe(14);
    expect(scoreFallbackRent(1199)).toBe(14);
    expect(scoreFallbackRent(1199)).toBe(scoreFallbackRent(3200));
  });

  it("keeps the mid-range band at full score", () => {
    expect(scoreFallbackRent(4000)).toBe(14);
  });

  it("tapers high per-person rents", () => {
    expect(scoreFallbackRent(4200)).toBe(5);
    expect(scoreFallbackRent(5200)).toBe(-8);
  });

  it("treats unknown rent as neutral", () => {
    expect(scoreFallbackRent(null)).toBe(6);
  });
});
