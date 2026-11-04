import { describe, expect, it } from "vitest";
import {
  textAgentIntakeAckCopy,
  textAgentIntakeIntroCopy,
  textAgentIntakeQuestionCopy,
  textAgentOptInConfirmationCopy,
  textAgentOptOutConfirmationCopy,
  textAgentOutageReplyCopy,
  textAgentOutageReplyVariants,
  textAgentReviewReplyCopy,
  textAgentScopeDeclineCopy,
} from "./copy";
import { textAgentIntakeSteps } from "./index";

describe("text agent canned copy", () => {
  it("rotates warm outage variants deterministically by run id", () => {
    expect(textAgentOutageReplyVariants.length).toBeGreaterThanOrEqual(2);
    expect(textAgentOutageReplyCopy("run-1")).toBe(
      textAgentOutageReplyCopy("run-1"),
    );

    const runIds = ["run-a", "run-b", "run-c", "run-d", "run-e", "run-f"];
    const variants = new Set(runIds.map((runId) => textAgentOutageReplyCopy(runId)));
    expect(variants.size).toBeGreaterThan(1);
    for (const variant of variants) {
      expect(textAgentOutageReplyVariants).toContain(variant);
    }
  });

  it("keeps SKIP to a single early mention", () => {
    const intro = textAgentIntakeIntroCopy(
      textAgentIntakeQuestionCopy("neighborhoods"),
    );

    expect(intro.match(/SKIP/g)).toHaveLength(1);
    for (const step of textAgentIntakeSteps) {
      expect(textAgentIntakeQuestionCopy(step)).not.toContain("SKIP");
    }
  });

  it("acknowledges saved facts with deterministic variety", () => {
    const ack = textAgentIntakeAckCopy("budget", "budget:budget");

    expect(ack).toBe(textAgentIntakeAckCopy("budget", "budget:budget"));
    expect(ack).toContain("budget");
    expect(ack).toMatch(/^(Got|Saved|Locked in) your /);
  });

  it("speaks the review handoff without menu phrasing", () => {
    const withUrl = textAgentReviewReplyCopy({
      intent: "review",
      reviewUrl: "https://usekinfolk.com/me",
    });
    const withoutUrl = textAgentReviewReplyCopy({ intent: "edit" });

    expect(withUrl).toContain("https://usekinfolk.com/me");
    expect(withoutUrl).toContain("Settings, then Memories");
    expect(withoutUrl).not.toMatch(/reply\s+\w+\s+to/i);
  });

  it("confirms opt-out with the way back in and declines off-topic asks in one line", () => {
    expect(textAgentOptOutConfirmationCopy()).toContain("stop texting");
    expect(textAgentOptOutConfirmationCopy()).toContain("START");
    expect(textAgentOptInConfirmationCopy()).toContain("STOP");
    expect(textAgentScopeDeclineCopy()).toContain("SF apartments and roommates");
  });
});
