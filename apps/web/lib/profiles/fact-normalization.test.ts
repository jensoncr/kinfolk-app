import { describe, expect, it } from "vitest";
import {
  isStructuredFactKey,
  isWebEditableListKey,
  isWebEditablePreferenceKey,
  normalizeEditablePreferenceList,
  normalizeStructuredFactValue,
  structuredFactOptions,
  structuredFactValueLabel,
  structuredValueSimilarity,
  WEB_EDITABLE_LIST_MAX_ITEMS,
  WEB_EDITABLE_LIST_KEYS,
  WEB_EDITABLE_LIST_VALUE_MAX_LENGTH,
  WEB_EDITABLE_PREFERENCE_KEYS,
} from "./fact-normalization";

describe("normalizeStructuredFactValue", () => {
  it("maps free-text cleanliness answers onto the tidiness scale", () => {
    expect(normalizeStructuredFactValue("cleanliness", "i'm spotless and reset every night")).toBe("very tidy");
    expect(normalizeStructuredFactValue("cleanliness", "i keep the kitchen clean")).toBe("tidy");
    expect(normalizeStructuredFactValue("cleanliness", "pretty easygoing and laid-back")).toBe("relaxed");
  });

  it("maps noise, social, and guest phrasing to canonical tokens", () => {
    expect(normalizeStructuredFactValue("noise_tolerance", "need it quiet, basically a library")).toBe("very quiet");
    expect(
      normalizeStructuredFactValue(
        "noise_tolerance",
        "high sensitivity to persistent low-frequency bass/vibration at night",
      ),
    ).toBe("very quiet");
    expect(normalizeStructuredFactValue("social_energy", "total homebody, recharge alone")).toBe("homebody");
    expect(normalizeStructuredFactValue("guests", "guests sometimes, now and then with a heads up")).toBe("occasional");
  });

  it("maps sleep, communication, and conflict phrasing", () => {
    expect(normalizeStructuredFactValue("sleep_schedule", "i'm a night owl, up past 2am")).toBe("late");
    expect(
      normalizeStructuredFactValue(
        "sleep_schedule",
        "usually asleep around 11:30pm and up around 7:30am",
      ),
    ).toBe("early");
    expect(
      normalizeStructuredFactValue(
        "sleep_schedule",
        "often asleep around 1:00am and up around 8:30am",
      ),
    ).toBe("late");
    expect(normalizeStructuredFactValue("communication_style", "just be blunt and upfront with me")).toBe("direct");
    expect(normalizeStructuredFactValue("conflict_repair", "i need to cool down first, then talk")).toBe("cooldown then talk");
    expect(
      normalizeStructuredFactValue(
        "conflict_repair",
        "likely compatible with roommates who can discuss issues explicitly",
      ),
    ).toBe("address now");
  });

  it("maps work-from-home and rent flexibility phrasing", () => {
    expect(normalizeStructuredFactValue("work_from_home", "hybrid, in office three days")).toBe(
      "hybrid",
    );
    expect(normalizeStructuredFactValue("work_from_home", "mostly remote with calls from home")).toBe(
      "mostly home",
    );
    expect(normalizeStructuredFactValue("work_from_home", "usually onsite and out of the apartment")).toBe(
      "mostly away",
    );
    expect(normalizeStructuredFactValue("rent_tradeoff", "lower rent matters most")).toBe(
      "lower rent first",
    );
    expect(normalizeStructuredFactValue("rent_tradeoff", "I would pay more for the right fit")).toBe(
      "pay more for fit",
    );
  });

  it("is idempotent on an already-canonical token", () => {
    expect(normalizeStructuredFactValue("sleep_schedule", "late")).toBe("late");
    expect(normalizeStructuredFactValue("cleanliness", "very tidy")).toBe("very tidy");
  });

  it("returns null for non-structured keys and unmatched text", () => {
    expect(normalizeStructuredFactValue("budget", "{\"min\":1000,\"max\":4000}")).toBeNull();
    expect(normalizeStructuredFactValue("neighborhoods", "mission, soma")).toBeNull();
    expect(normalizeStructuredFactValue("cleanliness", "asdf qwerty")).toBeNull();
  });
});

describe("structuredValueSimilarity", () => {
  it("scores identical tokens as a perfect match", () => {
    expect(structuredValueSimilarity("cleanliness", "tidy", "tidy")).toBe(1);
  });

  it("rewards adjacency and penalizes distance on scales", () => {
    const adjacent = structuredValueSimilarity("cleanliness", "tidy", "very tidy") ?? 0;
    const distant = structuredValueSimilarity("cleanliness", "very tidy", "very relaxed") ?? 1;
    expect(adjacent).toBeGreaterThan(0.6);
    expect(distant).toBeLessThan(adjacent);
  });

  it("treats a neutral token (flexible sleep) as broadly compatible", () => {
    expect(structuredValueSimilarity("sleep_schedule", "flexible", "late")).toBe(0.6);
    expect(structuredValueSimilarity("sleep_schedule", "early", "late")).toBeLessThan(0.6);
  });

  it("treats distinct nominal options as weakly compatible", () => {
    expect(structuredValueSimilarity("communication_style", "direct", "diplomatic")).toBe(0.2);
  });

  it("returns null when a value is not a recognized token so the scorer can fall back", () => {
    expect(structuredValueSimilarity("cleanliness", "tidy", "kinda clean i guess")).toBeNull();
    expect(structuredValueSimilarity("budget", "3000", "3500")).toBeNull();
  });
});

describe("structured fact vocabulary helpers", () => {
  it("exposes the canonical option list for a key", () => {
    expect(structuredFactOptions("sleep_schedule")).toEqual(["early", "flexible", "late"]);
    expect(structuredFactOptions("budget")).toBeNull();
  });

  it("identifies structured keys and labels tokens", () => {
    expect(isStructuredFactKey("noise_tolerance")).toBe(true);
    expect(isStructuredFactKey("budget")).toBe(false);
    expect(structuredFactValueLabel("noise_tolerance", "very quiet")).toBe("Very quiet");
  });

  it("only exposes web-editable keys that have a canonical vocabulary", () => {
    expect(WEB_EDITABLE_PREFERENCE_KEYS).toEqual([
      "cleanliness",
      "sleep_schedule",
      "work_from_home",
      "noise_tolerance",
      "social_energy",
      "guests",
      "communication_style",
      "conflict_repair",
      "pets",
      "rent_tradeoff",
    ]);
    for (const key of WEB_EDITABLE_PREFERENCE_KEYS) {
      expect(isWebEditablePreferenceKey(key)).toBe(true);
      expect((structuredFactOptions(key) ?? []).length).toBeGreaterThan(1);
    }
    expect(isWebEditablePreferenceKey("budget")).toBe(false);
  });

  it("exposes additive list keys that are not single-value enums", () => {
    expect(WEB_EDITABLE_LIST_KEYS).toEqual([
      "neighborhoods",
      "must_haves",
      "dealbreakers",
    ]);
    for (const key of WEB_EDITABLE_LIST_KEYS) {
      expect(isWebEditableListKey(key)).toBe(true);
      // List keys are free-text, not structured enums.
      expect(structuredFactOptions(key)).toBeNull();
      expect(isWebEditablePreferenceKey(key)).toBe(false);
    }
    expect(isWebEditableListKey("cleanliness")).toBe(false);
  });

  it("normalizes editable list values for web profile saves", () => {
    const longValue = "Morning writing in the greenhouse with sunlight";
    const rawValues = [
      "  In-unit   laundry ",
      "in-unit laundry",
      "",
      42,
      longValue,
      ...Array.from(
        { length: WEB_EDITABLE_LIST_MAX_ITEMS },
        (_, index) => `Extra ${index + 1}`,
      ),
    ];

    expect(normalizeEditablePreferenceList(rawValues)).toEqual([
      "In-unit laundry",
      longValue.slice(0, WEB_EDITABLE_LIST_VALUE_MAX_LENGTH),
      ...Array.from(
        { length: WEB_EDITABLE_LIST_MAX_ITEMS - 2 },
        (_, index) => `Extra ${index + 1}`,
      ),
    ]);
  });
});
