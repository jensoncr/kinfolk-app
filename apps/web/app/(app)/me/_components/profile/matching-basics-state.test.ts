import { describe, expect, it } from "vitest";
import {
  resolveAgeComfortSave,
  resolveBudgetSave,
  resolveHouseholdSave,
  resolveMoveInSave,
} from "./matching-basics-state";

describe("matching basics save state", () => {
  describe("budget", () => {
    it("builds a budget patch and display state from whole positive numbers", () => {
      expect(resolveBudgetSave(" 2200 ", "3400")).toEqual({
        ok: true,
        patch: {
          budgetMin: 2200,
          budgetMax: 3400,
        },
        display: {
          budgetMin: 2200,
          budgetMax: 3400,
        },
      });
    });

    it("treats blank budget fields as clearing the budget", () => {
      expect(resolveBudgetSave("", "   ")).toEqual({
        ok: true,
        patch: {
          budgetMin: null,
          budgetMax: null,
        },
        display: {
          budgetMin: 0,
          budgetMax: 0,
        },
      });
    });

    it("rejects decimal or zero budget drafts instead of silently rounding or clearing", () => {
      expect(resolveBudgetSave("2200.5", "3400")).toEqual({
        ok: false,
        error: "Use whole positive numbers.",
      });
      expect(resolveBudgetSave("0", "3400")).toEqual({
        ok: false,
        error: "Use whole positive numbers.",
      });
    });

    it("rejects a minimum budget above the maximum", () => {
      expect(resolveBudgetSave("3600", "3400")).toEqual({
        ok: false,
        error: "Minimum must be below maximum.",
      });
    });
  });

  describe("move-in", () => {
    it("builds a single-date move-in patch from a valid ISO date", () => {
      expect(resolveMoveInSave(" 2026-08-01 ")).toEqual({
        ok: true,
        patch: {
          moveInStart: "2026-08-01",
          moveInEnd: "2026-08-01",
        },
        display: {
          moveInStart: "2026-08-01",
          moveInEnd: "2026-08-01",
        },
      });
    });

    it("rejects blank or invalid move-in dates before calling the API", () => {
      expect(resolveMoveInSave("")).toEqual({
        ok: false,
        error: "Add the date you expect to start your lease.",
      });
      expect(resolveMoveInSave("2026-02-31")).toEqual({
        ok: false,
        error: "Use a valid move-in date.",
      });
      expect(resolveMoveInSave("08/01/2026")).toEqual({
        ok: false,
        error: "Use a valid move-in date.",
      });
    });
  });

  describe("household", () => {
    it("builds an up-to household patch from a whole value inside the persisted range", () => {
      expect(resolveHouseholdSave("8")).toEqual({
        ok: true,
        patch: {
          householdSizeMin: 1,
          householdSizeMax: 8,
        },
        display: {
          householdSizeMin: 1,
          householdSizeMax: 8,
        },
      });
    });

    it("rejects household values outside the server-supported range", () => {
      expect(resolveHouseholdSave("0")).toEqual({
        ok: false,
        error: "Choose a household size between 1 and 8.",
      });
      expect(resolveHouseholdSave("9")).toEqual({
        ok: false,
        error: "Choose a household size between 1 and 8.",
      });
      expect(resolveHouseholdSave("2.5")).toEqual({
        ok: false,
        error: "Choose a household size between 1 and 8.",
      });
    });
  });

  describe("age comfort", () => {
    it("builds an age comfort patch from whole ages", () => {
      expect(
        resolveAgeComfortSave({
          ageDraft: "29",
          minDraft: "24",
          maxDraft: "36",
          strict: true,
        }),
      ).toEqual({
        ok: true,
        patch: {
          age: 29,
          preferredAgeMin: 24,
          preferredAgeMax: 36,
          preferredAgeStrict: true,
        },
        display: {
          age: 29,
          preferredAgeMin: 24,
          preferredAgeMax: 36,
          preferredAgeStrict: true,
        },
      });
    });

    it("requires the user's age", () => {
      expect(
        resolveAgeComfortSave({
          ageDraft: "",
          minDraft: "24",
          maxDraft: "36",
          strict: false,
        }),
      ).toEqual({
        ok: false,
        error: "Add your age between 18 and 100.",
      });
    });

    it("rejects decimal roommate age drafts instead of silently rounding", () => {
      expect(
        resolveAgeComfortSave({
          ageDraft: "29",
          minDraft: "24.5",
          maxDraft: "36",
          strict: false,
        }),
      ).toEqual({
        ok: false,
        error: "Use whole ages between 18 and 100.",
      });
    });

    it("rejects an age minimum above the maximum", () => {
      expect(
        resolveAgeComfortSave({
          ageDraft: "29",
          minDraft: "40",
          maxDraft: "36",
          strict: false,
        }),
      ).toEqual({
        ok: false,
        error: "Minimum must be below maximum.",
      });
    });

    it("clears strict mode when the roommate age range is blank", () => {
      expect(
        resolveAgeComfortSave({
          ageDraft: "29",
          minDraft: "",
          maxDraft: "",
          strict: true,
        }),
      ).toEqual({
        ok: true,
        patch: {
          age: 29,
          preferredAgeMin: null,
          preferredAgeMax: null,
          preferredAgeStrict: false,
        },
        display: {
          age: 29,
          preferredAgeMin: null,
          preferredAgeMax: null,
          preferredAgeStrict: false,
        },
      });
    });
  });
});
