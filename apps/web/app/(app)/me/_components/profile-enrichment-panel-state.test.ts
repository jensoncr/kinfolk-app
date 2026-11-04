import { describe, expect, it } from "vitest";
import {
  buildProfileImportRequestPayload,
  canSaveProfileFactEdit,
  createProfileImportSourceState,
  updateProfileImportProvider,
} from "./profile-enrichment-panel-state";

describe("profile enrichment fact edit state", () => {
  it("requires a nonblank edited fact value before save", () => {
    expect(canSaveProfileFactEdit("Quiet after 10pm")).toBe(true);
    expect(canSaveProfileFactEdit("   ")).toBe(false);
  });
});

describe("profile enrichment panel import state", () => {
  it("normalizes the initial provider and derives its source label", () => {
    expect(createProfileImportSourceState("claude")).toEqual({
      provider: "claude",
      sourceLabel: "Claude memories",
    });
    expect(createProfileImportSourceState("  ChatGPT  ")).toEqual({
      provider: "chatgpt",
      sourceLabel: "ChatGPT memories",
    });
    expect(createProfileImportSourceState("unknown-provider")).toEqual({
      provider: "manual",
      sourceLabel: "Manual profile import",
    });
  });

  it("resets the source label when the provider changes", () => {
    expect(updateProfileImportProvider("claude")).toEqual({
      provider: "claude",
      sourceLabel: "Claude memories",
    });
    expect(updateProfileImportProvider("chatgpt")).toEqual({
      provider: "chatgpt",
      sourceLabel: "ChatGPT memories",
    });
    expect(updateProfileImportProvider("  CLAUDE  ")).toEqual({
      provider: "claude",
      sourceLabel: "Claude memories",
    });
  });

  it("builds the paste import payload with a trimmed source-label fallback", () => {
    expect(
      buildProfileImportRequestPayload({
        payloadText: "  {\"facts\": []}  ",
        provider: "chatgpt",
        sourceLabel: "   ",
      }),
    ).toEqual({
      method: "paste",
      payload: "  {\"facts\": []}  ",
      provider: "chatgpt",
      sourceLabel: "Manual profile import",
    });
  });
});
