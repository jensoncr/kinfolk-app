import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("text agent prompt", () => {
  it("instructs model-authored replies to format for iMessage", () => {
    const promptSource = readFileSync(
      new URL("./prompt.ts", import.meta.url),
      "utf8",
    );
    const soul = readFileSync(new URL("./soul.md", import.meta.url), "utf8");

    for (const source of [promptSource, soul]) {
      expect(source).toContain("iMessage");
      expect(source).toContain("one or two short lines");
      expect(source).toContain("dense paragraphs");
      expect(source).toContain("raw score keys");
    }
  });

  it("keeps watch and group promises honest in the soul", () => {
    const soul = readFileSync(new URL("./soul.md", import.meta.url), "utf8");

    expect(soul).toContain(
      "Kinfolk may text first only for notification kinds the user explicitly enabled",
    );
    expect(soul).toContain("save it with update_prefs");
    expect(soul).toContain("Never fake a promise");
    expect(soul).toContain("usekinfolk.com/apartments");
    expect(soul).toContain(
      "call opt_out and say goodbye warmly in one line",
    );
    expect(soul).toContain("at most one fixed matching question every seven days");
  });

  it("keeps foundation housing facts out of generic must-haves", () => {
    const source = readFileSync(
      new URL("./prompt.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "Never hide budget, neighborhoods, move-in timing, roommate openness/count, or pets inside must_haves",
    );
    expect(source).toContain("budget_preferred_max=X");
    expect(source).toContain('fact_key: "budget_max"');
    expect(source).toContain('fact_key: "household_size"');
    expect(source).toContain('fact_key: "move_in_window"');
    expect(source).toContain('fact_key: "neighborhoods"');
  });
});
