import { afterEach, describe, expect, it, vi } from "vitest";
import { requireBoundarySecret } from "./secrets";

describe("requireBoundarySecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the dedicated env var when set", () => {
    vi.stubEnv("KINFOLK_TEST_BOUNDARY_SECRET", "boundary-secret");

    expect(
      requireBoundarySecret("KINFOLK_TEST_BOUNDARY_SECRET", "test-boundary"),
    ).toBe("boundary-secret");
  });

  it("trims surrounding whitespace from the env var", () => {
    vi.stubEnv("KINFOLK_TEST_BOUNDARY_SECRET", "  boundary-secret  ");

    expect(
      requireBoundarySecret("KINFOLK_TEST_BOUNDARY_SECRET", "test-boundary"),
    ).toBe("boundary-secret");
  });

  it("throws in production when the env var is missing", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      requireBoundarySecret("KINFOLK_TEST_BOUNDARY_SECRET", "test-boundary"),
    ).toThrow("KINFOLK_TEST_BOUNDARY_SECRET must be set in production.");
  });

  it("throws in production when the env var is blank", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINFOLK_TEST_BOUNDARY_SECRET", "   ");

    expect(() =>
      requireBoundarySecret("KINFOLK_TEST_BOUNDARY_SECRET", "test-boundary"),
    ).toThrow("KINFOLK_TEST_BOUNDARY_SECRET must be set in production.");
  });

  it("falls back to a deterministic dev-only value outside production", () => {
    expect(
      requireBoundarySecret("KINFOLK_TEST_BOUNDARY_SECRET", "test-boundary"),
    ).toBe("kinfolk-dev-only-test-boundary-secret");
  });
});
