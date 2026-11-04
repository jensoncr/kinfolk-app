import { describe, expect, it } from "vitest";
import {
  normalizeE164,
  normalizePhoneE164,
  normalizeSmsRecipient,
} from "./phone";

describe("phone normalization", () => {
  it("keeps existing E.164-style normalization behavior", () => {
    expect(normalizeE164("(415) 555-0100")).toBe("+4155550100");
    expect(normalizeE164("")).toBe("");
    expect(normalizeSmsRecipient("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizeSmsRecipient("(415) 555-0100")).toBe("4155550100");
  });

  it("only reports verified profile phones for plausible phone values", () => {
    expect(normalizePhoneE164("  +1 (415) 555-0100  ")).toBe(
      "+14155550100",
    );
    expect(normalizePhoneE164("not verified")).toBe("");
    expect(normalizePhoneE164("123456")).toBe("");
    expect(normalizePhoneE164("   ")).toBe("");
  });

  it("normalizes plausible phone handles for persisted app state", () => {
    expect(normalizePhoneE164("  (415) 555-0100  ")).toBe("+4155550100");
    expect(normalizePhoneE164("agent")).toBe("");
    expect(normalizePhoneE164("123456")).toBe("");
  });
});
