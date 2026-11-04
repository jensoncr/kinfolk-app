import { describe, expect, it } from "vitest";
import { buildProfileEmbeddingCard } from "./embedding-card";

describe("buildProfileEmbeddingCard", () => {
  it("produces stable text and hash for the same facts regardless of input order", () => {
    const facts = [
      fact({
        dimension: "communication",
        factKey: "communication_style",
        id: "550e8400-e29b-41d4-a716-446655440000",
        normalizedValue: "direct and low drama",
      }),
      fact({
        dimension: "home_labor",
        factKey: "cleanliness",
        id: "550e8400-e29b-41d4-a716-446655440001",
        normalizedValue: "very tidy",
      }),
    ];

    const first = buildProfileEmbeddingCard({ facts });
    const second = buildProfileEmbeddingCard({ facts: [...facts].reverse() });

    expect(first.text).toBe(second.text);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.sourceFactIds).toEqual([
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001",
    ]);
  });

  it("uses normalized values, user trust context, and strips PII", () => {
    const card = buildProfileEmbeddingCard({
      facts: [
        fact({
          dimension: "environment_tolerance",
          factKey: "noise_tolerance",
          normalizedValue:
            "Library quiet. Email jack@example.com, phone 415-555-1212, address 123 Market Street.",
        }),
        fact({
          dimension: "communication",
          factKey: "communication_style",
          matchingEligible: false,
          normalizedValue: "should not appear",
        }),
      ],
      user: {
        aboutText: "Reach me at jenson@example.com.",
        educationSchool: "University of Notre Dame",
        interests: ["cooking", "hiking"],
        occupationCompany: "Blue Harbor",
      },
    });

    expect(card.text).toContain("noise_tolerance: library quiet");
    expect(card.text).toContain("education_school: university of notre dame");
    expect(card.text).toContain("occupation_company: blue harbor");
    expect(card.text).toContain("interests: cooking, hiking");
    expect(card.text).not.toContain("jack@example.com");
    expect(card.text).not.toContain("415-555-1212");
    expect(card.text).not.toContain("123 market street");
    expect(card.text).not.toContain("should not appear");
  });
});

function fact({
  dimension,
  factKey,
  id = "550e8400-e29b-41d4-a716-446655440099",
  matchingEligible = true,
  normalizedValue,
  reviewState = "approved",
  sensitivityLevel = "standard",
}: {
  dimension: string;
  factKey: string;
  id?: string;
  matchingEligible?: boolean;
  normalizedValue: string;
  reviewState?: string;
  sensitivityLevel?: string;
}) {
  return {
    dimension,
    factKey,
    id,
    matchingEligible,
    normalizedValue,
    reviewState,
    sensitivityLevel,
    value: normalizedValue,
  };
}
