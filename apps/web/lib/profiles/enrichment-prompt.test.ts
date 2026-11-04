import { describe, expect, it } from "vitest";

import {
  buildAssistantProfilePrompt,
  buildChatGptProfileImportUrl,
} from "./enrichment-prompt";

describe("buildAssistantProfilePrompt", () => {
  it.each(["chatgpt", "claude"] as const)(
    "requires %s exports to be strictly valid JSON",
    (provider) => {
      const prompt = buildAssistantProfilePrompt(provider);

      expect(prompt).toContain(
        "Return exactly one strictly valid JSON object and no commentary.",
      );
      expect(prompt).toContain(
        'Escape every double quote inside a string as \\"',
      );
      expect(prompt).toContain(
        '"evidence":"They said \\"very quiet\\" at night."',
      );
      expect(prompt).toContain(
        "Before responding, verify the complete output parses as JSON.",
      );
    },
  );
});

describe("buildChatGptProfileImportUrl", () => {
  it("uses the base ChatGPT URL when the production prompt is too long to prefill", () => {
    const prompt = buildAssistantProfilePrompt("chatgpt");

    expect(buildChatGptProfileImportUrl(prompt)).toBe("https://chatgpt.com/");
  });

  it("prefills short prompts without changing their contents", () => {
    const prompt = "Return one JSON object.";
    const url = new URL(buildChatGptProfileImportUrl(prompt));

    expect(url.origin).toBe("https://chatgpt.com");
    expect(url.searchParams.get("prompt")).toBe(prompt);
  });
});
