import { headers } from "next/headers";
import { PaneShell } from "@/app/(app)/me/_components/dashboard-layout";
import { PlanPane } from "@/app/(app)/me/_components/plan-pane";
import type { PlanMatch } from "@/app/(app)/me/_components/plan-pane-state";
import { getMatchesSnapshot } from "@/lib/matching/matches";
import { isViableRoommateMatch } from "@/lib/matching/roommate-match-viability";
import { getPlanSnapshotForCurrentUser } from "@/lib/plan/plan";
import { getDashboardSnapshot } from "@/lib/profiles/dashboard";

export const metadata = {
  title: "Plan",
};

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const requestHeaders = await headers();
  const baseUrl = requestBaseUrl(requestHeaders);

  const [snapshot, plan, matches] = await Promise.all([
    getDashboardSnapshot(),
    getPlanSnapshotForCurrentUser(baseUrl),
    getMatchesSnapshot(),
  ]);

  const planMatches: PlanMatch[] = matches.roommates
    .filter(isViableRoommateMatch)
    .slice(0, 4)
    .map((match) => ({
      userId: match.userId,
      name: match.name,
      initials: match.initials,
      imageUrl: match.imageUrl,
      headline: match.headline,
      score: match.score,
      components: match.components.map((component) => ({
        label: component.label,
        score: component.score,
      })),
    }));
  const firstName = snapshot.user.displayName.split(" ")[0] ?? "your";

  return (
    <PaneShell
      snapshot={snapshot}
      active="plan"
      title={`${firstName}'s plan`}
      lede="Where you want to live, who you'd live with, and what you're drawn to."
    >
      <PlanPane
        apartmentsHref="/apartments"
        inviteLink={
          plan.inviteLink
            ? {
                url: plan.inviteLink.url,
                openInviteCount: plan.inviteLink.openInviteCount,
              }
            : null
        }
        matches={planMatches}
        people={plan.people}
        plan={plan.plan}
        requestCount={matches.requests.length}
        savedAreas={plan.savedAreas}
        savedListings={plan.savedListings}
      />
    </PaneShell>
  );
}

type HeaderReader = {
  get(name: string): string | null;
};

function requestBaseUrl(requestHeaders: HeaderReader): string | null {
  const origin = normalizeRequestOrigin(firstHeaderValue(requestHeaders.get("origin")));
  if (origin) return origin;

  const host =
    normalizeRequestHost(firstHeaderValue(requestHeaders.get("x-forwarded-host"))) ??
    normalizeRequestHost(firstHeaderValue(requestHeaders.get("host")));
  if (!host) return null;

  const proto =
    normalizeRequestProtocol(firstHeaderValue(requestHeaders.get("x-forwarded-proto"))) ??
    (isLocalRequestHost(host) ? "http" : "https");

  return `${proto}://${host}`;
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function normalizeRequestOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeRequestHost(value: string | null): string | null {
  if (!value || /[\s/\\]/.test(value)) {
    return null;
  }

  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.host;
  } catch {
    return null;
  }
}

function normalizeRequestProtocol(value: string | null): "http" | "https" | null {
  const protocol = value?.toLowerCase();
  return protocol === "http" || protocol === "https" ? protocol : null;
}

function isLocalRequestHost(host: string) {
  try {
    const url = new URL(`http://${host}`);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
