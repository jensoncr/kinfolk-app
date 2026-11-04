import "server-only";

import { cache } from "react";
import { currentUser } from "@clerk/nextjs/server";
import {
  linkedInProfileUrlFromSlug,
  normalizeLinkedInProfileSlug,
  normalizeLinkedInProfileUrl,
} from "@/lib/profiles/linkedin-url";

type ClerkLinkedInAccount = {
  provider: string;
  providerUserId: string | null;
  externalAccountId: string | null;
  emailAddress: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  username: string | null;
  profileUrl: string | null;
  approvedScopes: string[];
};

export type ClerkLinkedInIdentity = {
  clerkUserId: string;
  displayName: string;
  email: string | null;
  externalAuthConnected: boolean;
  avatarUrl: string;
  linkedin: ClerkLinkedInAccount | null;
};

type ClerkExternalAccount = NonNullable<
  Awaited<ReturnType<typeof currentUser>>
>["externalAccounts"][number];

const profileUrlMetadataKeys = [
  "profile_url",
  "profileUrl",
  "linkedin_url",
  "linkedinUrl",
  "public_profile_url",
  "publicProfileUrl",
];

export const getCurrentClerkLinkedInIdentity = cache(async (): Promise<ClerkLinkedInIdentity | null> => {
  const user = await currentUser();

  if (!user) {
    return null;
  }

  const linkedInAccount =
    user.externalAccounts.find((account) =>
      readTrimmedString(account.provider)?.toLowerCase().includes("linkedin"),
    ) ??
    null;
  const displayName =
    readTrimmedString(user.fullName) ??
    joinDisplayName(user.firstName, user.lastName) ??
    linkedInAccountDisplayName(linkedInAccount) ??
    "Kinfolk member";

  return {
    clerkUserId: user.id,
    displayName,
    email:
      readTrimmedString(user.primaryEmailAddress?.emailAddress) ??
      readTrimmedString(linkedInAccount?.emailAddress) ??
      null,
    externalAuthConnected: user.externalAccounts.length > 0,
    avatarUrl:
      readTrimmedString(user.imageUrl) ??
      readTrimmedString(linkedInAccount?.imageUrl) ??
      "",
    linkedin: linkedInAccount ? mapLinkedInAccount(linkedInAccount) : null,
  };
});

function mapLinkedInAccount(account: ClerkExternalAccount): ClerkLinkedInAccount {
  const username = normalizeLinkedInProfileSlug(account.username);
  const metadataProfileUrl = readMetadataString(account.publicMetadata, profileUrlMetadataKeys);
  const profileUrl = normalizeLinkedInProfileUrl(metadataProfileUrl) ?? linkedInProfileUrlFromSlug(username);

  return {
    provider: readTrimmedString(account.provider) ?? account.provider,
    providerUserId: readTrimmedString(account.providerUserId),
    externalAccountId: readTrimmedString(account.id),
    emailAddress: readTrimmedString(account.emailAddress),
    firstName: readTrimmedString(account.firstName),
    lastName: readTrimmedString(account.lastName),
    imageUrl: readTrimmedString(account.imageUrl),
    username,
    profileUrl,
    approvedScopes: splitApprovedScopes(account.approvedScopes),
  };
}

function splitApprovedScopes(value: string | null | undefined) {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function linkedInAccountDisplayName(account: ClerkExternalAccount | null) {
  if (!account) {
    return null;
  }

  return joinDisplayName(account.firstName, account.lastName);
}

function readMetadataString(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const metadata = value as Record<string, unknown>;

  for (const key of keys) {
    const candidate = metadata[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function joinDisplayName(firstName: string | null | undefined, lastName: string | null | undefined) {
  const parts = [readTrimmedString(firstName), readTrimmedString(lastName)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function readTrimmedString(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}
