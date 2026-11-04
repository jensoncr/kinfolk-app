import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneE164 } from "@/lib/contacts/normalization";
import { ensureCurrentKinfolkUser } from "@/lib/shared/users";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireBoundarySecret } from "@/lib/shared/secrets";
import type { Database, Json } from "@/lib/supabase/types";

type SupabaseServiceClient = SupabaseClient<Database>;
type TableRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];

type ContactGroupRow = TableRow<"roommate_contact_groups">;

/**
 * The link a person shares to add the people they'd actually live with to their
 * plan. One durable share token per owner, reused — link creation is fully
 * decoupled from any send path. Kinfolk never texts these contacts; the owner
 * shares the link themselves. This is the TCPA-safe replacement for the old
 * auto-SMS-on-group-create flow.
 */
export type ShareInviteLink = {
  url: string;
  shareToken: string;
  /** Owned links nobody has joined yet. */
  openInviteCount: number;
};

export type ContactInviteLanding = {
  status: "found" | "missing";
  groupLabel?: string;
  /** First name only — the owner deliberately shared this link. */
  inviterName?: string;
};

export type ContactInviteClaimResult =
  | { status: "claimed"; groupLabel: string }
  | { status: "already_owner"; groupLabel: string }
  | { status: "missing" }
  | { status: "sign_in_required" };

export async function ensureShareInviteLinkForUser(
  supabase: SupabaseServiceClient,
  userId: string,
  baseUrl?: string | null,
): Promise<ShareInviteLink> {
  const existing = await supabase
    .from("roommate_contact_groups")
    .select("id,share_token,label")
    .eq("owner_user_id", userId)
    .is("listing_id", null)
    .neq("status", "archived")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let group = existing.data;
  if (!group) {
    const userResult = await supabase
      .from("kinfolk_users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (userResult.error) throw userResult.error;
    const created = await supabase
      .from("roommate_contact_groups")
      .insert({
        owner_user_id: userId,
        share_token: randomToken(18),
        label: shareLinkLabel(userResult.data?.display_name ?? null),
        target_household_size: 2,
        status: "planning",
      })
      .select("id,share_token,label")
      .single();
    if (created.error) throw created.error;
    group = created.data;
  }

  const openInviteCount = await countOpenInvites(supabase, userId);
  return {
    url: inviteUrl(baseUrl, group.share_token),
    shareToken: group.share_token,
    openInviteCount,
  };
}

/** Owned share-link groups with no one accepted yet. */
async function countOpenInvites(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<number> {
  const ownedResult = await supabase
    .from("roommate_contact_groups")
    .select("id")
    .eq("owner_user_id", userId)
    .is("listing_id", null)
    .neq("status", "archived");
  if (ownedResult.error) throw ownedResult.error;
  const ownedIds = (ownedResult.data ?? []).map((row) => row.id);
  if (ownedIds.length === 0) return 0;

  const membersResult = await supabase
    .from("roommate_contact_group_members")
    .select("contact_group_id")
    .in("contact_group_id", ownedIds)
    .eq("status", "accepted");
  if (membersResult.error) throw membersResult.error;

  const joinedGroupIds = new Set(
    (membersResult.data ?? []).map((row) => row.contact_group_id),
  );
  return ownedIds.filter((id) => !joinedGroupIds.has(id)).length;
}

export async function getContactInviteLanding(token: string): Promise<ContactInviteLanding> {
  const cleanToken = token.trim();
  if (!cleanToken) return { status: "missing" };

  const supabase = createSupabaseServiceClient();
  const groupResult = await supabase
    .from("roommate_contact_groups")
    .select("label,owner_user_id")
    .eq("share_token", cleanToken)
    .neq("status", "archived")
    .maybeSingle();

  if (groupResult.error) throw groupResult.error;
  const group = groupResult.data;
  if (!group) return { status: "missing" };

  const ownerResult = await supabase
    .from("kinfolk_users")
    .select("display_name")
    .eq("id", group.owner_user_id)
    .maybeSingle();

  if (ownerResult.error) throw ownerResult.error;

  return {
    status: "found",
    groupLabel: group.label,
    inviterName: firstName(ownerResult.data?.display_name ?? "A Kinfolk member"),
  };
}

export async function claimContactInviteForCurrentUser({
  token,
}: {
  token: string;
}): Promise<ContactInviteClaimResult> {
  const cleanToken = token.trim();
  if (!cleanToken) return { status: "missing" };

  const supabase = createSupabaseServiceClient();
  const { user } = await ensureCurrentKinfolkUser(supabase);
  if (!user) {
    return { status: "sign_in_required" };
  }

  const groupResult = await supabase
    .from("roommate_contact_groups")
    .select("*")
    .eq("share_token", cleanToken)
    .neq("status", "archived")
    .maybeSingle();
  if (groupResult.error) throw groupResult.error;
  if (!groupResult.data) return { status: "missing" };

  return claimSharedContactGroupInvite(supabase, {
    group: groupResult.data,
    user,
  });
}

async function claimSharedContactGroupInvite(
  supabase: SupabaseServiceClient,
  {
    group,
    user,
  }: {
    group: ContactGroupRow;
    user: TableRow<"kinfolk_users">;
  },
): Promise<ContactInviteClaimResult> {
  if (group.owner_user_id === user.id) {
    return { groupLabel: group.label, status: "already_owner" };
  }

  const contact = await upsertInviteeContactForOwner(supabase, {
    ownerUserId: group.owner_user_id,
    user,
  });
  await acceptContactGroupMember(supabase, {
    contactGroupId: group.id,
    contactId: contact.id,
    matchedUserId: user.id,
    ownerUserId: group.owner_user_id,
  });

  return { groupLabel: group.label, status: "claimed" };
}

async function upsertInviteeContactForOwner(
  supabase: SupabaseServiceClient,
  {
    ownerUserId,
    user,
  }: {
    ownerUserId: string;
    user: TableRow<"kinfolk_users">;
  },
) {
  const email = user.email?.trim().toLowerCase() || null;
  const phone = normalizePhoneE164(user.phone_e164) ?? null;
  const contactKey = contactIdentifierHash(
    "contact",
    phone ? `phone:${phone}` : email ? `email:${email}` : `user:${user.id}`,
  );

  const result = await supabase
    .from("user_contacts")
    .upsert(
      {
        contact_key: contactKey,
        display_name: user.display_name || "Kinfolk member",
        email_hashes: email ? [contactIdentifierHash("email", email)] : [],
        emails: email ? [email] : [],
        matched_user_id: user.id,
        owner_user_id: ownerUserId,
        phone_hashes: phone ? [contactIdentifierHash("phone", phone)] : [],
        phones: phone ? [phone] : [],
        primary_email: email,
        primary_phone_e164: phone,
        source: "manual",
        trust_state: "matched",
      },
      { onConflict: "owner_user_id,contact_key" },
    )
    .select("*")
    .single();
  if (result.error) throw result.error;
  return result.data;
}

async function acceptContactGroupMember(
  supabase: SupabaseServiceClient,
  {
    contactGroupId,
    contactId,
    matchedUserId,
    ownerUserId,
  }: {
    contactGroupId: string;
    contactId: string;
    matchedUserId: string;
    ownerUserId: string;
  },
) {
  const memberResult = await supabase
    .from("roommate_contact_group_members")
    .upsert(
      {
        contact_group_id: contactGroupId,
        contact_id: contactId,
        matched_user_id: matchedUserId,
        role: "invitee",
        status: "accepted",
      },
      { onConflict: "contact_group_id,contact_id" },
    );
  if (memberResult.error) throw memberResult.error;

  const contactResult = await supabase
    .from("user_contacts")
    .update({
      matched_user_id: matchedUserId,
      trust_state: "matched",
    })
    .eq("id", contactId)
    .eq("owner_user_id", ownerUserId);
  if (contactResult.error) throw contactResult.error;

  await upsertSocialEdge(supabase, {
    createdByUserId: ownerUserId,
    evidence: {
      source: "roommate_contact_invite",
      contact_group_id: contactGroupId,
      contact_id: contactId,
    } satisfies Json,
    sourceContactId: contactId,
    strength: 0.9,
    type: "invite",
    userAId: ownerUserId,
    userBId: matchedUserId,
  });
}

async function upsertSocialEdge(
  supabase: SupabaseServiceClient,
  {
    createdByUserId,
    evidence,
    sourceContactId,
    strength,
    type,
    userAId,
    userBId,
  }: {
    createdByUserId: string;
    evidence: Json;
    sourceContactId: string;
    strength: number;
    type: "contact_import" | "invite";
    userAId: string;
    userBId: string;
  },
) {
  const [a, b] = [userAId, userBId].sort();
  const result = await supabase.from("kinfolk_social_edges").upsert(
    {
      user_a_id: a,
      user_b_id: b,
      edge_type: type,
      created_by_user_id: createdByUserId,
      source_contact_id: sourceContactId,
      strength,
      evidence,
      status: "active",
    },
    { onConflict: "user_a_id,user_b_id,edge_type,created_by_user_id" },
  );

  if (result.error) throw result.error;
}

function contactIdentifierHash(kind: string, value: string) {
  const secret = requireBoundarySecret("CONTACT_GRAPH_HASH_SECRET", "contact-graph");
  return createHmac("sha256", secret).update(`${kind}:${value.trim().toLowerCase()}`).digest("hex");
}

function shareLinkLabel(displayName: string | null) {
  const name = firstName(displayName ?? "");
  return name ? `${name}'s group` : "Your group";
}

function inviteUrl(baseUrl: string | null | undefined, token: string) {
  const base =
    normalizeInviteBaseUrl(process.env.NEXT_PUBLIC_KINFOLK_BASE_URL) ||
    normalizeInviteBaseUrl(baseUrl);
  return `${base}/invite/${token}`;
}

function normalizeInviteBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function firstName(name: string) {
  return name.split(/\s+/).find(Boolean) ?? name;
}

function randomToken(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}
