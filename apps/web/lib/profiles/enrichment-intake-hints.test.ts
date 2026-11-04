import { describe, expect, it, vi } from "vitest";
import {
  isProfileQuestionSafeIntakeStep,
  loadEnrichmentIntakeHints,
  loadProfileQuestionIntakeSteps,
  mapFollowUpQuestionToIntakeStep,
  profileQuestionSafeIntakeSteps,
  prioritizeIntakeStepsFromHints,
} from "./enrichment-intake-hints";
import { textAgentIntakeSteps } from "../text-agent";

vi.mock("server-only", () => ({}));

describe("enrichment intake hints", () => {
  it("maps assistant follow-up questions to intake steps", () => {
    expect(mapFollowUpQuestionToIntakeStep("What is your sleep schedule?")).toBe(
      "sleep_schedule",
    );
    expect(mapFollowUpQuestionToIntakeStep("Do you work from home or go to an office?")).toBe(
      "work_from_home",
    );
    expect(mapFollowUpQuestionToIntakeStep("How do you split chores?")).toBe(
      "cleanliness",
    );
    expect(mapFollowUpQuestionToIntakeStep("Are you sensitive to bass?")).toBe(
      "noise_tolerance",
    );
    expect(mapFollowUpQuestionToIntakeStep("How often do you host guests?")).toBe(
      "guests",
    );
    expect(mapFollowUpQuestionToIntakeStep("How do you handle conflict?")).toBe(
      "conflict_repair",
    );
    expect(mapFollowUpQuestionToIntakeStep("What hobbies or music help roommates find common ground?")).toBe(
      "interests",
    );
    expect(mapFollowUpQuestionToIntakeStep("How social are you at home?")).toBe(
      "social_energy",
    );
    expect(mapFollowUpQuestionToIntakeStep("Are you flexible on rent vs location?")).toBe(
      "rent_tradeoff",
    );
    expect(mapFollowUpQuestionToIntakeStep("What is your monthly rent budget?")).toBe(
      "budget",
    );
    expect(mapFollowUpQuestionToIntakeStep("Which neighborhoods work?")).toBe(
      "neighborhoods",
    );
    expect(mapFollowUpQuestionToIntakeStep("When do you want to move in?")).toBe(
      "move_in",
    );
    expect(mapFollowUpQuestionToIntakeStep("Do you have pets?")).toBe("pets");
    expect(
      mapFollowUpQuestionToIntakeStep("How many roommates are you open to?"),
    ).toBe("roommates");
    expect(
      mapFollowUpQuestionToIntakeStep("Any school, company, mutuals, or references that build trust?"),
    ).toBe("trust_context");
    expect(mapFollowUpQuestionToIntakeStep("What is your favorite color?")).toBe(
      null,
    );
  });

  it("prioritizes hinted steps before the default impact order", () => {
    const ordered = prioritizeIntakeStepsFromHints(
      [
        "How do you handle conflict when roommates disagree?",
        "What is your sleep schedule like?",
      ],
      textAgentIntakeSteps,
    );

    expect(ordered.slice(0, 5)).toEqual([
      "neighborhoods",
      "budget",
      "move_in",
      "roommates",
      "age_comfort",
    ]);
    expect(ordered[5]).toBe("conflict_repair");
    expect(ordered[6]).toBe("sleep_schedule");
    expect(new Set(ordered).size).toBe(textAgentIntakeSteps.length);
    expect(ordered.at(-1)).toBe("rent_tradeoff");
  });

  it("dedupes repeated hints and keeps one copy of each step", () => {
    const ordered = prioritizeIntakeStepsFromHints(
      ["Sleep schedule?", "Bedtime habits?", "Chronotype?"],
      textAgentIntakeSteps,
    );

    expect(ordered.filter((step) => step === "sleep_schedule")).toHaveLength(1);
  });

  it("keeps hinted onboarding gaps even when imported facts are pending elsewhere", async () => {
    const importsQuery = makeSupabaseQuery([
      {
        created_at: "2026-05-24T20:35:38.977799+00:00",
        import_metadata: {
          recommendedFollowUpQuestions: [
            "How often do you host guests?",
            "How clean do shared spaces need to be?",
          ],
        },
        provider: "claude",
        raw_payload: {},
      },
    ]);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== "profile_imports") {
          throw new Error(`Unexpected table ${table}`);
        }
        return importsQuery;
      }),
    };

    const steps = await loadEnrichmentIntakeHints(supabase as never, "user-1");

    expect(steps).toContain("guests");
    expect(steps).toContain("cleanliness");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("excludes age comfort from proactive profile questions", async () => {
    const importsQuery = makeSupabaseQuery([]);
    const supabase = {
      from: vi.fn(() => importsQuery),
    };

    const steps = await loadProfileQuestionIntakeSteps(
      supabase as never,
      "user-1",
    );

    expect(profileQuestionSafeIntakeSteps).not.toContain("age_comfort");
    expect(steps).not.toContain("age_comfort");
    expect(isProfileQuestionSafeIntakeStep("age_comfort")).toBe(false);
    expect(isProfileQuestionSafeIntakeStep("sleep_schedule")).toBe(true);
  });
});

function makeSupabaseQuery(data: unknown[]) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    neq: vi.fn(() => query),
    order: vi.fn(async () => ({ data, error: null })),
    select: vi.fn(() => query),
  };
  return query;
}
