import { describe, expect, it } from "vitest";
import { interpretInboundMessage } from "@/lib/text-agent/interpretation";
import { INTENT_FIXTURES } from "./intent-fixtures";

// Runs the REAL classifier over the semantic fixture set — one representative
// per class boundary, not a phrase list (see intent-fixtures.ts). A failure
// here means the classifier prompt needs work; the fix is never a regex.
//
// Run: npm run eval:agent -- -t "inbound intent classifier"

const hasKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

describe("inbound intent classifier", () => {
  for (const fixture of INTENT_FIXTURES) {
    it.skipIf(!hasKey)(fixture.name, async () => {
      const intent = await interpretInboundMessage({
        body: fixture.body,
        previousAssistantMessage: fixture.previousAssistantMessage ?? null,
      });

      // A fallback result means the classifier call itself failed — that must
      // read as an eval failure, not silently grade the regexes instead.
      expect(intent.source).toBe("classifier");
      expect(fixture.expectKinds).toContain(intent.kind);
      if (fixture.expectMedia !== undefined) {
        expect(intent.wantsMediaCards).toBe(fixture.expectMedia);
      }
    });
  }
});
