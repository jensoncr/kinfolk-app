import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
  findVerifiedPhoneForUser: vi.fn(),
  getPhoneVerificationProvider: vi.fn(),
  getTextTransportDisplayName: vi.fn(),
  getTextTransportFromNumber: vi.fn(),
  isTextAgentEnabled: vi.fn(),
  randomUUID: vi.fn(),
  requireBoundarySecret: vi.fn(),
  startMatchingInterviewForUser: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    randomUUID: mocks.randomUUID,
  };
});

vi.mock("@/lib/integrations/text-transport", () => ({
  getPhoneVerificationProvider: mocks.getPhoneVerificationProvider,
  getTextTransportDisplayName: mocks.getTextTransportDisplayName,
  getTextTransportFromNumber: mocks.getTextTransportFromNumber,
  isTextAgentEnabled: mocks.isTextAgentEnabled,
}));

vi.mock("@/lib/shared/secrets", () => ({
  requireBoundarySecret: mocks.requireBoundarySecret,
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/text-agent/interview-state", () => ({
  startMatchingInterviewForUser: mocks.startMatchingInterviewForUser,
}));

vi.mock("@/lib/text-agent/phone-verification", () => ({
  findVerifiedPhoneForUser: mocks.findVerifiedPhoneForUser,
}));

import {
  createContinueOnPhoneChallengeForCurrentUser,
  createInterviewOnPhoneHandoffForCurrentUser,
} from "./phone-handoff";

function createChallengeClient() {
  const activeChallengeQuery = {
    eq: vi.fn(() => activeChallengeQuery),
    gt: vi.fn(() => activeChallengeQuery),
    is: vi.fn(() => activeChallengeQuery),
    limit: vi.fn(() => activeChallengeQuery),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    order: vi.fn(() => activeChallengeQuery),
  };
  const expireQuery = {
    eq: vi.fn(() => expireQuery),
    error: null,
    gt: vi.fn(() => expireQuery),
    is: vi.fn(() => expireQuery),
  };
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("phone_verification_challenges");
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push(payload);
          return { error: null };
        }),
        select: vi.fn(() => activeChallengeQuery),
        update: vi.fn(() => expireQuery),
      };
    }),
  };

  return {
    activeChallengeQuery,
    client,
    expireQuery,
    inserts,
  };
}

describe("phone handoff builders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { subject: "clerk-user" },
      user: { id: "user-1" },
    });
    mocks.findVerifiedPhoneForUser.mockResolvedValue(null);
    mocks.getPhoneVerificationProvider.mockReturnValue("linq");
    mocks.getTextTransportDisplayName.mockReturnValue("Linq");
    mocks.getTextTransportFromNumber.mockReturnValue("+1 (555) 123-4567");
    mocks.isTextAgentEnabled.mockReturnValue(true);
    mocks.randomUUID.mockReturnValue("00000000-0000-4000-8000-000000000001");
    mocks.requireBoundarySecret.mockReturnValue("phone-secret");
    mocks.startMatchingInterviewForUser.mockResolvedValue(undefined);
  });

  it("creates verification SMS handoff links with a canonical body query", async () => {
    const stub = createChallengeClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);

    const handoff = await createContinueOnPhoneChallengeForCurrentUser();

    expect(handoff.kind).toBe("verification_challenge");
    expect(handoff.link).toMatch(/^sms:\+15551234567\?body=/);
    expect(handoff.link).not.toContain("?&body=");
    expect(new URLSearchParams(handoff.link.split("?")[1]).get("body")).toBe(
      handoff.message,
    );
    expect(handoff.message).toMatch(/^KIN VERIFY [A-Z0-9]{6}$/);
    expect(stub.inserts).toEqual([
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000001",
        provider: "linq",
        user_id: "user-1",
      }),
    ]);
  });

  it("creates verified-user agent thread links with a canonical body query", async () => {
    const stub = createChallengeClient();
    mocks.createSupabaseServiceClient.mockReturnValue(stub.client);
    mocks.findVerifiedPhoneForUser.mockResolvedValue({
      id: "phone-1",
      phone_e164: "+14155550100",
      sms_consent_state: "opted_in",
      user_id: "user-1",
      verified_at: "2026-06-24T12:00:00.000Z",
    });

    const handoff = await createInterviewOnPhoneHandoffForCurrentUser();

    expect(handoff.kind).toBe("agent_thread");
    expect(handoff.link).toMatch(/^sms:\+15551234567\?body=/);
    expect(handoff.link).not.toContain("?&body=");
    expect(new URLSearchParams(handoff.link.split("?")[1]).get("body")).toBe(
      handoff.message,
    );
    expect(mocks.startMatchingInterviewForUser).toHaveBeenCalledWith(
      stub.client,
      "user-1",
    );
    expect(stub.inserts).toEqual([]);
  });
});
