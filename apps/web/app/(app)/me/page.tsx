import { redirect } from "next/navigation";
import { DashboardShell } from "@/app/(app)/me/_components/dashboard-shell";
import { claimContactInviteForCurrentUser } from "@/lib/contacts/network";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { getProfileSummarySnapshot } from "@/lib/profiles/enrichment-store";

export const metadata = {
  title: "Me",
};

export default async function MePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const inviteToken = readStringParam(params?.invite);
  if (inviteToken) {
    const claim = await claimContactInviteForCurrentUser({
      token: inviteToken,
    });
    if (claim.status === "claimed" || claim.status === "already_owner") {
      redirect("/me/plan?invite=claimed");
    }
    if (claim.status === "missing") {
      redirect("/me?invite_error=missing");
    }
    if (claim.status === "sign_in_required") {
      redirect(`/sign-up?${new URLSearchParams({ invite: inviteToken })}`);
    }
  }

  const [snapshot, enrichment] = await Promise.all([
    getDashboardSnapshot(),
    getProfileSummarySnapshot(),
  ]);

  return <DashboardShell enrichment={enrichment} snapshot={snapshot} />;
}

function readStringParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}
