import { describe, expect, it } from "vitest";
import type { EnrichedDetail } from "./types";
import {
  attachPersistedRoommateGroupsToEnriched,
  buildPersistedFormingGroupsForListing,
  type PersistedRoommateGroupContext,
  type PersistedRoommateGroupMembershipRow,
  type PersistedRoommateGroupRow,
  type PersistedRoommateProfile,
} from "./persisted-roommate-groups";

const LISTING_ID = "listing-1";
const GROUP_ID = "group-1";
const PLAN_NAME = "2 bed 1 bath";

// PII markers asserted absent from serialized output for locked members.
const ANNA_PII = [
  "Chen", // last name
  "https://photos.example/anna.jpg",
  "Staff Engineer",
  "Acme Corp",
  "Stanford",
  "Climbs on weekends",
  "pottery",
];

function groupRow(
  overrides: Partial<PersistedRoommateGroupRow> = {},
): PersistedRoommateGroupRow {
  return {
    id: GROUP_ID,
    listing_id: LISTING_ID,
    floor_plan_key: PLAN_NAME,
    floor_plan_name: PLAN_NAME,
    target_unit_name: null,
    bedrooms: 2,
    max_size: 2,
    monthly_rent: 4200,
    status: "forming",
    preferences: null,
    match_summary: null,
    created_by_user_id: "creator-1",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function membership(
  userId: string,
  status: string,
): PersistedRoommateGroupMembershipRow {
  return {
    group_id: GROUP_ID,
    user_id: userId,
    status,
    role: userId === "anna" ? "creator" : "member",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function annaProfile(overrides: Partial<PersistedRoommateProfile> = {}): PersistedRoommateProfile {
  return {
    userId: "anna",
    isPublic: false,
    name: "Anna Chen",
    imageUrl: "https://photos.example/anna.jpg",
    about: "Climbs on weekends and keeps a quiet home.",
    interests: ["pottery", "climbing"],
    occupationTitle: "Staff Engineer",
    occupationCompany: "Acme Corp",
    occupationCompanyLogoUrl: null,
    educationSchool: "Stanford",
    educationDegree: "BS",
    educationMajor: "CS",
    educationYear: "2019",
    educationSchoolLogoUrl: null,
    facts: [],
    ...overrides,
  };
}

function contextFor(args: {
  viewerId: string;
  viewerMembershipStatus?: string;
  annaOverrides?: Partial<PersistedRoommateProfile>;
  groupOverrides?: Partial<PersistedRoommateGroupRow>;
}): PersistedRoommateGroupContext {
  const memberships = [membership("anna", "member")];
  if (args.viewerMembershipStatus) {
    memberships.push(membership(args.viewerId, args.viewerMembershipStatus));
  }
  return {
    activeUserId: args.viewerId,
    groups: [groupRow(args.groupOverrides)],
    memberships,
    profiles: [annaProfile(args.annaOverrides)],
    compatibilityEdges: [
      { userAId: args.viewerId, userBId: "anna", score: 72, reasons: ["Lifestyle"] },
    ],
  };
}

function formingGroupsFor(context: PersistedRoommateGroupContext) {
  return buildPersistedFormingGroupsForListing({
    listingId: LISTING_ID,
    monthlyRent: 4200,
    context,
  });
}

describe("anonymous-mode member projection (privacy)", () => {
  it("strips identity for a stranger viewer: first name + fit only, locked", () => {
    const groups = formingGroupsFor(contextFor({ viewerId: "viewer" }));
    expect(groups).toHaveLength(1);
    const member = groups[0]!.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBe(true);
    expect(member.name).toBe("Anna");
    expect(member.matchScore).toBe(72);
    expect(member.imageUrl).toBeUndefined();
    expect(member.headline).toBeUndefined();
    expect(member.occupationTitle).toBeUndefined();
    expect(member.occupationCompany).toBeUndefined();
    expect(member.educationSchool).toBeUndefined();

    // Wire-level guarantee: no PII marker survives anywhere in the payload.
    const serialized = JSON.stringify(groups);
    for (const marker of ANNA_PII) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("keeps the full profile when the member opted into public visibility", () => {
    const groups = formingGroupsFor(
      contextFor({ viewerId: "viewer", annaOverrides: { isPublic: true } }),
    );
    const member = groups[0]!.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBeUndefined();
    expect(member.name).toBe("Anna Chen");
    expect(member.imageUrl).toBe("https://photos.example/anna.jpg");
    expect(member.occupationTitle).toBe("Staff Engineer");
    expect(member.educationSchool).toBe("Stanford");
  });

  it("unlocks anonymous members for an accepted member of the same group", () => {
    const groups = formingGroupsFor(
      contextFor({ viewerId: "viewer", viewerMembershipStatus: "member" }),
    );
    const member = groups[0]!.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBeUndefined();
    expect(member.name).toBe("Anna Chen");
    expect(member.imageUrl).toBe("https://photos.example/anna.jpg");
  });

  it("does NOT unlock via membership in a migration-seeded group (no creator = no consent)", () => {
    const groups = formingGroupsFor(
      contextFor({
        viewerId: "viewer",
        viewerMembershipStatus: "member",
        groupOverrides: { created_by_user_id: null },
      }),
    );
    const member = groups[0]!.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBe(true);
    expect(member.name).toBe("Anna");
    expect(member.imageUrl).toBeUndefined();
  });

  it("keeps anonymous members locked while the viewer's request is pending", () => {
    const groups = formingGroupsFor(
      contextFor({ viewerId: "viewer", viewerMembershipStatus: "requested" }),
    );
    const member = groups[0]!.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBe(true);
    expect(member.imageUrl).toBeUndefined();
  });

  it("strips identity in the group-detail projection too (modal path)", () => {
    const enriched = {
      floorPlans: [
        {
          bedroomTitle: "2 Bedrooms",
          availableUnitTypes: [
            {
              id: null,
              name: PLAN_NAME,
              bedrooms: 2,
              bathrooms: 1,
              sqftMin: null,
              sqftMax: null,
              rentPriceMin: 4200,
              rentPriceMax: 4200,
              availableAt: null,
              totalUnits: 1,
              availableUnits: 1,
              units: [],
              specificAmenities: [],
              leaseTerms: [],
              imageUrl: null,
              groups: [],
            },
          ],
        },
      ],
    } as unknown as EnrichedDetail;

    const result = attachPersistedRoommateGroupsToEnriched(
      LISTING_ID,
      enriched,
      contextFor({ viewerId: "viewer" }),
    )!;
    const group = result.floorPlans[0]!.availableUnitTypes[0]!.groups[0]!;
    const member = group.members.find((m) => m.userId === "anna")!;

    expect(member.locked).toBe(true);
    expect(member.about).toBeUndefined();
    expect(member.lifestyle).toBeUndefined();
    expect(member.interests).toBeUndefined();
    expect(member.matchReasons).toBeUndefined();

    const serialized = JSON.stringify(result);
    for (const marker of ANNA_PII) {
      expect(serialized).not.toContain(marker);
    }
  });
});
