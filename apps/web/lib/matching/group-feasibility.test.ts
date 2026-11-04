import { describe, expect, it } from "vitest";
import {
  evaluateGroupListingFeasibility,
  reconcileGroupConstraints,
  type GroupMemberConstraints,
} from "./group-feasibility";

function member(
  userId: string,
  overrides: Partial<GroupMemberConstraints> = {},
): GroupMemberConstraints {
  return {
    budgetMax: null,
    budgetMin: null,
    dealbreakers: [],
    moveInEnd: null,
    moveInStart: null,
    userId,
    ...overrides,
  };
}

describe("reconcileGroupConstraints", () => {
  it("takes the tightest member cap and names who binds it", () => {
    const constraints = reconcileGroupConstraints([
      member("a", { budgetMax: 3000 }),
      member("b", { budgetMax: 2400 }),
      member("c", { budgetMax: 2800, budgetMin: 1200 }),
    ]);

    expect(constraints.budgetPerPersonCap).toBe(2400);
    expect(constraints.bindingBudgetUserIds).toEqual(["b"]);
    expect(constraints.budgetPerPersonFloor).toBe(1200);
  });

  it("unions dealbreakers case-insensitively", () => {
    const constraints = reconcileGroupConstraints([
      member("a", { dealbreakers: ["No smoking indoors", "no cats"] }),
      member("b", { dealbreakers: ["no smoking indoors", "No parties"] }),
    ]);

    expect(constraints.dealbreakers).toEqual([
      "No smoking indoors",
      "no cats",
      "No parties",
    ]);
  });

  it("intersects move-in windows", () => {
    const constraints = reconcileGroupConstraints([
      member("a", { moveInStart: "2026-08-01", moveInEnd: "2026-09-15" }),
      member("b", { moveInStart: "2026-08-20", moveInEnd: "2026-10-01" }),
    ]);

    expect(constraints.moveInWindow).toEqual({
      end: "2026-09-15",
      start: "2026-08-20",
    });
    expect(constraints.moveInDisjoint).toBe(false);
  });

  it("flags disjoint move-in windows instead of averaging them", () => {
    const constraints = reconcileGroupConstraints([
      member("a", { moveInStart: "2026-07-01", moveInEnd: "2026-07-31" }),
      member("b", { moveInStart: "2026-12-01", moveInEnd: "2026-12-31" }),
    ]);

    expect(constraints.moveInWindow).toBeNull();
    expect(constraints.moveInDisjoint).toBe(true);
  });

  it("is total on empty and unknown inputs", () => {
    const constraints = reconcileGroupConstraints([]);
    expect(constraints.budgetPerPersonCap).toBeNull();
    expect(constraints.dealbreakers).toEqual([]);
    expect(constraints.moveInWindow).toBeNull();
    expect(constraints.moveInDisjoint).toBe(false);

    const unknowns = reconcileGroupConstraints([member("a"), member("b")]);
    expect(unknowns.budgetPerPersonCap).toBeNull();
    expect(unknowns.moveInWindow).toBeNull();
  });
});

describe("evaluateGroupListingFeasibility", () => {
  it("splits rent at full size and names stretched members", () => {
    const feasibility = evaluateGroupListingFeasibility({
      groupSize: 3,
      members: [
        member("a", { budgetMax: 3000 }),
        member("b", { budgetMax: 1500 }),
        member("c"),
      ],
      monthlyRent: 5400,
    });

    expect(feasibility.perPersonRent).toBe(1800);
    expect(feasibility.stretchedUserIds).toEqual(["b"]);
    expect(feasibility.withinEveryBudget).toBe(false);
  });

  it("passes when every stated cap clears the split", () => {
    const feasibility = evaluateGroupListingFeasibility({
      groupSize: 2,
      members: [member("a", { budgetMax: 2500 }), member("b", { budgetMax: 2200 })],
      monthlyRent: 4200,
    });

    expect(feasibility.perPersonRent).toBe(2100);
    expect(feasibility.withinEveryBudget).toBe(true);
  });

  it("returns null verdicts when rent or caps are unknown", () => {
    expect(
      evaluateGroupListingFeasibility({
        groupSize: 2,
        members: [member("a", { budgetMax: 2500 })],
        monthlyRent: null,
      }).withinEveryBudget,
    ).toBeNull();

    expect(
      evaluateGroupListingFeasibility({
        groupSize: 2,
        members: [member("a"), member("b")],
        monthlyRent: 4200,
      }).withinEveryBudget,
    ).toBeNull();
  });
});
