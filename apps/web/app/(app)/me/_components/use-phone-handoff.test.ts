import { describe, expect, it } from "vitest";
import {
  normalizePhoneChallengeResponse,
  normalizePhoneHandoffLink,
  readJsonResponse,
  readResponseErrorMessage,
  shouldRequestQrCode,
} from "./use-phone-handoff";

describe("shouldRequestQrCode", () => {
  it("skips empty and in-flight QR targets", () => {
    expect(
      shouldRequestQrCode({
        inFlightTarget: null,
        result: null,
        target: "",
      }),
    ).toBe(false);
    expect(
      shouldRequestQrCode({
        inFlightTarget: "https://kinfolk.test/me?continue=phone",
        result: null,
        target: "https://kinfolk.test/me?continue=phone",
      }),
    ).toBe(false);
  });

  it("does not refetch a successful QR result for the same target", () => {
    expect(
      shouldRequestQrCode({
        inFlightTarget: null,
        result: {
          error: null,
          target: "https://kinfolk.test/me?continue=phone",
          url: "data:image/svg+xml;base64,abc",
        },
        target: "https://kinfolk.test/me?continue=phone",
      }),
    ).toBe(false);
  });

  it("allows retrying a failed QR request for the same target", () => {
    expect(
      shouldRequestQrCode({
        inFlightTarget: null,
        result: {
          error: "Could not generate QR code.",
          target: "https://kinfolk.test/me?continue=phone",
          url: null,
        },
        target: "https://kinfolk.test/me?continue=phone",
      }),
    ).toBe(true);
  });

  it("allows a new target even when another target has cached state", () => {
    expect(
      shouldRequestQrCode({
        inFlightTarget: null,
        result: {
          error: null,
          target: "https://kinfolk.test/me?continue=phone",
          url: "data:image/svg+xml;base64,abc",
        },
        target: "sms:+15551234567?body=START",
      }),
    ).toBe(true);
  });
});

describe("phone handoff response parsing", () => {
  it("normalizes challenge links before storing or opening them", () => {
    expect(normalizePhoneHandoffLink(" sms:+15551234567?body=START \n")).toBe(
      "sms:+15551234567?body=START",
    );
    expect(normalizePhoneHandoffLink(" SMS:+15551234567?body=START ")).toBe(
      "sms:+15551234567?body=START",
    );
    expect(
      normalizePhoneChallengeResponse({
        challenge: {
          kind: "agent_thread",
          link: " sms:+15551234567?body=START \n",
          message: "START",
          phoneNumber: "+15551234567",
        },
        ok: true,
      }),
    ).toMatchObject({
      link: "sms:+15551234567?body=START",
      phoneNumber: "+15551234567",
    });
  });

  it("rejects non-SMS challenge links before direct mobile redirects or QR wrapping", () => {
    expect(normalizePhoneHandoffLink("https://example.com/me?continue=phone")).toBe("");
    expect(
      normalizePhoneChallengeResponse({
        challenge: {
          kind: "agent_thread",
          link: "https://example.com/me?continue=phone",
          phoneNumber: "+15551234567",
        },
        ok: true,
      }),
    ).toBeNull();
  });

  it("trims verification handoff instructions before display", () => {
    expect(
      normalizePhoneChallengeResponse({
        challenge: {
          code: " 123456 ",
          expiresAt: " 2026-06-21T22:00:00.000Z ",
          kind: "verification_challenge",
          link: " sms:+15551234567?body=123456 ",
          message: " 123456 ",
          phoneNumber: " +15551234567 ",
        },
        ok: true,
      }),
    ).toEqual({
      code: "123456",
      expiresAt: "2026-06-21T22:00:00.000Z",
      kind: "verification_challenge",
      link: "sms:+15551234567?body=123456",
      message: "123456",
      phoneNumber: "+15551234567",
    });
  });

  it("rejects blank challenge links after trimming", () => {
    expect(
      normalizePhoneChallengeResponse({
        challenge: {
          kind: "agent_thread",
          link: "   ",
          message: "START",
          phoneNumber: "+15551234567",
        },
        ok: true,
      }),
    ).toBeNull();
  });

  it("rejects SMS links without a phone-like recipient before opening Messages", () => {
    expect(normalizePhoneHandoffLink("sms:")).toBe("");
    expect(normalizePhoneHandoffLink(" sms:?body=START ")).toBe("");
    expect(normalizePhoneHandoffLink("sms:kinfolk-agent?body=START")).toBe("");
    expect(normalizePhoneHandoffLink("sms:+1 (555) 123-4567?body=START")).toBe(
      "sms:+15551234567?body=START",
    );
    expect(
      normalizePhoneChallengeResponse({
        challenge: {
          kind: "verification_challenge",
          expiresAt: "2026-06-21T22:00:00.000Z",
          link: "sms:?body=123456",
          message: "123456",
          phoneNumber: "+15551234567",
        },
        ok: true,
      }),
    ).toBeNull();
  });

  it("rejects incomplete challenge instructions before they reach the UI", () => {
    for (const challenge of [
      {
        kind: "verification_challenge",
        link: "sms:+15551234567?body=123456",
        message: "123456",
      },
      {
        kind: "verification_challenge",
        link: "sms:+15551234567?body=123456",
        message: " ",
        expiresAt: "2026-06-21T22:00:00.000Z",
        phoneNumber: "+15551234567",
      },
      {
        kind: "verification_challenge",
        link: "sms:+15551234567?body=123456",
        message: "123456",
        phoneNumber: "+15551234567",
      },
      {
        kind: "verification_challenge",
        link: "sms:+15551234567?body=123456",
        message: "123456",
        expiresAt: "not-a-date",
        phoneNumber: "+15551234567",
      },
      {
        kind: "agent_thread",
        link: "sms:+15551234567",
      },
      {
        kind: "unknown",
        link: "sms:+15551234567",
        phoneNumber: "+15551234567",
      },
    ]) {
      expect(
        normalizePhoneChallengeResponse({
          challenge: challenge as never,
          ok: true,
        }),
      ).toBeNull();
    }
  });

  it("falls back to an empty object for non-JSON responses", async () => {
    await expect(
      readJsonResponse<{ error?: string }>(
        new Response("<html>Server error</html>", {
          headers: { "content-type": "text/html" },
          status: 502,
        }),
      ),
    ).resolves.toEqual({});
  });

  it("ignores array or primitive JSON response bodies", async () => {
    await expect(readJsonResponse(new Response("[1,2,3]"))).resolves.toEqual({});
    await expect(readJsonResponse(new Response("12"))).resolves.toEqual({});
  });

  it("uses friendly fallback copy when an error body is missing or blank", () => {
    expect(readResponseErrorMessage({}, "Could not prepare Messages.")).toBe(
      "Could not prepare Messages.",
    );
    expect(readResponseErrorMessage({ error: " " }, "Could not generate QR code.")).toBe(
      "Could not generate QR code.",
    );
    expect(readResponseErrorMessage({ error: "Store unavailable." }, "Fallback")).toBe(
      "Store unavailable.",
    );
    expect(readResponseErrorMessage({ error: "  Store unavailable. \n" }, "Fallback")).toBe(
      "Store unavailable.",
    );
  });
});
