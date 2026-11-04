import { describe, expect, it } from "vitest";
import { clipCardText, formatShortDate } from "./card-text";

describe("clipCardText", () => {
  it("returns short text unchanged, trimmed", () => {
    expect(clipCardText("681 Florida St", 42)).toBe("681 Florida St");
    expect(clipCardText("  Mission Dolores  ", 42)).toBe("Mission Dolores");
  });

  it("clips overflow at a word boundary, never mid-word", () => {
    expect(
      clipCardText("1234 South Van Ness Avenue near Precita Park Annex", 42),
    ).toBe("1234 South Van Ness Avenue near Precita…");
    expect(clipCardText("Early riser, dog friendly, loves to cook", 38)).toBe(
      "Early riser, dog friendly, loves to…",
    );
  });

  it("tidies trailing punctuation ahead of the ellipsis", () => {
    expect(clipCardText("Mission Dolores, San Francisco", 16)).toBe(
      "Mission…",
    );
  });

  it("cuts a single unbroken word at the limit", () => {
    expect(clipCardText("Konstantinopolitanissimo", 12)).toBe("Konstantinop…");
  });

  it("passes empty input through", () => {
    expect(clipCardText("", 38)).toBe("");
    expect(clipCardText("   ", 38)).toBe("");
  });
});

describe("formatShortDate", () => {
  it("formats parseable dates as a short month + numeric day", () => {
    expect(formatShortDate("2026-06-10T12:00:00.000Z", "New request")).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}$/,
    );
  });

  it("falls back when the value is not a date", () => {
    expect(formatShortDate("not-a-date", "New request")).toBe("New request");
    expect(formatShortDate("", "Roommate match")).toBe("Roommate match");
  });
});
