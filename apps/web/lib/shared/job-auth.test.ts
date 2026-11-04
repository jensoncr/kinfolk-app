import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { isAuthorizedJobRequest } from "./job-auth";

function jobRequest(headers: Record<string, string> = {}) {
  return new Request("https://kinfolk.example.com/api/jobs/test", {
    headers,
    method: "POST",
  }) as unknown as NextRequest;
}

describe("isAuthorizedJobRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes the dedicated header when the secret matches", () => {
    vi.stubEnv("KINFOLK_JOBS_SECRET", "jobs-secret");

    expect(
      isAuthorizedJobRequest(jobRequest({ "x-kinfolk-job-secret": "jobs-secret" })),
    ).toBe(true);
    expect(
      isAuthorizedJobRequest(jobRequest({ authorization: "Bearer jobs-secret" })),
    ).toBe(true);
  });

  it("rejects wrong or missing credentials when the secret is set", () => {
    vi.stubEnv("KINFOLK_JOBS_SECRET", "jobs-secret");

    expect(isAuthorizedJobRequest(jobRequest())).toBe(false);
    expect(
      isAuthorizedJobRequest(jobRequest({ "x-kinfolk-job-secret": "nope" })),
    ).toBe(false);
    expect(
      isAuthorizedJobRequest(jobRequest({ authorization: "Bearer nope" })),
    ).toBe(false);
    expect(
      isAuthorizedJobRequest(jobRequest({ authorization: "Bearer undefined" })),
    ).toBe(false);
    expect(
      isAuthorizedJobRequest(jobRequest({ authorization: "Bearer " })),
    ).toBe(false);
  });

  it("throws when the secret is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINFOLK_JOBS_SECRET", "");

    expect(() =>
      isAuthorizedJobRequest(jobRequest({ authorization: "Bearer undefined" })),
    ).toThrow("KINFOLK_JOBS_SECRET must be set before job routes can run.");
  });

  it("throws when the secret is blank", () => {
    vi.stubEnv("KINFOLK_JOBS_SECRET", "   ");

    expect(() => isAuthorizedJobRequest(jobRequest())).toThrow(
      "KINFOLK_JOBS_SECRET must be set before job routes can run.",
    );
  });

  it("fails closed for local development when the secret is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KINFOLK_JOBS_SECRET", "");

    expect(() => isAuthorizedJobRequest(jobRequest())).toThrow(
      "KINFOLK_JOBS_SECRET must be set before job routes can run.",
    );
  });
});
