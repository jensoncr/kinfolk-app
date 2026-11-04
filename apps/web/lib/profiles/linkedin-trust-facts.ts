// Projects LinkedIn work/education signal into matchable trust_context facts.
//
// LinkedIn enrichment lands in `professional_profiles` and previously only fed
// logos/labels on roommate cards — the matching engine's trust-bridge dimension
// (weight 0.10) stayed empty for nearly every user. This builder turns the
// verified employer/school timeline into profile facts so two people at the same
// company or alma mater get a real trust-bridge signal, and so "verified work or
// school" stops defaulting to the neutral 0.5.
//
// Pure (no I/O) so it can be unit-tested; the enrichment job feeds the result
// through the normal import → approve → project → recompute pipeline.

import type { LinkedInTimelineItem } from "../shared/types";
import type { Json } from "@/lib/supabase/types";

export type LinkedInTrustProfile = {
  headline: string | null;
  workExperience: LinkedInTimelineItem[];
  education: LinkedInTimelineItem[];
};

type StructuredImportFact = Record<string, Json>;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

/**
 * Build the trust-context facts implied by a LinkedIn profile. Returns an empty
 * array when there's no usable work or education signal.
 */
export function buildLinkedInTrustFacts(
  profile: LinkedInTrustProfile,
): StructuredImportFact[] {
  const facts: StructuredImportFact[] = [];

  const headline = clean(profile.headline);
  const currentRole = profile.workExperience[0];
  const roleSummary = currentRole
    ? [clean(currentRole.title), clean(currentRole.organization)].filter(Boolean).join(" at ")
    : "";
  const topSchool = clean(profile.education[0]?.organization);

  const verifiedParts = dedupePreservingOrder(
    [headline || roleSummary, topSchool].filter(Boolean),
  );

  if (verifiedParts.length > 0) {
    facts.push({
      dimension: "trust_context",
      fact_key: "verified_work_or_school",
      assertion_type: "imported",
      confidence: 0.9,
      sensitivity_level: "standard",
      evidence: "Verified via LinkedIn enrichment",
      value: verifiedParts.join(" · "),
    });
  }

  const communities = dedupePreservingOrder([
    ...profile.workExperience.map((item) => clean(item.organization)),
    ...profile.education.map((item) => clean(item.organization)),
  ]);

  if (communities.length > 0) {
    facts.push({
      dimension: "trust_context",
      fact_key: "shared_communities",
      assertion_type: "imported",
      confidence: 0.85,
      sensitivity_level: "standard",
      evidence: "Employers and schools from LinkedIn",
      value: communities,
    });
  }

  return facts;
}
