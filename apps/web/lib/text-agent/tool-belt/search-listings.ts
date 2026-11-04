import { readNumber, readPositiveLimit, readString, readStringArray } from "./args";
import { escapeRegExp } from "@/lib/shared/regex";
import { buildListingShortlinkUrl } from "../../apartments/listing-shortlink";
import {
  formatFeatureAssessmentGuidance,
  inferListingFeatureRequestsFromTerms,
  isSoftListingFeatureTerm,
  loadListingFeatureAssessmentsForCards,
  sortCardsByFeatureAssessments,
} from "../../apartments/listing-feature-assessments";
import type { HousingAgentTool, HousingAgentToolMedia } from "./types";
import type { ListingProximityConstraint } from "@/lib/apartments/listing-request-context";
import type {
  ListingRecommendationCard,
  SupabaseServiceClient,
} from "../store-types";

export const searchListingsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Search active SF apartment listings (scored against the user's saved profile) and return semantic rows for the agent to narrate. Kinfolk attaches a card for each listing the agent names. Pass the user's current constraints in args. Use budgetPreferredMax for a target/ideal cap and budgetMax for the hard stretch cap.",
      name: "search_listings",
      parameters: {
        additionalProperties: false,
        properties: {
          bedroomsMin: { type: "number" },
          bedroomsMax: { type: "number" },
          budgetMax: {
            description:
              "Hard per-person rent cap. If the user says they can stretch to this number for the right fit, put that stretch ceiling here.",
            type: "number",
          },
          budgetPreferredMax: {
            description:
              "Preferred/target per-person rent cap. Use when the user says they are trying to stay under/around one number but can stretch higher.",
            type: "number",
          },
          householdSize: {
            description:
              "How many people will live in the unit together (the user plus the roommates they're searching with). Pass it whenever the conversation says how many are moving — it lets multi-bedroom rents split per person, so a duo with $2500 each correctly sees $5000 two-bedrooms.",
            type: "number",
          },
          availableBy: {
            description:
              "Only include listings available on or before this date (YYYY-MM-DD). Use when they need to move in by a date.",
            type: "string",
          },
          avoidTerms: {
            items: { type: "string" },
            type: "array",
          },
          excludeAlreadyShown: {
            description:
              "Set true when they ask for more or other options, so every listing already texted in this thread is skipped.",
            type: "boolean",
          },
          excludeIds: {
            description:
              "recommendationIds (or listing ids) to leave out, e.g. ones they rejected.",
            items: { type: "string" },
            type: "array",
          },
          desiredTerms: {
            items: { type: "string" },
            type: "array",
          },
          limit: { type: "number" },
          neighborhoods: {
            items: { type: "string" },
            type: "array",
          },
          proximityConstraints: {
            description:
              "Generic proximity preferences or dealbreakers. Use this for requests like 'near Compton\\'s Coffee' or 'not near Caltrain' instead of forcing every place/location phrase into transitTargets.",
            items: {
              additionalProperties: false,
              properties: {
                area: { type: "string" },
                hardness: {
                  enum: ["dealbreaker", "preference"],
                  type: "string",
                },
                maxMiles: { type: "number" },
                polarity: {
                  enum: ["prefer", "avoid"],
                  type: "string",
                },
                targetName: { type: "string" },
                targetType: {
                  enum: ["place", "transit"],
                  type: "string",
                },
              },
              type: "object",
            },
            type: "array",
          },
          transitTargets: {
            items: { type: "string" },
            type: "array",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const criteria = readListingSearchCriteriaFromArgs(
      context.body ?? "",
      args,
    );
    const {
      availableBy,
      avoidTerms,
      bedroomsMax,
      bedroomsMin,
      budgetMax,
      budgetPreferredMax,
      desiredTerms,
      excludeAlreadyShown,
      excludeIds,
      householdSize,
      ignoreBudget,
      limit,
      mergeSavedNeighborhoods,
      neighborhoods,
      proximityConstraints,
      sortMode,
      transitTargets,
      validationSignals,
    } = criteria;
    const hasSoftFeatureRequest = desiredTerms.some(isSoftListingFeatureTerm);

    const [
      {
        formatGeocodeFailureGuidance,
        mergeListingRecommendationCards,
        searchCompatibleListingCards,
      },
      { persistListingRecommendationCards },
      { buildListingCardUrl },
      { emptyListingRequestContext },
      { getKinfolkPublicMediaBaseUrl },
    ] = await Promise.all([
      import("../listing-recommendations"),
      import("../listing-delivery"),
      import("../../apartments/listing-card"),
      import("../../apartments/listing-request-context"),
      import("../store-shared"),
    ]);

    // "Show me more" support: everything already texted in this thread (or
    // explicitly excluded by id) gets filtered out, and the fetch pool grows so
    // there are still `limit` fresh options left after the exclusion.
    const [excludedListingIds, savedBudgetCaps] = await Promise.all([
      resolveExcludedListingIds(context.supabase, {
        excludeAlreadyShown,
        excludeIds,
        threadId: context.threadId,
        userId: context.userId,
      }),
      ignoreBudget
        ? Promise.resolve({ hardMax: null, preferredMax: null })
        : loadSavedBudgetCaps(context.supabase, context.userId, {
            needsHardMax: budgetMax == null,
            needsPreferredMax: budgetPreferredMax == null,
          }),
    ]);
    // The recommendation pipeline filters on availableBy (shared option name,
    // listing-recommendations.ts); the tool-side check against
    // apartment_listings.available_at below stays as a safety net.
    const availabilityOption = availableBy ? { availableBy } : {};
    const hardBudgetCap = ignoreBudget
      ? null
      : (budgetMax ?? savedBudgetCaps.hardMax);
    const rawPreferredBudgetCap = ignoreBudget
      ? null
      : (budgetPreferredMax ?? savedBudgetCaps.preferredMax);
    const primaryBudgetCap =
      rawPreferredBudgetCap != null &&
      (hardBudgetCap == null || rawPreferredBudgetCap < hardBudgetCap)
        ? rawPreferredBudgetCap
        : hardBudgetCap;
    const stretchBudgetCap =
      rawPreferredBudgetCap != null &&
      hardBudgetCap != null &&
      rawPreferredBudgetCap < hardBudgetCap
        ? hardBudgetCap
        : null;
    const includeSavedBudget = !ignoreBudget && hardBudgetCap == null;

    // Reuse the scored card pipeline so rents, fit, per-person splits, photos,
    // and evidence are real — and so the agent can speak the same numbers the
    // card shows. Query against the hard cap, then filter to the preferred cap
    // first when the user gave a target-plus-stretch budget.
    const requestContext = {
      ...emptyListingRequestContext,
      avoidTerms,
      bedroomsMax: bedroomsMax ?? null,
      bedroomsMin: bedroomsMin ?? null,
      budgetMax: hardBudgetCap ?? null,
      householdSize,
      mustHaves: desiredTerms,
      neighborhoods,
      proximityConstraints,
      transitTargets,
    };
    const fetchLimit = Math.min(limit + 4 + excludedListingIds.size, 24);
    // A "near <place>" request (e.g. "near Saint Frank's coffee shop") is its
    // own search intent. Saved must-haves ("near Caltrain") and saved
    // neighborhoods must NOT hijack it into the user's usual areas — otherwise a
    // coffee-shop search gets silently redirected to far Caltrain-anchored saved
    // listings. For a named-place search we drop those saved filters and let
    // proximity ranking + the budget cap select listings near the place.
    // Prefer-polarity only: "not near X" is an exclusion, not a place to
    // search around — it must not drop saved filters or drive "closest to X"
    // phrasing about the very spot the user wants distance from.
    const explicitNamedPlaceProximity = proximityConstraints.some(
      (constraint) =>
        constraint.target.type === "place" && constraint.polarity === "prefer",
    );
    const proximityTargetName =
      proximityConstraints.find(
        (constraint) =>
          constraint.target.type === "place" && constraint.polarity === "prefer",
      )?.target.name ?? null;
    // Strict pass honors saved must-haves; relax must-haves (not area) when it
    // comes up empty so a casual "show me places" doesn't dead-end on one saved
    // must-have. We deliberately do NOT silently broaden neighborhoods — the
    // agent offers that out loud instead.
    const primarySearch = await searchCompatibleListingCards(context.supabase, {
      ...availabilityOption,
      allowPartialMustHaves: hasSoftFeatureRequest,
      allowUnmatchedPartialMustHaves: hasSoftFeatureRequest,
      includeSavedBudget,
      includeSavedMustHaves: !explicitNamedPlaceProximity,
      includeSavedNeighborhoods: !explicitNamedPlaceProximity,
      limit: fetchLimit,
      mergeSavedNeighborhoods,
      requestContext,
      userId: context.userId,
    });
    let cards = primarySearch.cards;
    // Named places no geocoder could locate: the summary must say the lookup
    // failed instead of blaming budget/beds for a thin result.
    const geocodeFailedPlaces = new Set(primarySearch.geocodeFailedPlaces);
    // Relax saved must-haves only when the strict pass can't fill the user's
    // ask — not whenever it fell short of the padded fetch pool, which would
    // re-run the whole pipeline on nearly every search.
    if (cards.length < limit) {
      const relaxedSearch = await searchCompatibleListingCards(context.supabase, {
        ...availabilityOption,
        allowPartialMustHaves: hasSoftFeatureRequest,
        allowUnmatchedPartialMustHaves: hasSoftFeatureRequest,
        includeSavedBudget,
        includeSavedMustHaves: false,
        includeSavedNeighborhoods: !explicitNamedPlaceProximity,
        limit: fetchLimit,
        mergeSavedNeighborhoods,
        requestContext,
        userId: context.userId,
      });
      for (const place of relaxedSearch.geocodeFailedPlaces) {
        geocodeFailedPlaces.add(place);
      }
      cards = mergeListingRecommendationCards(cards, relaxedSearch.cards, fetchLimit);
    }

    // Hard budget guard: the card pipeline treats budget as a scoring signal,
    // not a cap, so enforce the user's per-person budget here. Per-person keeps
    // splittable multi-beds (the group case) while dropping unaffordable solos.
    const applyBudgetCap = (
      input: ListingRecommendationCard[],
      budgetCap: number | null,
    ) => {
      if (budgetCap == null) {
        return input;
      }
      const ceiling = budgetCap * 1.05;
      return input.filter((card) => {
        const perPerson =
          card.effectivePerPersonRent ??
          card.perPersonRent ??
          card.effectiveRent ??
          card.monthlyRent;
        return perPerson == null || perPerson <= ceiling;
      });
    };
    let moreBeyondLimit = 0;
    let unknownAvailabilityCount = 0;
    let usedStretchBudget = false;
    const finishCards = async (
      input: ListingRecommendationCard[],
      budgetCap: number | null,
    ) => {
      const fresh =
        excludedListingIds.size > 0
          ? input.filter((card) => !excludedListingIds.has(card.id))
          : input;
      const availability = await filterCardsByAvailability(
        context.supabase,
        fresh,
        availableBy,
      );
      unknownAvailabilityCount = availability.unknownCount;
      const capped = applyBudgetCap(availability.cards, budgetCap);
      const sorted =
        sortMode === "rent_asc" ? sortListingCardsByRent(capped) : capped;
      moreBeyondLimit = Math.max(0, sorted.length - limit);
      return sorted.slice(0, limit);
    };
    const candidateCards = cards;
    cards = await finishCards(candidateCards, primaryBudgetCap);
    if (cards.length === 0 && stretchBudgetCap != null) {
      const stretchCards = await finishCards(candidateCards, stretchBudgetCap);
      if (stretchCards.length > 0) {
        cards = stretchCards;
        usedStretchBudget = true;
      }
    }

    // Carried-over-constraint guard: a must-have, transit target, or bedroom
    // floor pulled from the saved profile (not stated this turn) is applied as a
    // hard filter and can silently zero out an explicit area search — e.g. a
    // saved "near Caltrain" must-have wipes every Russian Hill listing even when
    // the person just asked to "show me what's available" there. When that
    // happens, broaden by reverting to only what they actually said this turn and
    // tell the agent what was widened so it can say so instead of claiming the
    // area is empty.
    const bodyCriteria = inferListingSearchCriteriaFromBody(context.body ?? "");
    const proximityKey = (constraint: ListingProximityConstraint) =>
      `${constraint.target.type}:${constraint.target.name.toLowerCase().trim()}`;
    const bodyProximityKeys = new Set(
      bodyCriteria.proximityConstraints.map(proximityKey),
    );
    const carriedMustHaves = desiredTerms.filter(
      (term) => !bodyCriteria.desiredTerms.includes(term),
    );
    const carriedTransitTargets = transitTargets.filter(
      (target) => !bodyCriteria.transitTargets.includes(target),
    );
    // Place/landmark proximity is the ACTIVE conversational intent (e.g. the
    // "near Saint Frank" the user named a turn ago, re-passed in args). It only
    // ranks, never filters, so we always keep it through a broaden so the
    // results stay ordered by closeness to the place. We only ever broaden past
    // SAVED-profile filters (must-haves, transit, bedroom floor).
    const keptProximityConstraints = proximityConstraints.filter(
      (constraint) =>
        constraint.target.type === "place" ||
        bodyProximityKeys.has(proximityKey(constraint)),
    );
    const carriedBedrooms =
      (bedroomsMin != null || bedroomsMax != null) &&
      bodyCriteria.bedroomsMin == null &&
      bodyCriteria.bedroomsMax == null &&
      !bodyCriteria.ignoreBedrooms;
    const requestedArea =
      neighborhoods.length > 0 ||
      proximityConstraints.some(
        (constraint) => constraint.target.type === "place",
      );
    const relaxedConstraintLabels: string[] = [];
    if (
      cards.length === 0 &&
      requestedArea &&
      (carriedMustHaves.length > 0 ||
        carriedTransitTargets.length > 0 ||
        carriedBedrooms)
    ) {
      // Revert to only what they said this turn plus the active place intent:
      // keep the named area, budget, and any "near <place>" ranking, but drop
      // the SAVED-profile filters (must-haves, transit, bedroom floor) that the
      // message didn't actually restate.
      const broadenedContext = {
        ...emptyListingRequestContext,
        avoidTerms: bodyCriteria.avoidTerms,
        bedroomsMax: bodyCriteria.ignoreBedrooms
          ? null
          : (bodyCriteria.bedroomsMax ?? null),
        bedroomsMin: bodyCriteria.ignoreBedrooms
          ? null
          : (bodyCriteria.bedroomsMin ?? null),
        budgetMax: hardBudgetCap ?? null,
        mustHaves: bodyCriteria.desiredTerms,
        neighborhoods,
        proximityConstraints: keptProximityConstraints,
        transitTargets: bodyCriteria.transitTargets,
      };
      const broadenedSearch = await searchCompatibleListingCards(context.supabase, {
        ...availabilityOption,
        allowPartialMustHaves: hasSoftFeatureRequest,
        allowUnmatchedPartialMustHaves: hasSoftFeatureRequest,
        includeSavedBudget,
        includeSavedMustHaves: false,
        includeSavedNeighborhoods: !explicitNamedPlaceProximity,
        limit: fetchLimit,
        mergeSavedNeighborhoods,
        requestContext: broadenedContext,
        userId: context.userId,
      });
      for (const place of broadenedSearch.geocodeFailedPlaces) {
        geocodeFailedPlaces.add(place);
      }
      const broadenedCards = await finishCards(
        broadenedSearch.cards,
        primaryBudgetCap,
      );
      if (broadenedCards.length > 0) {
        cards = broadenedCards;
        if (carriedMustHaves.length > 0) {
          relaxedConstraintLabels.push("your saved must-haves");
        }
        if (carriedTransitTargets.length > 0) {
          relaxedConstraintLabels.push("the saved transit filter");
        }
        if (carriedBedrooms) {
          relaxedConstraintLabels.push("the saved bedroom count");
        }
      }
    }
    // Closest-options safety net for named-place searches: if nothing fits the
    // per-person budget near the place, don't dead-end — surface the closest
    // listings to the place (over budget), nearest first, so the agent can lead
    // with "the closest to <place> is X, a bit over budget" instead of pivoting
    // to far-away saved areas or claiming nothing is nearby.
    let closestOverBudget = false;
    if (
      cards.length === 0 &&
      explicitNamedPlaceProximity &&
      primaryBudgetCap != null
    ) {
      const closestContext = {
        ...emptyListingRequestContext,
        budgetMax: null,
        neighborhoods,
        proximityConstraints: keptProximityConstraints,
      };
      const closestPool = (
        await searchCompatibleListingCards(context.supabase, {
          ...availabilityOption,
          allowPartialMustHaves: hasSoftFeatureRequest,
          allowUnmatchedPartialMustHaves: hasSoftFeatureRequest,
          includeSavedBudget: false,
          includeSavedMustHaves: false,
          includeSavedNeighborhoods: false,
          limit: fetchLimit,
          mergeSavedNeighborhoods,
          requestContext: closestContext,
          userId: context.userId,
        })
      ).cards.filter((card) => !excludedListingIds.has(card.id));
      const closestAvailability = await filterCardsByAvailability(
        context.supabase,
        closestPool,
        availableBy,
      );
      unknownAvailabilityCount = closestAvailability.unknownCount;
      // Already proximity-ranked; do NOT apply the budget cap.
      const closest = closestAvailability.cards.slice(0, limit);
      if (closest.length > 0) {
        cards = closest;
        closestOverBudget = true;
      }
    }

    const reportedNeighborhoods = await reportedListingSearchNeighborhoods(
      context.supabase,
      {
        mergeSavedNeighborhoods,
        neighborhoods,
        userId: context.userId,
      },
    );

    if (cards.length === 0) {
      return {
        data: {
          availableBy: availableBy ?? undefined,
          budgetIgnored: ignoreBudget,
          budgetHardMax: hardBudgetCap ?? undefined,
          budgetMax: primaryBudgetCap,
          budgetPreferredMax: rawPreferredBudgetCap ?? undefined,
          budgetStretchMax: stretchBudgetCap ?? undefined,
          excludedAlreadyShownCount:
            excludedListingIds.size > 0 ? excludedListingIds.size : undefined,
          listings: [],
          neighborhoods: reportedNeighborhoods,
          proximityConstraints,
          validationSignals:
            validationSignals.length > 0 ? validationSignals : undefined,
        },
        ok: false,
        summary: appendSummarySentences(
          formatGeocodeFailureGuidance({
            cardCount: 0,
            geocodeFailedPlaces: [...geocodeFailedPlaces],
          }) ??
            (excludedListingIds.size > 0
              ? `No new listings beyond the ${excludedListingIds.size} already shown match this search. Say they've seen everything that fits right now and offer to relax budget, beds, or area.`
              : availableBy != null
                ? `No active listings matched that are available by ${availableBy}. Suggest relaxing the move-in date, budget, beds, or area.`
                : primaryBudgetCap != null
                  ? `No active listings matched the $${primaryBudgetCap.toLocaleString()} per-person cap${stretchBudgetCap != null ? `, even after checking the $${stretchBudgetCap.toLocaleString()} stretch cap` : ""}. Suggest relaxing budget, beds, or area.`
                  : "No active listings matched that search. Suggest relaxing budget, beds, or area."),
          validationSignals,
        ),
        toolName: "search_listings",
      };
    }

    const requestedFeatureAssessments =
      inferListingFeatureRequestsFromTerms(desiredTerms);
    const featureAssessmentsByListingId =
      requestedFeatureAssessments.length > 0
        ? await loadListingFeatureAssessmentsForCards(context.supabase, {
            cards,
            requestedTerms: desiredTerms,
          })
        : new Map();
    if (featureAssessmentsByListingId.size > 0) {
      cards = sortCardsByFeatureAssessments(
        cards.map((card) => ({
          ...card,
          featureAssessments: featureAssessmentsByListingId.get(card.id),
        })),
        featureAssessmentsByListingId,
      );
    }

    let media: HousingAgentToolMedia[] = [];
    const recommendationIdByListingId = new Map<string, string>();
    const baseUrl = getKinfolkPublicMediaBaseUrl();
    if (baseUrl) {
      try {
        const persisted = await persistListingRecommendationCards(
          context.supabase,
          {
            cards,
            idempotencyScope: "agent_search",
            requestedByRunId: context.runId ?? "agent",
            threadId: context.threadId,
            userId: context.userId,
          },
        );
        for (const entry of persisted) {
          recommendationIdByListingId.set(entry.card.id, entry.id);
        }
        media = persisted.map((entry) => ({
          label: entry.card.address,
          url: buildListingCardUrl({ baseUrl, recommendationId: entry.id }),
        }));
      } catch (error) {
        console.error(
          "[search_listings] failed to persist listing cards",
          error,
        );
      }
    }

    const listings = cards.map((card) => ({
      address: card.address,
      bedrooms: card.bedrooms,
      featureAssessments: card.featureAssessments,
      fitEvidence: card.evidence.slice(0, 3),
      // The tappable Kinfolk link for this unit — share THIS if they want a
      // link, never the original listing site.
      kinfolkUrl: buildListingShortlinkUrl(baseUrl, card.id),
      neighborhood: card.neighborhood,
      perPersonRent: card.effectivePerPersonRent ?? card.perPersonRent,
      recommendationId: recommendationIdByListingId.get(card.id) ?? null,
      rent: card.effectiveRent ?? card.monthlyRent,
    }));

    const broadened = relaxedConstraintLabels.length > 0;
    const resultBudgetCap = usedStretchBudget ? stretchBudgetCap : primaryBudgetCap;
    const placeLabel = proximityTargetName ?? "the spot";
    const listingNoun = `listing${listings.length === 1 ? "" : "s"}`;
    let summary: string;
    if (closestOverBudget) {
      summary = `Nothing near ${placeLabel} fits the search budget, so these ${listings.length} ${listingNoun} are the CLOSEST to ${placeLabel}, nearest first — they run above budget. Lead with the closest one and its walk time, say it's a bit over budget, and offer to stretch the budget or try a nearby area. The listings include total rent and per-person rent; compare in the unit the user gave.`;
    } else if (broadened) {
      summary = `Nothing matched ${formatRelaxedConstraints(relaxedConstraintLabels)} there, so these ${listings.length} ${listingNoun} are what's currently available${explicitNamedPlaceProximity ? ` near ${placeLabel}, nearest first` : " in the area"} — tell them you widened the search past ${formatRelaxedConstraints(relaxedConstraintLabels)}.`;
    } else if (explicitNamedPlaceProximity) {
      summary = `Found ${listings.length} ${listingNoun} near ${placeLabel}, nearest first — lead with the closest and its walk time. The listings include total rent and per-person rent; compare in the unit the user gave.`;
    } else {
      summary = `Found ${listings.length} ${listingNoun} that fit. The listings include total rent and per-person rent; compare in the unit the user gave.`;
    }
    const summaryExtras: string[] = [];
    const geocodeGuidance = formatGeocodeFailureGuidance({
      cardCount: listings.length,
      geocodeFailedPlaces: [...geocodeFailedPlaces],
    });
    if (geocodeGuidance) {
      summaryExtras.push(geocodeGuidance);
    }
    if (excludedListingIds.size > 0) {
      summaryExtras.push(
        `These are new — the ${excludedListingIds.size} already texted in this thread were left out.`,
      );
    }
    if (availableBy != null) {
      summaryExtras.push(
        unknownAvailabilityCount > 0
          ? `Filtered to availability by ${availableBy}, but ${unknownAvailabilityCount} of these don't state an availability date — say so instead of promising the date.`
          : `All of these are listed as available by ${availableBy}.`,
      );
    }
    if (moreBeyondLimit > 0) {
      summaryExtras.push(
        `At least ${moreBeyondLimit} more match beyond these — offer to show more.`,
      );
    }
    if (usedStretchBudget && rawPreferredBudgetCap != null && stretchBudgetCap != null) {
      summaryExtras.push(
        `Nothing fit the $${rawPreferredBudgetCap.toLocaleString()}/person target, so these use the $${stretchBudgetCap.toLocaleString()}/person stretch cap. Say that plainly; do not call $${rawPreferredBudgetCap.toLocaleString()}-$${stretchBudgetCap.toLocaleString()} a saved range.`,
      );
    } else if (
      rawPreferredBudgetCap != null &&
      stretchBudgetCap != null &&
      primaryBudgetCap === rawPreferredBudgetCap
    ) {
      summaryExtras.push(
        `These are under the $${rawPreferredBudgetCap.toLocaleString()}/person target. Mention the user can still stretch to $${stretchBudgetCap.toLocaleString()} for a broader search; do not call $${rawPreferredBudgetCap.toLocaleString()}-$${stretchBudgetCap.toLocaleString()} a saved range.`,
      );
    }
    const featureGuidance = formatFeatureAssessmentGuidance(
      featureAssessmentsByListingId,
    );
    if (featureGuidance) {
      summaryExtras.push(featureGuidance);
    }
    return {
      data: {
        availableBy: availableBy ?? undefined,
        broadenedPast: broadened ? relaxedConstraintLabels : undefined,
        budgetIgnored: ignoreBudget,
        budgetHardMax: hardBudgetCap ?? undefined,
        budgetMax: resultBudgetCap,
        budgetPreferredMax: rawPreferredBudgetCap ?? undefined,
        budgetStretchMax: stretchBudgetCap ?? undefined,
        budgetUsedStretch: usedStretchBudget || undefined,
        closestToPlaceOverBudget: closestOverBudget || undefined,
        excludedAlreadyShownCount:
          excludedListingIds.size > 0 ? excludedListingIds.size : undefined,
        listings,
        moreListingsAvailable: moreBeyondLimit > 0 ? true : undefined,
        neighborhoods: reportedNeighborhoods,
        proximityConstraints,
        proximityTarget: proximityTargetName ?? undefined,
        unknownAvailabilityCount:
          availableBy != null && unknownAvailabilityCount > 0
            ? unknownAvailabilityCount
            : undefined,
        validationSignals:
          validationSignals.length > 0 ? validationSignals : undefined,
        requestedFeatureAssessments:
          requestedFeatureAssessments.length > 0
            ? requestedFeatureAssessments
            : undefined,
      },
      media,
      ok: true,
      summary: appendSummarySentences(summary, [
        ...summaryExtras,
        ...validationSignals,
      ]),
      toolName: "search_listings",
    };
  },
};

export type InferredListingSearchCriteria = {
  availableBy: string | null;
  avoidTerms: string[];
  bedroomsMax: number | null;
  bedroomsMin: number | null;
  budgetMax: number | null;
  budgetPreferredMax: number | null;
  currentRent: number | null;
  desiredTerms: string[];
  ignoreBedrooms: boolean;
  ignoreBudget: boolean;
  mergeSavedNeighborhoods: boolean;
  neighborhoods: string[];
  proximityConstraints: ListingProximityConstraint[];
  requestedLimit: number | null;
  showMore: boolean;
  sortMode: ListingSearchSortMode | null;
  transitTargets: string[];
};

export type ListingSearchCriteria = InferredListingSearchCriteria & {
  availableBy: string | null;
  excludeAlreadyShown: boolean;
  excludeIds: string[];
  householdSize: number | null;
  limit: number;
  validationSignals: string[];
};

type ListingSearchSortMode = "rent_asc";

export function readListingSearchCriteriaFromArgs(
  body: string,
  args: Record<string, unknown>,
): ListingSearchCriteria {
  const inferred = inferListingSearchCriteriaFromBody(body);
  const proximityConstraints = dedupeProximityConstraints([
    ...readProximityConstraints(args.proximityConstraints),
    ...inferred.proximityConstraints,
  ]);
  const avoidTransitTargets = new Set(
    proximityConstraints.flatMap((constraint) =>
      constraint.polarity === "avoid" && constraint.target.type === "transit"
        ? [normalizeSearchText(constraint.target.name)]
        : [],
    ),
  );
  const explicitNamedPlaceProximity = proximityConstraints.some(
    (constraint) => constraint.target.type === "place",
  );
  const argsTransitTargets =
    explicitNamedPlaceProximity && inferred.transitTargets.length === 0
      ? []
      : readStringArray(args.transitTargets);
  // The model's semantic args usually carry the conversation context, while the
  // deterministic body parse protects literal budget/current-rent phrasing and
  // clamps obvious result-count requests ("recommend me one").
  const argsBedroomsMax = readNumber(args.bedroomsMax);
  const argsBedroomsMin = readNumber(args.bedroomsMin);
  const argsBudgetMax = readNumber(args.budgetMax);
  const argsBudgetPreferredMax = readNumber(args.budgetPreferredMax);
  const argsLimit = readPositiveLimit(args.limit, inferred.requestedLimit ?? 5, 5);
  const argsNeighborhoods = readStringArray(args.neighborhoods);
  const resolvedBudgetCaps = resolveListingBudgetCaps(inferred, {
    budgetMax: argsBudgetMax,
    budgetPreferredMax: argsBudgetPreferredMax,
  });
  return {
    availableBy: readAvailableByDate(args.availableBy) ?? inferred.availableBy,
    avoidTerms: dedupeStrings([
      ...readStringArray(args.avoidTerms),
      ...inferred.avoidTerms,
    ]),
    bedroomsMax: inferred.ignoreBedrooms
      ? null
      : (argsBedroomsMax ?? inferred.bedroomsMax),
    bedroomsMin: inferred.ignoreBedrooms
      ? null
      : (argsBedroomsMin ?? inferred.bedroomsMin),
    budgetMax: inferred.ignoreBudget
      ? null
      : resolvedBudgetCaps.budgetMax,
    budgetPreferredMax: inferred.ignoreBudget
      ? null
      : resolvedBudgetCaps.budgetPreferredMax,
    currentRent: inferred.currentRent,
    desiredTerms: dedupeStrings([
      ...readStringArray(args.desiredTerms),
      ...inferred.desiredTerms,
    ]),
    excludeAlreadyShown: args.excludeAlreadyShown === true || inferred.showMore,
    excludeIds: readStringArray(args.excludeIds),
    householdSize: readHouseholdSizeArg(args.householdSize),
    ignoreBedrooms: inferred.ignoreBedrooms,
    ignoreBudget: inferred.ignoreBudget,
    limit:
      inferred.requestedLimit == null
        ? argsLimit
        : Math.min(argsLimit, inferred.requestedLimit),
    mergeSavedNeighborhoods: inferred.mergeSavedNeighborhoods,
    neighborhoods:
      argsNeighborhoods.length > 0 ? argsNeighborhoods : inferred.neighborhoods,
    proximityConstraints,
    requestedLimit: inferred.requestedLimit,
    showMore: inferred.showMore,
    sortMode: inferred.sortMode,
    transitTargets: dedupeStrings([
      ...argsTransitTargets,
      ...inferred.transitTargets,
    ]).filter((target) => !avoidTransitTargets.has(normalizeSearchText(target))),
    validationSignals: buildValidationSignals(inferred, {
      bedroomsMax: argsBedroomsMax,
      bedroomsMin: argsBedroomsMin,
      budgetMax: argsBudgetMax,
      budgetPreferredMax: argsBudgetPreferredMax,
      neighborhoods: argsNeighborhoods,
    }),
  };
}

function resolveListingBudgetCaps(
  inferred: InferredListingSearchCriteria,
  args: { budgetMax: number | null; budgetPreferredMax: number | null },
) {
  if (inferred.budgetPreferredMax != null && inferred.budgetMax != null) {
    return {
      budgetMax: inferred.budgetMax,
      budgetPreferredMax: inferred.budgetPreferredMax,
    };
  }

  return {
    budgetMax: args.budgetMax ?? inferred.budgetMax,
    budgetPreferredMax: args.budgetPreferredMax ?? inferred.budgetPreferredMax,
  };
}

export function inferListingSearchCriteriaFromBody(
  body: string,
): InferredListingSearchCriteria {
  const normalized = body.toLowerCase();
  const ignoreBedrooms = inferBedroomRelaxationFromBody(normalized);
  const bedroomCriteria = ignoreBedrooms
    ? { bedroomsMax: null, bedroomsMin: null }
    : inferBedroomsFromBody(normalized);
  const budgetSignals = inferBudgetSignalsFromBody(normalized);
  const budgetMax = budgetSignals.budgetMax;
  const ignoreBudget =
    inferBudgetCapRemovalFromBody(normalized) ||
    (budgetMax == null && inferBudgetFlexibilityFromBody(normalized));
  const neighborhoods = inferNeighborhoodsFromBody(normalized);
  const proximityConstraints = inferProximityConstraintsFromBody({
    body,
    neighborhoods,
    normalized,
  });
  return {
    availableBy: inferAvailableByFromBody(normalized),
    avoidTerms: [],
    bedroomsMax: bedroomCriteria.bedroomsMax,
    bedroomsMin: bedroomCriteria.bedroomsMin,
    budgetMax: ignoreBudget ? null : budgetMax,
    budgetPreferredMax: ignoreBudget ? null : budgetSignals.budgetPreferredMax,
    currentRent: budgetSignals.currentRent,
    desiredTerms: inferDesiredTermsFromBody(normalized),
    ignoreBedrooms,
    ignoreBudget,
    mergeSavedNeighborhoods: inferAdditiveNeighborhoodUpdateFromBody(normalized),
    neighborhoods,
    proximityConstraints,
    requestedLimit: inferRequestedListingLimitFromBody(normalized),
    showMore: inferShowMoreFromBody(normalized),
    sortMode: inferSortModeFromBody(normalized),
    transitTargets: inferTransitTargetsFromBody(normalized, proximityConstraints),
  };
}

function inferRequestedListingLimitFromBody(body: string) {
  const countMatch = body.match(
    /\b(?:recommend|pick|choose|show|send|pull\s+up|give|find)\s+(?:me\s+)?(?:just\s+)?(?:the\s+)?(one|two|three|four|five|[1-5])(?:\s+(?:options?|listings?|places?|apartments?|spots?|units?))?\b(?!\s*(?:br|bd|beds?|bedrooms?|roommates?))/u,
  );
  if (countMatch) {
    return listingCountWordToNumber(countMatch[1]);
  }

  if (
    /\b(?:best|top|favorite|favourite|strongest)\s+(?:one|option|listing|place|apartment|spot|unit)\b/u.test(
      body,
    ) ||
    /\b(?:one|1)\s+(?:best|strongest|favorite|favourite)\b/u.test(body)
  ) {
    return 1;
  }

  return null;
}

function listingCountWordToNumber(value: string) {
  const listingCounts: Record<string, number> = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    five: 5,
    four: 4,
    one: 1,
    three: 3,
    two: 2,
  };
  return listingCounts[value] ?? null;
}

function formatRelaxedConstraints(labels: string[]) {
  if (labels.length <= 1) {
    return labels[0] ?? "those filters";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function appendSummarySentences(summary: string, sentences: string[]) {
  return [summary, ...sentences].join(" ").trim();
}

function buildValidationSignals(
  inferred: InferredListingSearchCriteria,
  args: {
    bedroomsMax: number | null;
    bedroomsMin: number | null;
    budgetMax: number | null;
    budgetPreferredMax: number | null;
    neighborhoods: string[];
  },
) {
  const signals: string[] = [];
  if (inferred.currentRent != null) {
    signals.push(
      `They mentioned paying $${inferred.currentRent.toLocaleString()} now — that's their current rent, not a budget cap, so don't quote it as their budget.`,
    );
  }
  if (inferred.budgetPreferredMax != null && inferred.budgetMax != null) {
    signals.push(
      `They said target $${inferred.budgetPreferredMax.toLocaleString()} and stretch to $${inferred.budgetMax.toLocaleString()} for the right fit — treat the lower number as the target cap, not a budget floor or range minimum.`,
    );
  }
  if (
    args.budgetMax != null &&
    inferred.budgetMax != null &&
    args.budgetMax !== inferred.budgetMax
  ) {
    signals.push(
      `Their message mentions $${inferred.budgetMax.toLocaleString()} but the search used your $${args.budgetMax.toLocaleString()} cap — sanity-check out loud if that looks off.`,
    );
  }
  if (
    (args.bedroomsMin != null || args.bedroomsMax != null) &&
    (inferred.bedroomsMin != null || inferred.bedroomsMax != null) &&
    (args.bedroomsMin !== inferred.bedroomsMin ||
      args.bedroomsMax !== inferred.bedroomsMax)
  ) {
    signals.push(
      "Their message reads like a different bedroom count than the search used — double-check the bedroom count with them if the results look off.",
    );
  }
  if (
    args.neighborhoods.length > 0 &&
    inferred.neighborhoods.length > 0 &&
    !sameNormalizedStringSet(args.neighborhoods, inferred.neighborhoods)
  ) {
    signals.push(
      `Their message names ${inferred.neighborhoods.join(", ")} but the search used ${args.neighborhoods.join(", ")} — double-check the area if that looks off.`,
    );
  }
  return signals;
}

function sameNormalizedStringSet(left: string[], right: string[]) {
  const normalize = (values: string[]) =>
    new Set(values.map((value) => normalizeSearchText(value)));
  const leftSet = normalize(left);
  const rightSet = normalize(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function readAvailableByDate(value: unknown) {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const isoDate = raw.match(/\d{4}-\d{2}-\d{2}/u)?.[0];
  if (isoDate && Number.isFinite(Date.parse(isoDate))) {
    return isoDate;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : null;
}

function inferAvailableByFromBody(body: string) {
  const match = body.match(
    /\b(?:available|move(?:\s*in)?|need(?:ed)?|lease|start)\s+(?:by|before|on|around|from|starting)?\s*(\d{4}-\d{2}-\d{2})\b/u,
  );
  return readAvailableByDate(match?.[1] ?? null);
}

async function resolveExcludedListingIds(
  supabase: SupabaseServiceClient,
  {
    excludeAlreadyShown,
    excludeIds,
    threadId,
    userId,
  }: {
    excludeAlreadyShown: boolean;
    excludeIds: string[];
    threadId: string;
    userId: string;
  },
) {
  const excluded = new Set<string>();
  if (!excludeAlreadyShown && excludeIds.length === 0) {
    return excluded;
  }

  const recent = await supabase
    .from("text_listing_recommendations")
    .select("id,listing_id,outbound_message_id")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (recent.error) {
    throw recent.error;
  }

  const rows = recent.data ?? [];
  if (excludeAlreadyShown) {
    for (const row of rows) {
      if (row.outbound_message_id) {
        excluded.add(row.listing_id);
      }
    }
  }
  const listingIdByRecommendationId = new Map(
    rows.map((row) => [row.id, row.listing_id]),
  );
  // Recommendation ids older than the 30-row window still need resolving —
  // adding the raw UUID would never match a card's listing id, and the
  // rejected listing would silently resurface.
  const unresolvedIds = excludeIds.filter(
    (id) => !listingIdByRecommendationId.has(id),
  );
  if (unresolvedIds.length > 0) {
    const older = await supabase
      .from("text_listing_recommendations")
      .select("id,listing_id")
      .eq("user_id", userId)
      .in("id", unresolvedIds);
    if (!older.error) {
      for (const row of older.data ?? []) {
        listingIdByRecommendationId.set(row.id, row.listing_id);
      }
    }
  }
  for (const id of excludeIds) {
    // The raw fallback stays: callers may pass actual listing ids.
    excluded.add(listingIdByRecommendationId.get(id) ?? id);
  }
  return excluded;
}

async function filterCardsByAvailability(
  supabase: SupabaseServiceClient,
  cards: ListingRecommendationCard[],
  availableBy: string | null,
): Promise<{ cards: ListingRecommendationCard[]; unknownCount: number }> {
  if (availableBy == null || cards.length === 0) {
    return { cards, unknownCount: 0 };
  }
  const cutoff = Date.parse(`${availableBy.slice(0, 10)}T23:59:59Z`);
  if (!Number.isFinite(cutoff)) {
    return { cards, unknownCount: 0 };
  }

  const rows = await supabase
    .from("apartment_listings")
    .select("id,available_at")
    .in(
      "id",
      cards.map((card) => card.id),
    );
  if (rows.error) {
    throw rows.error;
  }
  const availableAtByListingId = new Map(
    (rows.data ?? []).map((row) => [row.id, row.available_at]),
  );

  let unknownCount = 0;
  const kept = cards.filter((card) => {
    const availableAt = availableAtByListingId.get(card.id) ?? null;
    const parsed = availableAt == null ? Number.NaN : Date.parse(availableAt);
    if (!Number.isFinite(parsed)) {
      // No stated availability date — usually "available now". Keep it, but the
      // summary tells the agent to say the date isn't stated rather than promise it.
      unknownCount += 1;
      return true;
    }
    return parsed <= cutoff;
  });
  return { cards: kept, unknownCount };
}

function sortListingCardsByRent(cards: ListingRecommendationCard[]) {
  return [...cards].sort((left, right) => {
    const leftRent = listingCardComparableRent(left);
    const rightRent = listingCardComparableRent(right);
    if (leftRent !== rightRent) {
      return leftRent - rightRent;
    }

    return right.fitScore - left.fitScore;
  });
}

function listingCardComparableRent(card: ListingRecommendationCard) {
  return (
    card.effectivePerPersonRent ??
    card.perPersonRent ??
    card.effectiveRent ??
    card.monthlyRent ??
    Number.POSITIVE_INFINITY
  );
}

async function reportedListingSearchNeighborhoods(
  supabase: SupabaseServiceClient,
  {
    mergeSavedNeighborhoods,
    neighborhoods,
    userId,
  }: {
    mergeSavedNeighborhoods: boolean;
    neighborhoods: string[];
    userId: string;
  },
) {
  if (!mergeSavedNeighborhoods || neighborhoods.length === 0) {
    return neighborhoods;
  }

  const saved = await supabase
    .from("housing_preferences")
    .select("neighborhoods")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (saved.error) {
    throw saved.error;
  }

  return dedupeStrings([...(saved.data?.neighborhoods ?? []), ...neighborhoods]);
}

async function loadSavedBudgetCaps(
  supabase: SupabaseServiceClient,
  userId: string,
  {
    needsHardMax,
    needsPreferredMax,
  }: {
    needsHardMax: boolean;
    needsPreferredMax: boolean;
  },
) {
  const [hardResult, preferredResult] = await Promise.all([
    needsHardMax
      ? supabase
          .from("matching_profiles")
          .select("budget_max")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    needsPreferredMax
      ? supabase
          .from("profile_facts")
          .select("value_json")
          .eq("user_id", userId)
          .eq("fact_key", "budget_preferred_max")
          .eq("matching_eligible", true)
          .eq("sensitivity_level", "standard")
          .in("user_review_state", ["approved", "edited"])
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (hardResult.error) {
    throw hardResult.error;
  }
  if (preferredResult.error) {
    throw preferredResult.error;
  }

  return {
    hardMax: readPositiveBudgetNumber(hardResult.data?.budget_max),
    preferredMax: readPositiveBudgetNumber(preferredResult.data?.value_json),
  };
}

function readPositiveBudgetNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/gu, "");
    const match = cleaned.match(/^(\d+(?:\.\d+)?)(k)?$/iu);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(match[2] ? parsed * 1000 : parsed);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (
      readPositiveBudgetNumber(record.value) ??
      readPositiveBudgetNumber(record.max) ??
      readPositiveBudgetNumber(record.cap)
    );
  }

  return null;
}

function inferBedroomsFromBody(body: string) {
  if (/\b(studios?|efficiency)\b/u.test(body)) {
    return { bedroomsMax: 0, bedroomsMin: 0 };
  }

  const atLeast = body.match(
    /\b(?:at\s+least|min(?:imum)?(?:\s+of)?|(\d+)\+)\s*(\d+)?\s*(?:br|bed(?:room)?s?)\b/u,
  );
  if (atLeast) {
    const raw = atLeast[1] ?? atLeast[2];
    const bedrooms = raw ? Number(raw) : null;
    if (bedrooms != null && Number.isFinite(bedrooms)) {
      return { bedroomsMax: null, bedroomsMin: bedrooms };
    }
  }

  const exact = body.match(/\b(\d+)\s*(?:br|bed(?:room)?s?)\b/u);
  if (exact) {
    const bedrooms = Number(exact[1]);
    if (Number.isFinite(bedrooms)) {
      return { bedroomsMax: bedrooms, bedroomsMin: bedrooms };
    }
  }

  const wordExact = body.match(
    /\b(one|two|three|four|five)\s*[-\s]?(?:br|bed(?:room)?s?)\b/u,
  );
  if (wordExact) {
    const bedrooms = bedroomWordToNumber(wordExact[1]);
    if (bedrooms != null) {
      return { bedroomsMax: bedrooms, bedroomsMin: bedrooms };
    }
  }

  return { bedroomsMax: null, bedroomsMin: null };
}

function bedroomWordToNumber(value: string) {
  const bedroomNumbers: Record<string, number> = {
    five: 5,
    four: 4,
    one: 1,
    three: 3,
    two: 2,
  };
  return bedroomNumbers[value] ?? null;
}

function inferBudgetSignalsFromBody(body: string) {
  let budgetMax: number | null = null;
  let budgetPreferredMax: number | null = null;
  let currentRent: number | null = null;
  const mentions: Array<{
    amount: number;
    end: number;
    prefix: string;
    start: number;
    suffix: string;
  }> = [];
  for (const match of body.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gu)) {
    const value = Number(match[1].replace(/,/gu, ""));
    if (!Number.isFinite(value)) {
      continue;
    }
    const amount = match[2] ? Math.round(value * 1000) : Math.round(value);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const prefix = body.slice(Math.max(0, start - 32), start);
    const suffix = body.slice(end, end + 40);
    // "I pay $3,800 now, find cheaper" mentions their CURRENT rent, not a cap —
    // reading it as a budget makes the search ceiling exactly what they want to
    // escape. Keep it out of budgetMax and report it separately.
    if (
      !isBudgetCapContext(prefix) &&
      isCurrentRentContext(prefix, suffix)
    ) {
      currentRent = currentRent ?? amount;
      continue;
    }
    mentions.push({ amount, end, prefix, start, suffix });
  }

  for (let index = 0; index < mentions.length - 1; index += 1) {
    const first = mentions[index];
    const second = mentions[index + 1];
    const between = body.slice(first.end, second.start);
    if (isPreferredToStretchBudgetPair(first, second, between)) {
      budgetPreferredMax = first.amount;
      budgetMax = second.amount;
      break;
    }
  }

  if (budgetMax == null) {
    for (const mention of mentions) {
      if (isStretchBudgetContext(mention.prefix, mention.suffix)) {
        budgetMax = mention.amount;
        continue;
      }
      budgetMax = budgetMax ?? mention.amount;
    }
  }

  return { budgetMax, budgetPreferredMax, currentRent };
}

function isPreferredToStretchBudgetPair(
  first: { amount: number; prefix: string; suffix: string },
  second: { amount: number; prefix: string; suffix: string },
  between: string,
) {
  if (first.amount >= second.amount) {
    return false;
  }

  return (
    isPreferredBudgetContext(first.prefix, first.suffix) &&
    (isStretchBudgetContext(`${between} ${second.prefix}`, second.suffix) ||
      /\b(?:right|great|perfect)\s+fit\b/u.test(between))
  );
}

function isPreferredBudgetContext(prefix: string, suffix: string) {
  const context = `${prefix} ${suffix}`;
  return (
    /\b(?:around|about|target|ideal|ideally|prefer(?:red)?|trying\s+to\s+(?:stay|spend)|want\s+to\s+(?:stay|spend)|keep(?:\s+it)?|under|below|less\s+than)\s*$/u.test(
      prefix,
    ) ||
    /\b(?:target|ideal|preferred)\s+(?:budget|rent|price|cap)\b/u.test(
      context,
    ) ||
    /\b(?:under|below|less\s+than|around|about)\b/u.test(prefix)
  );
}

function isStretchBudgetContext(prefix: string, suffix: string) {
  const context = `${prefix} ${suffix}`;
  return /\b(?:stretch|flex|pay\s+up\s+to|go\s+up\s+to|could\s+go|can\s+go|willing\s+to|right\s+fit|great\s+fit|perfect\s+fit)\b/u.test(
    context,
  );
}

function isBudgetCapContext(prefix: string) {
  return /\b(?:under|below|max(?:imum)?|up\s+to|less\s+than|budget(?:\s+is)?(?:\s+about|\s+around)?|cap(?:ped)?\s+(?:at|is)|spend)\s*$/u.test(
    prefix,
  );
}

function isCurrentRentContext(prefix: string, suffix: string) {
  return (
    /\b(?:pay(?:ing)?|rent(?:'s|’s)?(?:\s+is|\s+runs)?|current(?:ly)?(?:\s+(?:pay(?:ing)?|at))?)\s*(?:about|around|roughly|like)?\s*$/u.test(
      prefix,
    ) ||
    /^\s*(?:\/\s*mo(?:nth)?|a\s+month|per\s+month)?\s*(?:right\s+)?now\b/u.test(
      suffix,
    )
  );
}

function inferShowMoreFromBody(body: string) {
  return (
    /\b(?:show|send|give|text|find|see|got|get)\s+(?:me\s+|us\s+)?(?:some\s+|a\s+few\s+)?more\b/u.test(
      body,
    ) ||
    /\bmore\s+(?:options|listings|places|apartments|spots|units|ones)\b/u.test(
      body,
    ) ||
    /\b(?:what|anything|anyone|any)\s+else\b/u.test(body) ||
    /\bother\s+(?:options|listings|places|apartments|spots|ones)\b/u.test(
      body,
    ) ||
    /\bany\s+others\b/u.test(body) ||
    /\bnext\s+(?:batch|set|round|few)\b/u.test(body)
  );
}

function inferBudgetCapRemovalFromBody(body: string) {
  return (
    /\b(?:ignore|skip|drop|remove|disregard|forget)\s+(?:the\s+)?(?:budget|price|rent|cap|limit|constraint)s?\b/u.test(
      body,
    ) ||
    /\b(?:budget|price|rent)\s+(?:doesn[’']?t|does not)\s+matter\b/u.test(
      body,
    ) ||
    /\b(?:any|no)\s+(?:budget|price|rent)\s+(?:cap|limit|constraint)s?\b/u.test(
      body,
    ) ||
    /\b(?:any|no)\s+(?:budget|price|rent)\b/u.test(body) ||
    /\bregardless\s+of\s+(?:budget|price|rent)\b/u.test(body)
  );
}

function inferBudgetFlexibilityFromBody(body: string) {
  return (
    /\b(?:willing|open|okay|ok)\s+to\s+(?:increase|raise|stretch|expand)\s+(?:my\s+)?(?:budget|price|rent)\b/u.test(
      body,
    ) ||
    /\b(?:increase|raise|stretch|expand|relax|loosen)\s+(?:the\s+)?(?:budget|price|rent|cap|limit|constraints?|filters?)\b/u.test(
      body,
    )
  );
}

function inferBedroomRelaxationFromBody(body: string) {
  return (
    /\b(?:all|any)\s+(?:unit\s+types?|types?|sizes?|bed(?:room)?s?)\b/u.test(
      body,
    ) ||
    /\b(?:unit\s+types?|bed(?:room)?s?)\s+(?:do(?:es)?n[’']?t|do(?:es)? not)\s+matter\b/u.test(
      body,
    ) ||
    /\b(?:don[’']?t|do\s+not)\s+need\s+(?:a\s+)?(?:\d+|one|two|three|four|five)\s*(?:bd|br|bed(?:room)?s?)\b/u.test(
      body,
    ) ||
    /\b(?:ignore|skip|drop|remove|disregard|forget)\s+(?:the\s+)?(?:bed(?:room)?s?|unit\s+types?|size)s?\b/u.test(
      body,
    ) ||
    /\b(?:relax|loosen|broaden)\s+(?:the\s+)?(?:constraints?|filters?)\b/u.test(
      body,
    )
  );
}

function inferSortModeFromBody(body: string): ListingSearchSortMode | null {
  if (
    /\b(?:cheapest|least\s+expensive|lowest[-\s]?(?:rent|price|priced)?)\b/u.test(
      body,
    )
  ) {
    return "rent_asc";
  }

  return null;
}

function inferDesiredTermsFromBody(body: string) {
  const terms: string[] = [];
  const candidates = [
    [/in[-\s]?unit laundry/u, "in-unit laundry"],
    [/\bdishwasher\b/u, "dishwasher"],
    [/\bdoorman\b/u, "doorman"],
    [/\bhigh[-\s]?rise\b/u, "high-rise"],
    [/\bluxury\b/u, "luxury"],
    [
      /\b(?:office|home\s+office|den|study|desk|workspace|work\s*space|wfh|work[-\s]?from[-\s]?home)\b|\broom\s+for\s+(?:an?\s+)?(?:office|desk|work\s*space)\b/u,
      "work-from-home friendly",
    ],
  ] as const;

  for (const [pattern, term] of candidates) {
    if (pattern.test(body)) {
      terms.push(term);
    }
  }

  return dedupeStrings(terms);
}

function inferTransitTargetsFromBody(
  body: string,
  proximityConstraints: ListingProximityConstraint[] = [],
) {
  const targets: string[] = [];
  const avoidTransitTargets = new Set(
    proximityConstraints.flatMap((constraint) =>
      constraint.polarity === "avoid" && constraint.target.type === "transit"
        ? [normalizeSearchText(constraint.target.name)]
        : [],
    ),
  );
  const candidates = [
    [/\bcaltrain\b/u, "Caltrain"],
    [/\bbart\b/u, "BART"],
    [/\bmuni\b/u, "Muni"],
  ] as const;

  for (const [pattern, target] of candidates) {
    if (pattern.test(body) && !avoidTransitTargets.has(normalizeSearchText(target))) {
      targets.push(target);
    }
  }

  return dedupeStrings(targets);
}

function inferProximityConstraintsFromBody({
  body,
  neighborhoods,
  normalized,
}: {
  body: string;
  neighborhoods: string[];
  normalized: string;
}) {
  return dedupeProximityConstraints([
    ...inferTransitProximityConstraintsFromBody(normalized),
    ...inferNamedPlaceProximityConstraintsFromBody(body, neighborhoods),
  ]);
}

function inferTransitProximityConstraintsFromBody(body: string) {
  const constraints: ListingProximityConstraint[] = [];
  const candidates = [
    [/\bcaltrain\b/u, "Caltrain"],
    [/\bbart\b/u, "BART"],
    [/\bmuni\b/u, "Muni"],
  ] as const;

  for (const [pattern, target] of candidates) {
    if (!pattern.test(body)) continue;
    if (!isAvoidedProximityTarget(body, pattern)) continue;
    constraints.push({
      hardness: "dealbreaker",
      kind: "proximity",
      polarity: "avoid",
      target: { name: target, type: "transit" },
      threshold: { label: "near", maxMiles: 0.6 },
    });
  }

  return constraints;
}

// Cap the body before running the proximity-inference regexes. The lazy
// captures below backtrack ~O(n^2) on adversarial input (e.g. "near "×k +
// a neighborhood word), and inbound SMS/iMessage bodies are stored uncapped, so
// a large message could block the event loop. 2000 chars matches the LLM-facing
// slice and is far longer than any real "near X in Y" phrasing.
const PROXIMITY_INFERENCE_BODY_LIMIT = 2000;

function inferNamedPlaceProximityConstraintsFromBody(
  body: string,
  neighborhoods: string[],
) {
  const constraints: ListingProximityConstraint[] = [];
  const query = body
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROXIMITY_INFERENCE_BODY_LIMIT);
  if (!query) return constraints;

  for (const neighborhood of neighborhoods) {
    const pattern = new RegExp(
      `\\b(?:near|close to|by|walk(?:ing)? distance to|walkable to)\\s+([^.!?\\n]{1,80}?)\\s+in\\s+${escapeRegExp(neighborhood).replace(/\\s+/g, "\\\\s+")}\\b`,
      "iu",
    );
    const match = query.match(pattern);
    const placeName = cleanNamedPlaceCandidate(match?.[1] ?? "");
    if (!placeName) continue;
    constraints.push({
      hardness: "preference",
      kind: "proximity",
      polarity: "prefer",
      target: { area: neighborhood, name: placeName, type: "place" },
      threshold: { label: "near", maxMiles: 0.6 },
    });
    return constraints;
  }

  const match = query.match(
    /\b(?:near|close to|by|walk(?:ing)? distance to|walkable to)\s+([^.!?]+?)(?:[.!?]\s*)?$/iu,
  );
  const placeName = cleanNamedPlaceCandidate(match?.[1] ?? "");
  if (placeName) {
    constraints.push({
      hardness: "preference",
      kind: "proximity",
      polarity: "prefer",
      target: {
        area: neighborhoods[0] ?? null,
        name: placeName,
        type: "place",
      },
      threshold: { label: "near", maxMiles: 0.6 },
    });
  }

  return constraints;
}

function isAvoidedProximityTarget(body: string, targetPattern: RegExp) {
  const targetSource = targetPattern.source;
  return (
    new RegExp(
      `\\b(?:not|no|avoid|without|away\\s+from|far\\s+from|farther\\s+from)\\b[\\s\\S]{0,42}${targetSource}`,
      "u",
    ).test(body) ||
    new RegExp(
      `\\b(?:not\\s+near|not\\s+close\\s+to|not\\s+by)\\b[\\s\\S]{0,42}${targetSource}`,
      "u",
    ).test(body) ||
    new RegExp(`${targetSource}[\\s\\S]{0,42}\\b(?:not\\s+near|far\\s+away)\\b`, "u").test(
      body,
    )
  );
}

function cleanNamedPlaceCandidate(value: string) {
  const cleaned = value
    .replace(/\b(?:apartments?|apts?|listings?|places?|rentals?|units?|homes?)\b/giu, "")
    .replace(/\b(?:that|which)\s+(?:are|is)\b[\s\S]*$/iu, "")
    .replace(/^the\s+/iu, "")
    .trim()
    .replace(/[,"'“”]+$/gu, "")
    .trim();
  if (!cleaned) return null;

  const normalized = normalizeSearchText(cleaned);
  if (
    /^(?:caltrain|bart|muni|transit|train|bus|station)$/u.test(normalized) ||
    /^(?:coffee shops?|cafes?|restaurants?|dining|parks?|bars?|nightlife)$/u.test(
      normalized,
    )
  ) {
    return null;
  }

  return cleaned;
}

function readProximityConstraints(value: unknown): ListingProximityConstraint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = readRecord(entry);
    if (!record) return [];

    const nestedTarget = readRecord(record.target);
    const targetType =
      readString(record.targetType) ?? readString(nestedTarget?.type);
    const targetName =
      readString(record.targetName) ?? readString(nestedTarget?.name);
    if (
      targetName == null ||
      (targetType !== "place" && targetType !== "transit")
    ) {
      return [];
    }

    const polarity: ListingProximityConstraint["polarity"] =
      readString(record.polarity) === "avoid" ? "avoid" : "prefer";
    const hardness: ListingProximityConstraint["hardness"] =
      readString(record.hardness) === "dealbreaker"
        ? "dealbreaker"
        : "preference";
    const threshold = readRecord(record.threshold);
    const maxMiles =
      readNumber(record.maxMiles) ?? readNumber(threshold?.maxMiles) ?? 0.6;
    const area = readString(record.area) ?? readString(nestedTarget?.area);

    const constraint: ListingProximityConstraint = {
      hardness,
      kind: "proximity",
      polarity,
      target:
        targetType === "place"
          ? { area, name: targetName, type: "place" }
          : { name: targetName, type: "transit" },
      threshold: {
        label: readString(threshold?.label) ?? "near",
        maxMiles,
      },
    };

    return [constraint];
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dedupeProximityConstraints(values: ListingProximityConstraint[]) {
  const seen = new Set<string>();
  const deduped: ListingProximityConstraint[] = [];

  for (const value of values) {
    const targetName = value.target.name.trim();
    if (!targetName) continue;
    const area =
      value.target.type === "place"
        ? normalizeSearchText(value.target.area ?? "")
        : "";
    const key = [
      value.polarity,
      value.hardness,
      value.target.type,
      normalizeSearchText(targetName),
      area,
      value.threshold.maxMiles,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...value,
      target: { ...value.target, name: targetName },
    });
  }

  return deduped;
}

// Group sizes come from conversation ("me and a friend") — keep them sane.
function readHouseholdSizeArg(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed == null || parsed < 1) {
    return null;
  }
  return Math.min(Math.round(parsed), 12);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function inferAdditiveNeighborhoodUpdateFromBody(body: string) {
  return (
    /\b(?:add|append|include|save)\b[\s\S]{0,120}\b(?:to|in|for)\s+(?:my\s+)?(?:neighborhoods?|areas?|locations?|search)\b/u.test(
      body,
    ) ||
    /\b(?:add|append|include|save)\s+(?:to|in|for)\s+(?:my\s+)?(?:neighborhoods?|areas?|locations?|search)\b/u.test(
      body,
    )
  );
}

function inferNeighborhoodsFromBody(body: string) {
  const neighborhoods: string[] = [];
  const lowerPacificHeightsPattern =
    /\blower\s+pac(?:ific)?\s+(?:heights|hts)\b/u;
  const withoutLowerPacificHeights = body.replace(
    /\blower\s+pac(?:ific)?\s+(?:heights|hts)\b/gu,
    "",
  );
  if (lowerPacificHeightsPattern.test(body)) {
    neighborhoods.push("Lower Pacific Heights");
  }
  if (/\bpac(?:ific)?\s+(?:heights|hts)\b/u.test(withoutLowerPacificHeights)) {
    neighborhoods.push("Pacific Heights");
  }

  const candidates = [
    ["Mission Bay", /\bmission\s+bay\b/u],
    ["Hayes Valley", /\bhayes\s+valley\b/u],
    ["Lower Haight", /\blower\s+haight\b/u],
    ["Noe Valley", /\bnoe\s+valley\b/u],
    ["Russian Hill", /\brussian\s+hill\b/u],
    ["Nob Hill", /\bnob\s+hill\b/u],
    ["North Beach", /\bnorth\s+beach\b/u],
    ["Potrero Hill", /\bpotrero\s+hill\b/u],
    ["Bernal Heights", /\bbernal\s+heights\b/u],
    ["Cow Hollow", /\bcow\s+hollow\b/u],
    ["Dogpatch", /\bdogpatch\b/u],
    ["Mission", /\bmission\b(?!\s+bay)/u],
    ["SoMa", /\bsoma\b/u],
    ["Marina", /\bmarina\b/u],
    ["Castro", /\bcastro\b/u],
    ["Richmond", /\brichmond\b/u],
    ["Sunset", /\bsunset\b/u],
    // Lookbehind so "lower haight" resolves to Lower Haight only, not both
    // (mirrors the Mission/Mission Bay guard above).
    ["Haight", /\b(?<!lower\s)haight\b/u],
    ["Panhandle", /\bpanhandle\b/u],
    ["Fillmore", /\bfillmore\b/u],
  ] as const;

  for (const [name, pattern] of candidates) {
    if (pattern.test(body)) {
      neighborhoods.push(name);
    }
  }

  return dedupeStrings(neighborhoods);
}

function dedupeStrings(values: string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
      }),
    ),
  ];
}
