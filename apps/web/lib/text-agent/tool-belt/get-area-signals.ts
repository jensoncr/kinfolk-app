import { readNumber, readString } from "./args";
import type { CommuteTravelMode } from "../../apartments/area-signals";
import type { ReferencedListingLocation } from "./get-listing-details";
import type { HousingAgentTool, HousingAgentToolContext } from "./types";
import { resolveTextAgentApartmentMarket } from "../neighborhoods";

type AreaTopic = "coffee" | "commute" | "noise" | "safety" | "vibe";

function readTopic(value: unknown): AreaTopic {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "noise") return "noise";
  if (
    raw === "coffee" ||
    raw === "cafe" ||
    raw === "cafes" ||
    raw === "work_cafe" ||
    raw === "work_spot"
  ) {
    return "coffee";
  }
  if (raw === "vibe" || raw === "restaurants" || raw === "food") return "vibe";
  if (
    raw === "commute" ||
    raw === "commute_time" ||
    raw === "transit" ||
    raw === "travel_time"
  ) {
    return "commute";
  }
  return "safety";
}

function readCommuteTravelMode(value: unknown): CommuteTravelMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "walk" || raw === "walking") return "WALK";
  if (
    raw === "bike" ||
    raw === "bicycle" ||
    raw === "biking" ||
    raw === "cycling"
  ) {
    return "BICYCLE";
  }
  if (raw === "drive" || raw === "driving" || raw === "car") return "DRIVE";
  return "TRANSIT";
}

export const getAreaSignalsTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Pull grounded public signals for an SF neighborhood — noise (HowLoud SoundScore), recent DataSF/311 activity, nearby food/transit, coffee/cafe signals, rent range, vibe, and live commute times (Google Routes). Use this for any 'is X safe/quiet/loud/walkable/good' question instead of answering from memory, and with topic commute for any 'how's the commute to FiDi/Caltrain/work from X' question.",
      name: "get_area_signals",
      parameters: {
        additionalProperties: false,
        properties: {
          destination: {
            description:
              "For topic commute: where they commute to — shorthand like fidi/downtown, caltrain, salesforce, mission bay, ucsf, or any SF address/place name.",
            type: "string",
          },
          listingAddress: {
            description:
              "For topic commute: street address (or fragment) of an already-shown listing to use as the commute origin.",
            type: "string",
          },
          listingOrdinal: {
            description:
              "For topic commute: 1-based position of the already-shown listing to use as the commute origin — 'the second one' is 2.",
            type: "number",
          },
          neighborhood: {
            description:
              "SF neighborhood name, e.g. 'Nob Hill' or 'Mission'. Required for every topic except commute, where a shown listing can be the origin instead.",
            type: "string",
          },
          topic: {
            description:
              "What the user is asking about: safety (default, also returns noise), noise, vibe (food/amenities), coffee (cafes/work spots), or commute (door-to-door travel time to a destination).",
            enum: ["safety", "noise", "vibe", "coffee", "commute"],
            type: "string",
          },
          travelMode: {
            description:
              "For topic commute: transit (default), walk, bike, or drive.",
            enum: ["transit", "walk", "bike", "drive"],
            type: "string",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  async run(context, args) {
    const topic = readTopic(args.topic);
    const neighborhood = readString(args.neighborhood);

    if (topic === "commute") {
      return runCommuteAreaSignals(context, {
        destination: readString(args.destination),
        listingAddress: readString(args.listingAddress),
        listingOrdinal: readNumber(args.listingOrdinal),
        neighborhood,
        travelMode: readCommuteTravelMode(args.travelMode),
      });
    }

    if (!neighborhood) {
      return {
        data: {},
        ok: false,
        summary: "Ask which SF neighborhood they mean before pulling signals.",
        toolName: "get_area_signals",
      };
    }
    const apartmentAreaSignalsModule = import("../../apartments/area-signals");
    const neighborhoodsModule = import("../neighborhoods");
    const textAreaSignalsModule = import("../area-signals");
    const [
      { buildAreaSignalSummary },
      {
        findNeighborhoodProfile,
        normalizeNeighborhoodName,
        describeNeighborhoodVibe,
      },
      {
        formatSafetyAreaSignalReply,
        formatNoiseAreaSignalReply,
        formatRestaurantAreaSignalReply,
      },
      profiles,
    ] = await Promise.all([
      apartmentAreaSignalsModule,
      neighborhoodsModule,
      textAreaSignalsModule,
      neighborhoodsModule.then(({ loadNeighborhoodProfiles }) =>
        loadNeighborhoodProfiles(
          context.supabase,
          resolveTextAgentApartmentMarket(),
        ),
      ),
    ]);
    const profileMap = new Map(
      profiles.map((profile) => [
        normalizeNeighborhoodName(profile.display_name),
        profile,
      ]),
    );
    const profile = findNeighborhoodProfile(profileMap, neighborhood);
    const vibe = describeNeighborhoodVibe(neighborhood);

    const purpose =
      topic === "noise"
        ? ("noise" as const)
        : topic === "vibe" || topic === "coffee"
          ? ("restaurants" as const)
          : ("safety" as const);

    let signal: string | null = null;
    if (profile?.latitude != null && profile.longitude != null) {
      const summary = await buildAreaSignalSummary({
        label: profile.display_name,
        lat: Number(profile.latitude),
        lng: Number(profile.longitude),
        neighborhood: profile.display_name,
        purpose,
        restaurantPlaceKind: topic === "coffee" ? "coffee" : "dining",
      });
      signal =
        topic === "noise"
          ? formatNoiseAreaSignalReply(summary, null)
          : topic === "vibe" || topic === "coffee"
            ? formatRestaurantAreaSignalReply(summary, null, profile, {
                requestKind: topic === "coffee" ? "coffee_work" : "dining",
              })
            : formatSafetyAreaSignalReply(summary);
    }

    const rentRange =
      profile?.rent_min != null && profile.rent_max != null
        ? { max: profile.rent_max, min: profile.rent_min }
        : null;

    return {
      data: {
        knownNeighborhood: Boolean(profile),
        medianRent: profile?.median_rent ?? null,
        neighborhood: profile?.display_name ?? neighborhood,
        rentRange,
        signal,
        vibe: vibe || null,
      },
      ok: true,
      summary:
        signal ??
        (vibe
          ? `${profile?.display_name ?? neighborhood} reads as ${vibe}. No live public-signal pull was available; do not assert a safe/unsafe verdict.`
          : `No grounded signals available for ${neighborhood}; do not assert a safe/unsafe verdict.`),
      toolName: "get_area_signals",
    };
  },
};

async function runCommuteAreaSignals(
  context: HousingAgentToolContext,
  {
    destination,
    listingAddress,
    listingOrdinal,
    neighborhood,
    travelMode,
  }: {
    destination: string | null;
    listingAddress: string | null;
    listingOrdinal: number | null;
    neighborhood: string | null;
    travelMode: CommuteTravelMode;
  },
) {
  if (!destination) {
    return {
      data: {},
      ok: false,
      summary:
        "Ask where the commute goes (an address, or shorthand like FiDi, Caltrain, Salesforce, Mission Bay, UCSF), then call get_area_signals again with topic commute and that destination.",
      toolName: "get_area_signals" as const,
    };
  }

  // Origin: a referenced already-shown listing wins; otherwise fall back to
  // the neighborhood centroid from the profile table.
  let recentlyShown: string[] = [];
  let originListing: ReferencedListingLocation | null = null;
  try {
    const { resolveReferencedListingLocation } = await import(
      "./get-listing-details"
    );
    const located = await resolveReferencedListingLocation(context, {
      address: listingAddress,
      // With a neighborhood in hand, a lone shown listing must not silently
      // become the origin — only an explicit reference ("the second one") may.
      allowLoneRecentFallback: neighborhood == null,
      ordinal: listingOrdinal,
    });
    recentlyShown = located.recentlyShown;
    originListing = located.resolved;
  } catch (error) {
    console.error(
      "[get_area_signals] commute origin listing lookup failed",
      error,
    );
  }

  let origin =
    originListing && originListing.lat != null && originListing.lng != null
      ? {
          label: originListing.address,
          lat: originListing.lat,
          lng: originListing.lng,
          neighborhood: originListing.neighborhood,
        }
      : null;

  const originNeighborhood =
    neighborhood ?? originListing?.neighborhood ?? null;
  if (!origin && originNeighborhood) {
    const {
      findNeighborhoodProfile,
      loadNeighborhoodProfiles,
      normalizeNeighborhoodName,
      resolveTextAgentApartmentMarket,
    } = await import("../neighborhoods");
    const profiles = await loadNeighborhoodProfiles(
      context.supabase,
      resolveTextAgentApartmentMarket(),
    );
    const profileMap = new Map(
      profiles.map((profile) => [
        normalizeNeighborhoodName(profile.display_name),
        profile,
      ]),
    );
    const profile = findNeighborhoodProfile(profileMap, originNeighborhood);
    if (profile?.latitude != null && profile.longitude != null) {
      origin = {
        label: originListing?.address ?? profile.display_name,
        lat: Number(profile.latitude),
        lng: Number(profile.longitude),
        neighborhood: profile.display_name,
      };
    }
  }

  if (!origin) {
    return {
      data: { recentlyShown },
      ok: false,
      summary:
        recentlyShown.length > 0
          ? `Could not pin down the commute origin. Recently shown: ${recentlyShown.join("; ")}. Ask which listing (by address or position) or which neighborhood the commute starts from, then call get_area_signals with topic commute again.`
          : "Could not pin down the commute origin. Ask which SF neighborhood (or which shown listing) the commute starts from, then call get_area_signals with topic commute again.",
      toolName: "get_area_signals" as const,
    };
  }

  const [{ buildAreaSignalSummary }, { formatCommuteAreaSignalReply }] =
    await Promise.all([
      import("../../apartments/area-signals"),
      import("../area-signals"),
    ]);
  const summary = await buildAreaSignalSummary({
    commuteDestination: destination,
    commuteTravelMode: travelMode,
    label: origin.label,
    lat: origin.lat,
    lng: origin.lng,
    neighborhood: origin.neighborhood,
    purpose: "commute",
  });
  const signal = formatCommuteAreaSignalReply(summary);

  return {
    data: {
      commute: summary.commute ?? null,
      destination,
      origin: { label: origin.label, neighborhood: origin.neighborhood },
      signal,
    },
    ok: true,
    summary:
      signal ??
      `No grounded commute signal available from ${origin.label} to ${destination}; do not guess a commute time.`,
    toolName: "get_area_signals" as const,
  };
}
