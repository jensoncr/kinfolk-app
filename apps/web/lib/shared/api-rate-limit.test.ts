import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ rpc: rpcMock }),
}));

import { enforceApiUserRateLimit } from "./api-rate-limit";

beforeEach(() => {
  rpcMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enforceApiUserRateLimit", () => {
  it("allows the request and namespaces the bucket when under budget", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true }], error: null });

    const result = await enforceApiUserRateLimit({
      userId: "user-1",
      bucketType: "profile_patch",
      limit: 30,
      window: "minute",
    });

    expect(result).toBe(null);
    expect(rpcMock).toHaveBeenCalledWith(
      "hit_text_agent_rate_limit",
      expect.objectContaining({ p_bucket_type: "api:profile_patch", p_limit: 30 }),
    );
    // The user id is hashed, never sent in the clear.
    const args = rpcMock.mock.calls[0][1] as { p_bucket_key: string };
    expect(args.p_bucket_key).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_bucket_key).not.toContain("user-1");
  });

  it("returns a 429 with a Retry-After header when over budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:34:56.500Z"));
    rpcMock.mockResolvedValue({ data: [{ allowed: false }], error: null });

    const result = await enforceApiUserRateLimit({
      userId: "user-1",
      bucketType: "locations_search",
      limit: 1,
      window: "hour",
    });

    expect(result).not.toBe(null);
    expect(result?.status).toBe(429);
    expect(result?.headers.get("Retry-After")).toBe("1504");
    await expect(result?.json()).resolves.toEqual({
      error: "Too many requests. Please slow down and try again shortly.",
      status: "rate_limited",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "hit_text_agent_rate_limit",
      expect.objectContaining({
        p_window_start: "2026-07-11T12:00:00.000Z",
      }),
    );
  });

  it("fails open (allows) when the counter RPC errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: new Error("rpc down") });

    const result = await enforceApiUserRateLimit({
      userId: "user-1",
      bucketType: "imports",
      limit: 5,
      window: "day",
    });

    expect(result).toBe(null);
    consoleError.mockRestore();
  });
});
