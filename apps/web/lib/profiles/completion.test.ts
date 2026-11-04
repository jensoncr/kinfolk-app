import { describe, expect, it } from "vitest";
import {
  getProfileSetupProgress,
  type ProfileSetupState,
} from "./completion";

function makeSetupState(overrides: Partial<ProfileSetupState> = {}): ProfileSetupState {
  return {
    age: null,
    budgetMax: 0,
    budgetMin: 0,
    householdSizeMax: 0,
    householdSizeMin: 0,
    interviewStatus: "not_started",
    moveInEnd: "",
    moveInStart: "",
    phone: "",
    phoneVerified: false,
    preferredAgeMax: null,
    preferredAgeMin: null,
    preferredAgeStrict: false,
    ...overrides,
  };
}

describe("getProfileSetupProgress", () => {
  it("counts only required setup tasks toward receipt progress", () => {
    const progress = getProfileSetupProgress(
      makeSetupState({
        age: 29,
        budgetMax: 3200,
        budgetMin: 2200,
        householdSizeMax: 3,
        householdSizeMin: 1,
        interviewStatus: "completed",
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-01",
        phone: "+14155550100",
        phoneVerified: true,
        preferredAgeMax: 36,
        preferredAgeMin: 24,
      }),
    );

    expect(progress.completed).toBe(5);
    expect(progress.total).toBe(5);
    expect(progress.percent).toBe(100);
    expect(progress.nextTask).toBeNull();
    expect(progress.tasks.find((task) => task.key === "interview")?.isComplete).toBe(true);
    expect(progress.tasks.find((task) => task.key === "interview")?.optional).toBe(true);
  });

  it("does not mark age range complete until user age and preferred roommate range are present", () => {
    const progress = getProfileSetupProgress(
      makeSetupState({
        age: 29,
        budgetMax: 3200,
        budgetMin: 2200,
        householdSizeMax: 3,
        householdSizeMin: 1,
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-01",
        phone: "+14155550100",
        phoneVerified: true,
      }),
    );

    const ageTask = progress.tasks.find((task) => task.key === "ageComfort");

    expect(ageTask?.isComplete).toBe(false);
    expect(progress.completed).toBe(4);
    expect(progress.percent).toBe(80);
    expect(progress.nextTask?.key).toBe("ageComfort");
  });

  it("keeps invalid budgets and household ranges incomplete", () => {
    const progress = getProfileSetupProgress(
      makeSetupState({
        age: 29,
        budgetMax: 2200,
        budgetMin: 3200,
        householdSizeMax: 1,
        householdSizeMin: 3,
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-01",
        phone: "+14155550100",
        phoneVerified: true,
        preferredAgeMax: 36,
        preferredAgeMin: 24,
      }),
    );

    expect(progress.tasks.find((task) => task.key === "budget")?.isComplete).toBe(false);
    expect(progress.tasks.find((task) => task.key === "household")?.isComplete).toBe(false);
    expect(progress.completed).toBe(3);
    expect(progress.nextTask?.key).toBe("budget");
  });

  it("does not complete phone verification without a real phone number", () => {
    const progress = getProfileSetupProgress(
      makeSetupState({
        age: 29,
        budgetMax: 3200,
        budgetMin: 2200,
        householdSizeMax: 3,
        householdSizeMin: 1,
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-01",
        phone: "Not verified",
        phoneVerified: true,
        preferredAgeMax: 36,
        preferredAgeMin: 24,
      }),
    );

    expect(progress.tasks.find((task) => task.key === "phone")?.isComplete).toBe(false);
    expect(progress.completed).toBe(4);
    expect(progress.nextTask?.key).toBe("phone");
  });

  it("does not complete phone verification for short phone-like drift values", () => {
    const progress = getProfileSetupProgress(
      makeSetupState({
        age: 29,
        budgetMax: 3200,
        budgetMin: 2200,
        householdSizeMax: 3,
        householdSizeMin: 1,
        moveInEnd: "2026-08-01",
        moveInStart: "2026-07-01",
        phone: "555",
        phoneVerified: true,
        preferredAgeMax: 36,
        preferredAgeMin: 24,
      }),
    );

    expect(progress.tasks.find((task) => task.key === "phone")?.isComplete).toBe(false);
    expect(progress.completed).toBe(4);
    expect(progress.nextTask?.key).toBe("phone");
  });
});
