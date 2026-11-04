import { describe, expect, it } from "vitest";
import { buildLinkedInTrustFacts } from "./linkedin-trust-facts";
import type { LinkedInTimelineItem } from "../shared/types";

function timelineItem(
  overrides: Partial<LinkedInTimelineItem> & { organization: string },
): LinkedInTimelineItem {
  return {
    id: overrides.id ?? overrides.organization.toLowerCase(),
    title: overrides.title ?? "",
    organization: overrides.organization,
    subtitle: overrides.subtitle ?? "",
    dateRange: overrides.dateRange ?? "",
    logoUrl: overrides.logoUrl ?? null,
  };
}

describe("buildLinkedInTrustFacts", () => {
  it("builds a verified summary and a shared-communities fact", () => {
    const facts = buildLinkedInTrustFacts({
      headline: "Staff Engineer at Acme",
      workExperience: [
        timelineItem({ title: "Staff Engineer", organization: "Acme" }),
        timelineItem({ title: "Engineer", organization: "Globex" }),
      ],
      education: [timelineItem({ organization: "Stanford University" })],
    });

    const verified = facts.find((fact) => fact.fact_key === "verified_work_or_school");
    const communities = facts.find((fact) => fact.fact_key === "shared_communities");

    expect(verified?.dimension).toBe("trust_context");
    expect(verified?.value).toBe("Staff Engineer at Acme · Stanford University");
    expect(verified?.sensitivity_level).toBe("standard");
    expect(communities?.value).toEqual(["Acme", "Globex", "Stanford University"]);
  });

  it("falls back to role summary when there is no headline", () => {
    const facts = buildLinkedInTrustFacts({
      headline: null,
      workExperience: [timelineItem({ title: "Designer", organization: "Figma" })],
      education: [],
    });

    const verified = facts.find((fact) => fact.fact_key === "verified_work_or_school");
    expect(verified?.value).toBe("Designer at Figma");
  });

  it("dedupes employers/schools case-insensitively", () => {
    const facts = buildLinkedInTrustFacts({
      headline: "PM",
      workExperience: [
        timelineItem({ organization: "Acme" }),
        timelineItem({ organization: "acme" }),
      ],
      education: [timelineItem({ organization: "Acme" })],
    });

    const communities = facts.find((fact) => fact.fact_key === "shared_communities");
    expect(communities?.value).toEqual(["Acme"]);
  });

  it("returns no facts when there is no work or education signal", () => {
    expect(
      buildLinkedInTrustFacts({ headline: "", workExperience: [], education: [] }),
    ).toEqual([]);
  });
});
