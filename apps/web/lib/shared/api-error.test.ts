import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFailureResponse } from "./api-error";

describe("apiFailureResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the ApiError message and status without logging", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = apiFailureResponse({
      error: new ApiError("Sign in before saving.", 401),
      fallback: "Unable to save.",
      logMessage: "[test] save failed",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in before saving." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("defaults ApiError status to 400", () => {
    expect(new ApiError("Use a valid date.").status).toBe(400);
  });

  it("logs unexpected errors and returns the generic fallback as a 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("connection reset by peer");

    const response = apiFailureResponse({
      error,
      fallback: "Unable to save.",
      logMessage: "[test] save failed",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to save." });
    expect(consoleError).toHaveBeenCalledWith("[test] save failed", { error });
  });

  it("treats non-Error throwables as unexpected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = apiFailureResponse({
      error: "boom",
      fallback: "Unable to save.",
      logMessage: "[test] save failed",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to save." });
  });
});
