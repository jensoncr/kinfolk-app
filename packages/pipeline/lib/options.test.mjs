import { describe, expect, it } from "vitest";
import {
  readBooleanOption,
  readEnumStringOption,
  readFiniteNumberOption,
  readNonEmptyStringOption,
  readOptionalFiniteNumberOption,
} from "./options.mjs";

describe("script option helpers", () => {
  it("trims non-empty strings and falls back for blank values", () => {
    expect(readNonEmptyStringOption(" oakland-ca ", "san-francisco-ca")).toBe(
      "oakland-ca",
    );
    expect(readNonEmptyStringOption("   ", "san-francisco-ca")).toBe(
      "san-francisco-ca",
    );
    expect(readNonEmptyStringOption(undefined, "san-francisco-ca")).toBe(
      "san-francisco-ca",
    );
  });

  it("normalizes string booleans with fallback for blank or unknown values", () => {
    expect(readBooleanOption(" TRUE ", false)).toBe(true);
    expect(readBooleanOption(" false ", true)).toBe(false);
    expect(readBooleanOption(" ", true)).toBe(true);
    expect(readBooleanOption("yes", false)).toBe(false);
  });

  it("trims enum strings and rejects unsupported values", () => {
    expect(readEnumStringOption(" redfin ", "redfin", ["redfin"], "provider")).toBe(
      "redfin",
    );
    expect(readEnumStringOption("   ", "redfin", ["redfin"], "provider")).toBe(
      "redfin",
    );
    expect(() =>
      readEnumStringOption("other", "redfin", ["redfin"], "provider"),
    ).toThrow("provider must be one of: redfin.");
  });

  it("defaults bad integer options instead of coercing blanks to zero", () => {
    expect(readFiniteNumberOption("12", 100, { integer: true })).toBe(12);
    expect(readFiniteNumberOption("", 100, { integer: true })).toBe(100);
    expect(readFiniteNumberOption("   ", 100, { integer: true })).toBe(100);
    expect(readFiniteNumberOption(false, 100, { integer: true })).toBe(100);
    expect(readFiniteNumberOption("12.5", 100, { integer: true })).toBe(100);
  });

  it("clamps finite numeric options into the accepted range", () => {
    expect(readFiniteNumberOption("999", 100, { integer: true, max: 250 })).toBe(
      250,
    );
    expect(readFiniteNumberOption("-5", 100, { integer: true, min: 1 })).toBe(1);
  });

  it("keeps optional numeric options unset for blank or invalid values", () => {
    expect(readOptionalFiniteNumberOption("0.25")).toBe(0.25);
    expect(readOptionalFiniteNumberOption("   ")).toBeUndefined();
    expect(readOptionalFiniteNumberOption("many")).toBeUndefined();
  });
});
