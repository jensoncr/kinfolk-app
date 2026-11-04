import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/shared/api-error";
import { POST as postChallenge } from "./challenge/route";
import { POST as postQrCode } from "./qrcode/route";
import { POST as postInterviewHandoff } from "../interview/handoff/route";

const mocks = vi.hoisted(() => ({
  createContinueOnPhoneChallengeForCurrentUser: vi.fn(),
  createInterviewOnPhoneHandoffForCurrentUser: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  qrToString: vi.fn(),
}));

vi.mock("@/lib/text-agent/store", () => ({
  createContinueOnPhoneChallengeForCurrentUser:
    mocks.createContinueOnPhoneChallengeForCurrentUser,
  createInterviewOnPhoneHandoffForCurrentUser:
    mocks.createInterviewOnPhoneHandoffForCurrentUser,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("qrcode", () => ({
  default: {
    toString: mocks.qrToString,
  },
}));

const challenge = {
  code: "123456",
  expiresAt: "2026-06-21T22:00:00.000Z",
  kind: "verification_challenge",
  link: "sms:+15551234567?body=123456",
  message: "123456",
  phoneNumber: "+15551234567",
};

const interviewHandoff = {
  kind: "agent_thread",
  link: "sms:+15551234567?body=START",
  message: "START",
  phoneNumber: "+15551234567",
};

function jsonRequest(body: unknown, url = "https://kinfolk.test/api/kinfolk/continue-on-phone/qrcode") {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("continue on phone routes", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createContinueOnPhoneChallengeForCurrentUser.mockResolvedValue(challenge);
    mocks.createInterviewOnPhoneHandoffForCurrentUser.mockResolvedValue(interviewHandoff);
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: null,
      user: { id: "user-1" },
    });
    mocks.qrToString.mockResolvedValue("<svg>qr</svg>");
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("creates a continue-on-phone verification challenge", async () => {
    const response = await postChallenge();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      challenge,
      ok: true,
    });
    expect(mocks.createContinueOnPhoneChallengeForCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("rejects signed-out challenge requests before creating handoffs", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await postChallenge();

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before creating phone handoff.",
    });
    expect(mocks.createContinueOnPhoneChallengeForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces unavailable text-agent challenge failures as handoff errors", async () => {
    mocks.createContinueOnPhoneChallengeForCurrentUser.mockRejectedValueOnce(
      new ApiError("Sendblue text agent is not configured."),
    );

    const response = await postChallenge();

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sendblue text agent is not configured.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected challenge creation failures", async () => {
    mocks.createContinueOnPhoneChallengeForCurrentUser.mockRejectedValueOnce(
      new Error("phone handoff store unavailable: private detail"),
    );

    const response = await postChallenge();

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Could not create phone handoff.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[phone-handoff] challenge creation failed",
      { error: expect.any(Error) },
    );
  });

  it("creates an interview handoff for the phone agent", async () => {
    const response = await postInterviewHandoff();

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({
      challenge: interviewHandoff,
      ok: true,
    });
    expect(mocks.createInterviewOnPhoneHandoffForCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("rejects signed-out interview handoff requests before creating handoffs", async () => {
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    const response = await postInterviewHandoff();

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sign in before creating interview handoff.",
    });
    expect(mocks.createInterviewOnPhoneHandoffForCurrentUser).not.toHaveBeenCalled();
  });

  it("surfaces unavailable text-agent interview handoff failures", async () => {
    mocks.createInterviewOnPhoneHandoffForCurrentUser.mockRejectedValueOnce(
      new ApiError("Sendblue text agent is not configured."),
    );

    const response = await postInterviewHandoff();

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Sendblue text agent is not configured.",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("redacts unexpected interview handoff failures", async () => {
    mocks.createInterviewOnPhoneHandoffForCurrentUser.mockRejectedValueOnce(
      new Error("interview handoff store unavailable: private detail"),
    );

    const response = await postInterviewHandoff();

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Could not create interview handoff.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[phone-handoff] interview handoff failed",
      { error: expect.any(Error) },
    );
  });

  it("generates QR codes only for allowed local handoff targets and clamps size", async () => {
    const response = await postQrCode(
      jsonRequest({
        size: 999,
        url: "https://kinfolk.test/me?continue=phone",
      }),
    );

    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.ok).toBe(true);
    expect(body.qrcode).toEqual({
      url: `data:image/svg+xml;base64,${Buffer.from("<svg>qr</svg>").toString("base64")}`,
    });
    expect(mocks.qrToString).toHaveBeenCalledWith(
      "https://kinfolk.test/me?continue=phone",
      expect.objectContaining({
        color: {
          dark: "#0f1a14",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
        margin: 1,
        type: "svg",
        width: 360,
      }),
    );
  });

  it("generates QR codes for sms links and clamps small sizes", async () => {
    const response = await postQrCode(
      jsonRequest({
        size: 40,
        url: "sms:+15551234567?body=START",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.qrToString).toHaveBeenCalledWith(
      "sms:+15551234567?body=START",
      expect.objectContaining({ width: 160 }),
    );
  });

  it("normalizes uppercase SMS QR links before rendering", async () => {
    const response = await postQrCode(
      jsonRequest({
        url: " SMS:+15551234567?body=START ",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.qrToString).toHaveBeenCalledWith(
      "sms:+15551234567?body=START",
      expect.objectContaining({ width: 250 }),
    );
  });

  it("rejects unsupported external QR targets before rendering", async () => {
    const response = await postQrCode(
      jsonRequest({
        url: "https://example.com/me?continue=phone",
      }),
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "Unsupported QR target.",
    });
    expect(mocks.qrToString).not.toHaveBeenCalled();
  });

  it("rejects external messaging QR targets before rendering", async () => {
    for (const url of [
      "https://wa.me/15551234567?text=START",
      "https://api.whatsapp.com/send?phone=15551234567&text=START",
    ]) {
      const response = await postQrCode(jsonRequest({ url }));

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toEqual({
        error: "Unsupported QR target.",
      });
    }
    expect(mocks.qrToString).not.toHaveBeenCalled();
  });

  it("treats malformed or non-object QR bodies as unsupported targets", async () => {
    for (const request of [
      new Request("https://kinfolk.test/api/kinfolk/continue-on-phone/qrcode", {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      jsonRequest(null),
      jsonRequest(["https://kinfolk.test/me"]),
      jsonRequest("https://kinfolk.test/me"),
    ]) {
      const response = await postQrCode(request);

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toEqual({
        error: "Unsupported QR target.",
      });
    }
    expect(mocks.qrToString).not.toHaveBeenCalled();
  });

  it("redacts QR generation errors if the renderer fails", async () => {
    mocks.qrToString.mockRejectedValueOnce(
      new Error("QR renderer unavailable: private detail"),
    );

    const response = await postQrCode(
      jsonRequest({
        url: "https://kinfolk.test/qr?link=sms%3A%2B15551234567%3Fbody%3DSTART",
      }),
    );

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error: "Could not generate QR code.",
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[phone-handoff] QR code generation failed",
      { error: expect.any(Error) },
    );
  });
});
