import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  ensureCurrentKinfolkUser: vi.fn(),
}));

vi.mock("@/lib/shared/users", () => ({
  ensureCurrentKinfolkUser: mocks.ensureCurrentKinfolkUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

import {
  claimContactInviteForCurrentUser,
  ensureShareInviteLinkForUser,
  getContactInviteLanding,
} from "./network";

type TableQuery = {
  eq?: ReturnType<typeof vi.fn>;
  in?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  is?: ReturnType<typeof vi.fn>;
  limit?: ReturnType<typeof vi.fn>;
  maybeSingle?: ReturnType<typeof vi.fn>;
  neq?: ReturnType<typeof vi.fn>;
  order?: ReturnType<typeof vi.fn>;
  select?: ReturnType<typeof vi.fn>;
  single?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
};

const currentUser = {
  display_name: "Invitee User",
  email: " INVITEE@Example.COM ",
  id: "invitee-user",
  phone_e164: "+14155550199",
};

function queryResult(data: unknown = null, error: Error | null = null) {
  return { data, error };
}

function lookupQuery(result: unknown): TableQuery {
  const query: TableQuery = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => queryResult(result));
  return query;
}

function shareGroupLookupQuery(result: unknown): TableQuery {
  const query: TableQuery = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.neq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => queryResult(result));
  return query;
}

function rowsLookupQuery(result: unknown): TableQuery {
  const query: TableQuery = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.neq = vi.fn(async () => queryResult(result));
  return query;
}

function memberRowsLookupQuery(result: unknown): TableQuery {
  const query: TableQuery = {};
  query.select = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.eq = vi.fn(async () => queryResult(result));
  return query;
}

function updateQuery() {
  const query: TableQuery = {};
  query.update = vi.fn(() => query);
  query.eq = vi
    .fn()
    .mockImplementationOnce(() => query)
    .mockImplementationOnce(async () => ({ error: null }));
  return query;
}

function upsertResultQuery() {
  return {
    upsert: vi.fn(async () => ({ error: null })),
  };
}

function upsertSelectSingleQuery(data: unknown) {
  const query: TableQuery = {};
  query.upsert = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn(async () => queryResult(data));
  return query;
}

function insertSelectSingleQuery(data: unknown) {
  const query: TableQuery = {};
  query.insert = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn(async () => queryResult(data));
  return query;
}

function supabaseFromQueue(
  entries: Array<[table: string, query: TableQuery | { upsert: ReturnType<typeof vi.fn> }]>,
) {
  const queue = [...entries];
  return {
    from: vi.fn((table: string) => {
      const entry = queue.shift();
      if (!entry) throw new Error(`Unexpected Supabase table access: ${table}`);
      expect(table).toBe(entry[0]);
      return entry[1];
    }),
  };
}

describe("getContactInviteLanding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns missing when no active share exists", async () => {
    const shareLookup = lookupQuery(null);
    const supabase = supabaseFromQueue([["roommate_contact_groups", shareLookup]]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(getContactInviteLanding("share-token")).resolves.toEqual({
      status: "missing",
    });

    expect(shareLookup.neq).toHaveBeenCalledWith("status", "archived");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns public-safe context for an active shared invite", async () => {
    const shareLookup = lookupQuery({
      label: "Avery's group",
      owner_user_id: "owner-user",
    });
    const ownerLookup = lookupQuery({ display_name: "Avery Stone" });
    const supabase = supabaseFromQueue([
      ["roommate_contact_groups", shareLookup],
      ["kinfolk_users", ownerLookup],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(getContactInviteLanding("share-token")).resolves.toEqual({
      groupLabel: "Avery's group",
      inviterName: "Avery",
      status: "found",
    });

    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});

describe("claimContactInviteForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONTACT_GRAPH_HASH_SECRET", "contact-secret");
    mocks.ensureCurrentKinfolkUser.mockResolvedValue({
      identity: { subject: "clerk-user" },
      user: currentUser,
    });
  });

  it("returns sign_in_required before querying group rows", async () => {
    const supabase = supabaseFromQueue([]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);
    mocks.ensureCurrentKinfolkUser.mockResolvedValueOnce({
      identity: null,
      user: null,
    });

    await expect(
      claimContactInviteForCurrentUser({ token: "share-token" }),
    ).resolves.toEqual({ status: "sign_in_required" });

    expect(mocks.ensureCurrentKinfolkUser).toHaveBeenCalledWith(supabase);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns already_owner without mutating a shared invite owned by the current user", async () => {
    const supabase = supabaseFromQueue([
      ["roommate_contact_groups", lookupQuery({
        id: "group-1",
        label: "My group",
        owner_user_id: "invitee-user",
        share_token: "share-token",
      })],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(
      claimContactInviteForCurrentUser({ token: "share-token" }),
    ).resolves.toEqual({ groupLabel: "My group", status: "already_owner" });

    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns missing for archived shared invites before creating memberships", async () => {
    const shareGroupLookup = lookupQuery(null);
    const supabase = supabaseFromQueue([["roommate_contact_groups", shareGroupLookup]]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(
      claimContactInviteForCurrentUser({ token: "share-token" }),
    ).resolves.toEqual({ status: "missing" });

    expect(shareGroupLookup.neq).toHaveBeenCalledWith("status", "archived");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("claims a shared invite by creating a matched contact membership and social edge", async () => {
    const contactUpsert = upsertSelectSingleQuery({ id: "contact-1" });
    const memberUpsert = upsertResultQuery();
    const contactUpdate = updateQuery();
    const edgeUpsert = upsertResultQuery();
    const supabase = supabaseFromQueue([
      [
        "roommate_contact_groups",
        lookupQuery({
          id: "group-1",
          label: "Shared group",
          owner_user_id: "owner-user",
          share_token: "share-token",
        }),
      ],
      ["user_contacts", contactUpsert],
      ["roommate_contact_group_members", memberUpsert],
      ["user_contacts", contactUpdate],
      ["kinfolk_social_edges", edgeUpsert],
    ]);
    mocks.createSupabaseServiceClient.mockReturnValue(supabase);

    await expect(
      claimContactInviteForCurrentUser({ token: "share-token" }),
    ).resolves.toEqual({ groupLabel: "Shared group", status: "claimed" });

    expect(contactUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Invitee User",
        emails: ["invitee@example.com"],
        matched_user_id: "invitee-user",
        owner_user_id: "owner-user",
        phone_hashes: expect.any(Array),
        phones: ["+14155550199"],
        source: "manual",
        trust_state: "matched",
      }),
      { onConflict: "owner_user_id,contact_key" },
    );
    expect(memberUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_group_id: "group-1",
        contact_id: "contact-1",
        matched_user_id: "invitee-user",
        status: "accepted",
      }),
      { onConflict: "contact_group_id,contact_id" },
    );
    expect(edgeUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        edge_type: "invite",
        source_contact_id: "contact-1",
      }),
      { onConflict: "user_a_id,user_b_id,edge_type,created_by_user_id" },
    );
  });
});

describe("ensureShareInviteLinkForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  function supabaseForExistingShareLink() {
    const existingGroup = shareGroupLookupQuery({
      id: "group-1",
      label: "Avery's group",
      share_token: "share-token",
    });
    const ownedGroups = rowsLookupQuery([{ id: "group-1" }]);
    const joinedMembers = memberRowsLookupQuery([]);
    const supabase = supabaseFromQueue([
      ["roommate_contact_groups", existingGroup],
      ["roommate_contact_groups", ownedGroups],
      ["roommate_contact_group_members", joinedMembers],
    ]);
    return { existingGroup, joinedMembers, ownedGroups, supabase };
  }

  it("normalizes public env bases before returning share invite links", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", " https://kinfolk.example.com/app/// ");
    const { supabase } = supabaseForExistingShareLink();

    await expect(
      ensureShareInviteLinkForUser(supabase as never, "owner-user", "https://fallback.test"),
    ).resolves.toEqual({
      openInviteCount: 1,
      shareToken: "share-token",
      url: "https://kinfolk.example.com/invite/share-token",
    });
  });

  it("creates a new share group when no active reusable group exists", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "https://kinfolk.example.com");
    const existingGroup = shareGroupLookupQuery(null);
    const userLookup = lookupQuery({ display_name: "Avery Stone" });
    const createdGroup = insertSelectSingleQuery({
      id: "new-group",
      label: "Avery's group",
      share_token: "new-share-token",
    });
    const ownedGroups = rowsLookupQuery([{ id: "new-group" }]);
    const joinedMembers = memberRowsLookupQuery([]);
    const supabase = supabaseFromQueue([
      ["roommate_contact_groups", existingGroup],
      ["kinfolk_users", userLookup],
      ["roommate_contact_groups", createdGroup],
      ["roommate_contact_groups", ownedGroups],
      ["roommate_contact_group_members", joinedMembers],
    ]);

    await expect(
      ensureShareInviteLinkForUser(supabase as never, "owner-user"),
    ).resolves.toEqual({
      openInviteCount: 1,
      shareToken: "new-share-token",
      url: "https://kinfolk.example.com/invite/new-share-token",
    });

    expect(existingGroup.neq).toHaveBeenCalledWith("status", "archived");
    expect(createdGroup.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Avery's group",
        owner_user_id: "owner-user",
        status: "planning",
        target_household_size: 2,
      }),
    );
    expect(ownedGroups.neq).toHaveBeenCalledWith("status", "archived");
  });

  it("falls back to the request base when public env base is not http", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "javascript:alert(1)");
    const { supabase } = supabaseForExistingShareLink();

    await expect(
      ensureShareInviteLinkForUser(supabase as never, "owner-user", "https://plans.kinfolk.example/path"),
    ).resolves.toMatchObject({
      url: "https://plans.kinfolk.example/invite/share-token",
    });
  });

  it("returns a relative invite path when every base is malformed", async () => {
    vi.stubEnv("NEXT_PUBLIC_KINFOLK_BASE_URL", "ftp://kinfolk.example");
    const { supabase } = supabaseForExistingShareLink();

    await expect(
      ensureShareInviteLinkForUser(supabase as never, "owner-user", "not a url"),
    ).resolves.toMatchObject({
      url: "/invite/share-token",
    });
  });
});
