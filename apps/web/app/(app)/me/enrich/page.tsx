import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildDevLocalEnrichRedirectUrl,
  isDevLocalEnrichRedirectCandidate,
} from "@/app/(app)/me/_components/enrichment/dev-local-enrich-redirect-url";
import { ProfileEnrichmentForm } from "@/app/(app)/me/_components/enrichment/profile-enrichment-form";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";
import { buildProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";
import { getProfileSummarySnapshot } from "@/lib/profiles/enrichment-store";

const ENRICH_OG_TITLE = "Finish your richer Kinfolk profile";
const ENRICH_OG_DESCRIPTION =
  "A few form-friendly details — daily rhythm, must-haves, and the hard no's — make your roommate matches a lot sharper.";

export const metadata = {
  title: "Finish Profile",
  description: ENRICH_OG_DESCRIPTION,
  openGraph: {
    title: ENRICH_OG_TITLE,
    description: ENRICH_OG_DESCRIPTION,
    siteName: "Kinfolk",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: ENRICH_OG_TITLE,
    description: ENRICH_OG_DESCRIPTION,
  },
};

export default async function EnrichProfilePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectDevTunnelHumanToLocal(await searchParams);

  const [snapshot, enrichment] = await Promise.all([
    getDashboardSnapshot(),
    getProfileSummarySnapshot(),
  ]);
  const firstName = snapshot.user.displayName.split(" ")[0] || "there";

  return (
    <>
      <ProfileEnrichmentForm
        firstName={firstName}
        initialValues={buildProfileEnrichmentFormValues(snapshot, enrichment)}
      />
    </>
  );
}

function getDevLocalEnrichBaseUrl() {
  if (process.env.NODE_ENV === "production") {
    return "";
  }

  const explicit = process.env.KINFOLK_DEV_LOCAL_BASE_URL?.trim();
  const fallback = `http://localhost:${process.env.PORT ?? "3000"}`;
  return explicit || fallback;
}

async function redirectDevTunnelHumanToLocal(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (!isDevLocalEnrichRedirectCandidate(searchParams)) {
    return;
  }

  const localBaseUrl = getDevLocalEnrichBaseUrl();
  const requestHeaders = await headers();
  const target = buildDevLocalEnrichRedirectUrl({
    host: requestHeaders.get("host") ?? "",
    localBaseUrl,
    searchParams,
    userAgent: requestHeaders.get("user-agent") ?? "",
  });
  if (target) redirect(target);
}
