import { describe, expect, it } from "vitest";
import { resolveProfileEmbeddingJobOptions } from "./profile-embedding-job-options.mjs";

function argsFrom(entries) {
  return new Map(entries);
}

describe("profile embedding job script options", () => {
  it("defaults blank options before building the job request", () => {
    expect(
      resolveProfileEmbeddingJobOptions(
        argsFrom([
          ["base-url", "   "],
          ["force", "   "],
          ["job-secret", "   "],
          ["limit", ""],
          ["user-id", "   "],
        ]),
        {},
      ),
    ).toEqual({
      baseUrl: "http://localhost:3000",
      dryRun: false,
      force: false,
      jobSecret: "",
      limit: 50,
      userId: null,
    });
  });

  it("trims strings and parses booleans case-insensitively", () => {
    expect(
      resolveProfileEmbeddingJobOptions(
        argsFrom([
          ["base-url", " https://kinfolk.test/// "],
          ["dry-run", " TRUE "],
          ["force", " TRUE "],
          ["job-secret", " secret-value "],
          ["limit", "12"],
          ["user-id", " user-1 "],
        ]),
        {},
      ),
    ).toEqual({
      baseUrl: "https://kinfolk.test",
      dryRun: true,
      force: true,
      jobSecret: "secret-value",
      limit: 12,
      userId: "user-1",
    });
  });

  it("uses env fallbacks and clamps integer limits", () => {
    expect(
      resolveProfileEmbeddingJobOptions(argsFrom([["limit", "999"]]), {
        KINFOLK_BACKFILL_BASE_URL: " https://jobs.kinfolk.test/ ",
        KINFOLK_JOBS_SECRET: " env-secret ",
        NEXT_PUBLIC_KINFOLK_BASE_URL: "https://public.kinfolk.test",
      }),
    ).toMatchObject({
      baseUrl: "https://jobs.kinfolk.test",
      jobSecret: "env-secret",
      limit: 200,
    });
  });

  it("rejects non-integer limits before falling back", () => {
    expect(
      resolveProfileEmbeddingJobOptions(argsFrom([["limit", "12.5"]]), {}),
    ).toMatchObject({
      limit: 50,
    });
  });
});
