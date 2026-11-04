import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/shared/evidence", () => ({
  // Pass evidence through so the tests can prove identity-bearing free text
  // is stripped from locked matches.
  parseEvidencePoints: (value: unknown) => (Array.isArray(value) ? value : []),
}));
vi.mock("@/lib/apartments/search", () => ({
  getApartmentSearchSnapshot: vi.fn(async () => null),
}));
vi.mock("@/lib/apartments/match-surface", () => ({
  // Truthy empty list short-circuits loadApartmentMatches; roommate loading
  // (the code under test) is unaffected.
  apartmentMatchesFromSearchSnapshot: vi.fn(() => []),
}));
vi.mock("@/lib/profiles/photos", () => ({
  prependLinkedInProfilePhotoUrl: (
    photos: string[],
    linkedinImageUrl: string | null | undefined,
  ) => (linkedinImageUrl ? [linkedinImageUrl, ...photos] : photos),
}));
vi.mock("@/lib/profiles/enrichment-store", () => ({
  ageForKinfolkUser: vi.fn(() => 29),
  getProfileMatchingReviewState: vi.fn(async () => ({
    pendingFactCount: 0,
    pendingBehavioralCount: 0,
    hasPendingImports: false,
  })),
}));
vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: vi.fn(),
}));
vi.mock("@/lib/supabase/config", () => ({
  hasServerSupabaseConfig: vi.fn(() => true),
  supabaseUrl: "https://project.supabase.co",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/types", () => ({}));

import { getMatchesSnapshotForUserId } from "./matches";

const ANNA_PII = [
  "Chen",
  "https://photos.example/anna.jpg",
  "Acme Corp",
  "Stanford",
  "Sunset climber",
  "Portland",
  // Free-text leak vectors: edge evidence copy and fact-derived signals.
  "Anna Chen and the viewer",
  "Notre Dame",
  "works at university of notre dame",
];

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * Thenable query stub with real eq/in/not-is-null filtering, so tests fail
 * when a loader drops a filter (e.g. the membership status gate). `.or()` and
 * ordering are pass-throughs; maybeSingle() resolves to the first filtered row.
 */
function stubClient(tables: Tables) {
  return {
    from(table: string) {
      const all = tables[table] ?? [];
      const predicates: ((row: Row) => boolean)[] = [];
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ["select", "or", "order", "limit"]) {
        builder[method] = chain;
      }
      builder.eq = (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        predicates.push((row) => values.includes(row[column]));
        return builder;
      };
      builder.not = (column: string, operator: string, value: unknown) => {
        if (operator === "is" && value === null) {
          predicates.push((row) => row[column] != null);
        }
        return builder;
      };
      const rows = () => all.filter((row) => predicates.every((p) => p(row)));
      builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      builder.then = (
        resolve: (value: { data: Row[]; error: null }) => unknown,
      ) => Promise.resolve({ data: rows(), error: null }).then(resolve);
      return builder;
    },
  } as never;
}

function baseTables(overrides: Tables = {}): Tables {
  return {
    compatibility_edges: [
      {
        id: "edge-1",
        user_a_id: "viewer",
        user_b_id: "anna",
        score: 81.4,
        score_components: null,
        evidence: [
          {
            label: "Communities",
            detail: "Anna Chen and the viewer share community context: Notre Dame.",
          },
        ],
        risks: [
          { label: "Guests", detail: "Anna Chen and the viewer differ on hosting." },
        ],
        status: "active",
        computed_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    match_feedback_events: [],
    kinfolk_users: [
      {
        id: "anna",
        display_name: "Anna Chen",
        email: "anna@example.com",
        occupation_title: "Staff Engineer",
        occupation_company: "Acme Corp",
        about_text: "Sunset climber and quiet-home keeper.",
        interests: ["pottery"],
        education_school: "Stanford",
        education_degree: "BS",
        education_major: "CS",
        education_year: "2019",
        hometown: "Portland",
        birth_year: 1997,
        date_of_birth: "1997-05-01",
      },
    ],
    kinfolk_user_photos: [
      {
        user_id: "anna",
        public_url: "https://photos.example/anna.jpg",
        is_primary: true,
        position: 0,
      },
    ],
    profile_facts: [
      {
        user_id: "anna",
        dimension: "work",
        fact_key: "work_identity_current",
        normalized_value: "works at university of notre dame",
        confidence: 0.9,
        importance: 0.8,
        sensitivity_level: "standard",
        user_review_state: "approved",
        matching_eligible: true,
      },
    ],
    professional_profiles: [],
    linkedin_enrichment_jobs: [],
    matching_profiles: [
      {
        id: "mp-anna",
        user_id: "anna",
        visibility_mode: "anonymous",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    apartment_listing_matches: [],
    apartment_roommate_groups: [],
    apartment_roommate_group_memberships: [],
    ...overrides,
  };
}

const mutualIntroEvents = [
  {
    compatibility_edge_id: "edge-1",
    actor_user_id: "viewer",
    event_type: "approved_intro",
    created_at: "2026-07-02T00:00:00.000Z",
  },
  {
    compatibility_edge_id: "edge-1",
    actor_user_id: "anna",
    event_type: "approved_intro",
    created_at: "2026-07-02T00:00:01.000Z",
  },
];

describe("roommate matches — anonymous-mode identity gating (privacy)", () => {
  it("locks anonymous candidates: first name + score only, zero PII on the wire", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(baseTables()),
    );

    expect(snapshot.status).toBe("connected");
    expect(snapshot.roommates).toHaveLength(1);
    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(true);
    expect(match.name).toBe("Anna");
    expect(match.headline).toBe("Anonymous profile");
    expect(match.imageUrl).toBeNull();
    expect(match.score).toBe(81);
    expect(match.detail.photos).toEqual([]);
    expect(match.detail.age).toBeNull();
    expect(match.detail.hometown).toBeNull();
    expect(match.detail.company).toBeNull();
    expect(match.detail.school).toBeNull();
    expect(match.detail.signals).toEqual([]);
    expect(match.evidence).toEqual([]);
    expect(match.risks).toEqual([]);

    const serialized = JSON.stringify(snapshot.roommates);
    for (const marker of ANNA_PII) {
      expect(serialized).not.toContain(marker);
    }
  });

  it("shows the full profile when the candidate opted into public visibility", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          matching_profiles: [
            {
              id: "mp-anna",
              user_id: "anna",
              visibility_mode: "public",
              updated_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );

    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(false);
    expect(match.name).toBe("Anna Chen");
    expect(match.imageUrl).toBe("https://photos.example/anna.jpg");
    expect(match.detail.hometown).toBe("Portland");
    expect(match.evidence).toHaveLength(1);
  });

  it("prefers a trusted durable avatar across historical LinkedIn rows", async () => {
    const durableAvatar =
      "https://project.supabase.co/storage/v1/object/public/profile-photos/anna/linkedin-profile.jpg";
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          matching_profiles: [
            {
              id: "mp-anna",
              user_id: "anna",
              visibility_mode: "public",
              updated_at: "2026-07-01T00:00:00.000Z",
            },
          ],
          linkedin_enrichment_jobs: [
            {
              user_id: "anna",
              idempotency_key: "linkedin:anna:provider",
              image_url: "https://img.clerk.test/current.jpg",
              updated_at: "2026-07-28T12:00:00.000Z",
            },
            {
              user_id: "anna",
              idempotency_key: "linkedin:anna:manual-url",
              image_url: durableAvatar,
              updated_at: "2026-07-27T12:00:00.000Z",
            },
          ],
        }),
      ),
    );

    expect(snapshot.roommates[0]!.imageUrl).toBe(durableAvatar);
  });

  it("unlocks for an accepted co-member of the same creator-owned apartment group", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          apartment_roommate_groups: [
            { id: "group-1", created_by_user_id: "creator-x", status: "forming" },
          ],
          apartment_roommate_group_memberships: [
            { group_id: "group-1", user_id: "viewer", status: "member" },
            { group_id: "group-1", user_id: "anna", status: "member" },
          ],
        }),
      ),
    );

    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(false);
    expect(match.name).toBe("Anna Chen");
    expect(match.imageUrl).toBe("https://photos.example/anna.jpg");
  });

  it("does NOT unlock for migration-seeded groups (no creator = no consent)", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          apartment_roommate_groups: [
            { id: "group-1", created_by_user_id: null, status: "forming" },
          ],
          apartment_roommate_group_memberships: [
            { group_id: "group-1", user_id: "viewer", status: "member" },
            { group_id: "group-1", user_id: "anna", status: "member" },
          ],
        }),
      ),
    );

    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(true);
    expect(match.name).toBe("Anna");
    expect(match.imageUrl).toBeNull();
  });

  it("does NOT unlock via a closed group", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          apartment_roommate_groups: [
            { id: "group-1", created_by_user_id: "creator-x", status: "closed" },
          ],
          apartment_roommate_group_memberships: [
            { group_id: "group-1", user_id: "viewer", status: "member" },
            { group_id: "group-1", user_id: "anna", status: "member" },
          ],
        }),
      ),
    );

    expect(snapshot.roommates[0]!.locked).toBe(true);
  });

  it("does NOT unlock while the viewer's own membership is only requested", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({
          apartment_roommate_groups: [
            { id: "group-1", created_by_user_id: "creator-x", status: "forming" },
          ],
          apartment_roommate_group_memberships: [
            { group_id: "group-1", user_id: "viewer", status: "requested" },
            { group_id: "group-1", user_id: "anna", status: "member" },
          ],
        }),
      ),
    );

    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(true);
    expect(match.imageUrl).toBeNull();
  });

  it("unlocks after a mutual approved_intro (the DM-gate pattern)", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(baseTables({ match_feedback_events: mutualIntroEvents })),
    );

    const match = snapshot.roommates[0]!;
    expect(match.locked).toBe(false);
    expect(match.name).toBe("Anna Chen");
    expect(match.imageUrl).toBe("https://photos.example/anna.jpg");
  });

  it("keeps identity locked when only one side approved the intro", async () => {
    const snapshot = await getMatchesSnapshotForUserId(
      "viewer",
      stubClient(
        baseTables({ match_feedback_events: [mutualIntroEvents[1]!] }),
      ),
    );

    const match = snapshot.roommates[0]!;
    expect(match.incomingIntent).toBe(true);
    expect(match.locked).toBe(true);
    expect(match.imageUrl).toBeNull();
  });
});
