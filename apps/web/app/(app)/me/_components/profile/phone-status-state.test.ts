import { describe, expect, it } from "vitest";
import {
  canReusePhoneHandoff,
  getVerifiedPhone,
  getPhoneStatusPendingMessage,
  resolvePhoneStatusCheck,
} from "./phone-status-state";

describe("resolvePhoneStatusCheck", () => {
  it("returns a verified result with a trimmed phone number", () => {
    expect(getVerifiedPhone({ phone: "  +14155550100  ", phoneVerified: true })).toBe(
      "+14155550100",
    );
    expect(
      resolvePhoneStatusCheck(
        { phone: "  +14155550100  ", phoneVerified: true },
        true,
      ),
    ).toEqual({
      kind: "verified",
      phone: "+14155550100",
    });
  });

  it("returns enabled pending copy when no verified phone exists", () => {
    expect(resolvePhoneStatusCheck({ phone: "", phoneVerified: false }, true)).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Send the text, then check again.",
    });
  });

  it("returns not-configured pending copy when texting is disabled", () => {
    expect(resolvePhoneStatusCheck({ phone: "", phoneVerified: false }, false)).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Kinfolk texting is not configured.",
    });
    expect(getPhoneStatusPendingMessage(false)).toBe(
      "No Kinfolk-verified phone yet. Kinfolk texting is not configured.",
    );
  });

  it("does not treat a verified response without a phone number as complete", () => {
    expect(resolvePhoneStatusCheck({ phoneVerified: true }, true)).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Send the text, then check again.",
    });
    expect(resolvePhoneStatusCheck({ phone: "Not verified", phoneVerified: true }, true)).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Send the text, then check again.",
    });
    expect(getVerifiedPhone({ phone: "555", phoneVerified: true })).toBeNull();
    expect(getVerifiedPhone({ phone: "agent", phoneVerified: true })).toBeNull();
    expect(resolvePhoneStatusCheck({ phone: "555", phoneVerified: true }, true)).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Send the text, then check again.",
    });
  });

  it("requires a literal verified boolean before completing phone verification", () => {
    expect(getVerifiedPhone({ phone: "+14155550100", phoneVerified: "true" })).toBeNull();
    expect(getVerifiedPhone({ phone: "+14155550100", phoneVerified: 1 })).toBeNull();
    expect(
      resolvePhoneStatusCheck({ phone: "+14155550100", phoneVerified: "false" }, true),
    ).toEqual({
      kind: "pending",
      message: "No Kinfolk-verified phone yet. Send the text, then check again.",
    });
  });

  it("reuses only non-expired verification phone handoffs", () => {
    expect(
      canReusePhoneHandoff(
        {
          kind: "verification_challenge",
          link: "sms:+15551234567?body=123456",
          expiresAt: "2026-06-22T12:01:00.000Z",
        },
        Date.parse("2026-06-22T12:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      canReusePhoneHandoff(
        {
          kind: "verification_challenge",
          link: "sms:+15551234567?body=123456",
          expiresAt: "2026-06-22T12:00:20.000Z",
        },
        Date.parse("2026-06-22T12:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      canReusePhoneHandoff(
        {
          kind: "agent_thread",
          link: "sms:+15551234567?body=START",
        },
        Date.parse("2026-06-22T12:00:00.000Z"),
      ),
    ).toBe(false);
    expect(canReusePhoneHandoff({ kind: "agent_thread", link: " " })).toBe(false);
  });
});
