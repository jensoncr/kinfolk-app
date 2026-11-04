import {
  formatCountLabels,
  formatList,
  formatPlace,
  formatSoundscoreSignal,
  readPoiSummary,
} from "./tools-format";
import type {
  AreaSignalPlace,
  AreaSignalSummary,
  DataSfSafetyBaseline,
} from "../apartments/area-signals";
import type { ListingLocationContext, TableRow } from "./tools";

const safetyReferenceSetLabel = "SF reference areas";
type RestaurantAreaSignalRequestKind = "coffee_work" | "dining";

export function formatSafetyAreaSignalReply(
  areaSignals: AreaSignalSummary | null,
) {
  if (!areaSignals || areaSignals.purpose !== "safety") return null;
  if (areaSignals.target.label === safetyReferenceSetLabel) {
    return formatBroadDataSfSafetyRanking(areaSignals.dataSf?.baseline);
  }

  const incidentCounts = areaSignals.dataSf?.incidentReports.radiusTopCategories
    .length
    ? areaSignals.dataSf.incidentReports.radiusTopCategories
    : (areaSignals.dataSf?.incidentReports.neighborhoodTopCategories ?? []);
  const serviceCounts = areaSignals.dataSf?.serviceRequests311
    .radiusTopCategories.length
    ? areaSignals.dataSf.serviceRequests311.radiusTopCategories
    : (areaSignals.dataSf?.serviceRequests311.neighborhoodTopCategories ?? []);
  const incidentLine = formatCountLabels(incidentCounts, 2);
  const serviceLine = formatCountLabels(serviceCounts, 2);
  const relativeLine = formatDataSfSafetyBaseline(areaSignals.dataSf?.baseline);
  const soundscore = formatSoundscoreSignal(areaSignals);
  const target =
    areaSignals.target.neighborhood &&
    areaSignals.target.neighborhood !== areaSignals.target.label
      ? `${areaSignals.target.label} in ${areaSignals.target.neighborhood}`
      : areaSignals.target.label;

  if (!incidentLine && !serviceLine && !relativeLine && !soundscore)
    return null;

  return [
    `${target}: ${relativeLine ?? "I can compare public signals, but I would not turn them into a definitive safe/unsafe label."}`,
    soundscore ? `Noise: ${soundscore}` : null,
    incidentLine
      ? `Recent SFPD reports nearby are mostly ${incidentLine}.`
      : null,
    serviceLine ? `Recent 311 requests are mostly ${serviceLine}.` : null,
    "I would use that as a screening signal, then check the exact block at the time of day you would be home.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatBroadDataSfSafetyRanking(
  baseline: DataSfSafetyBaseline | undefined,
) {
  if (!baseline || baseline.status !== "ok") return null;

  const lowerSignal = baseline.lowestPublicSafetySignal
    .slice(0, 3)
    .map((area) => area.label);
  const higherSignal = baseline.highestPublicSafetySignal
    .slice(0, 3)
    .map((area) => area.label);

  if (!lowerSignal.length || !higherSignal.length) return null;

  return [
    `In the SF reference check, lower reported-incident areas include ${formatList(lowerSignal)}.`,
    `Higher-activity references include ${formatList(higherSignal)}.`,
    "That is public incident activity, not a definitive safety verdict.",
  ].join(" ");
}

function formatDataSfSafetyBaseline(
  baseline: DataSfSafetyBaseline | undefined,
) {
  if (!baseline || baseline.status !== "ok") return null;

  const target = baseline.target;
  const signal = formatDataSfSafetySignalLevel(target.signalLevel);
  return `DataSF shows recent reported-incident activity as ${signal} compared with SF reference areas.`;
}

function formatDataSfSafetySignalLevel(level: string) {
  switch (level) {
    case "above_typical":
      return "above typical";
    case "below_typical":
      return "below typical";
    case "elevated":
      return "elevated";
    case "low":
      return "low";
    default:
      return "typical";
  }
}

export function formatRestaurantAreaSignalReply(
  areaSignals: AreaSignalSummary | null,
  listingContext: ListingLocationContext | null,
  profile?: TableRow<"neighborhood_profiles">,
  options: { requestKind?: RestaurantAreaSignalRequestKind } = {},
) {
  if (areaSignals && areaSignals.purpose !== "restaurants") return null;

  const requestKind = options.requestKind ?? "dining";
  const googlePlaces = areaSignals?.restaurants?.googlePlaces.places ?? [];
  const mapboxPlaces = areaSignals?.restaurants?.mapbox.places ?? [];
  const filteredGooglePlaces =
    requestKind === "coffee_work"
      ? googlePlaces.filter(isCoffeeWorkPlace)
      : googlePlaces;
  const filteredMapboxPlaces =
    requestKind === "coffee_work"
      ? mapboxPlaces.filter(isCoffeeWorkPlace)
      : mapboxPlaces;
  const primaryPlaces =
    filteredGooglePlaces.length > 0
      ? filteredGooglePlaces
      : filteredMapboxPlaces;

  const target = listingContext
    ? `${listingContext.address}${listingContext.neighborhood ? ` in ${listingContext.neighborhood}` : ""}`
    : (areaSignals?.target.label ?? profile?.display_name);
  if (!target) return null;

  const profileRestaurants = profilePoiRestaurantNames(profile, requestKind);
  const caveatLine =
    requestKind === "coffee_work"
      ? " I would still verify seating and laptop-friendliness before treating any spot as a work setup."
      : "";

  if (primaryPlaces.length === 0) {
    if (profileRestaurants.length > 0) {
      const kindLabel = requestKind === "coffee_work" ? "cafe" : "places";
      return `I do not have a live ${kindLabel} lookup for ${target} right now, but the neighborhood profile lists ${formatList(profileRestaurants)} nearby.${caveatLine}`;
    }

    if (requestKind === "coffee_work") {
      return `I do not have a grounded cafe or coffee-work signal for ${target} yet. I would not name a quiet coffee spot there without a cafe-type source.`;
    }

    return null;
  }

  const topPlaces = primaryPlaces.slice(0, 3);
  const names = topPlaces
    .flatMap((place) => {
      const name = formatPlace(place);
      return name ? [name] : [];
    })
    .join("; ");
  const source = filteredGooglePlaces.length > 0 ? "Google Places" : "Mapbox";
  const backupCount = filteredMapboxPlaces.length;
  const backupLine =
    filteredGooglePlaces.length > 0 && backupCount > 0
      ? ` Mapbox also sees ${backupCount} nearby restaurant result${backupCount === 1 ? "" : "s"}.`
      : "";
  const mentionedNames = new Set(
    topPlaces.map((place) => place.name.toLowerCase()),
  );
  const extraProfileNames = profileRestaurants.filter(
    (name) => !mentionedNames.has(name.toLowerCase()),
  );
  const profileLine =
    extraProfileNames.length > 0
      ? ` The neighborhood profile also flags ${formatList(extraProfileNames)} nearby.`
      : "";
  const soundscore = areaSignals ? formatSoundscoreSignal(areaSignals) : null;
  const noiseLine = soundscore ? ` Noise check: ${soundscore}` : "";
  const categoryLabel =
    requestKind === "coffee_work"
      ? "coffee/cafe signals"
      : "restaurant and cafe/bar signals";

  return `Near ${target}, ${source} shows the strongest ${categoryLabel}: ${names}.${backupLine}${profileLine}${noiseLine}${caveatLine}`;
}

function profilePoiRestaurantNames(
  profile: TableRow<"neighborhood_profiles"> | undefined,
  requestKind: RestaurantAreaSignalRequestKind,
) {
  if (!profile) return [];

  const names: string[] = [];
  for (const point of readPoiSummary(profile.poi_summary).restaurant) {
    if (names.length >= 3) break;
    const name = point.name.trim();
    if (!name) continue;
    if (requestKind === "coffee_work" && !isCoffeeWorkName(name)) continue;
    names.push(name);
  }

  return names;
}

function isCoffeeWorkPlace(place: AreaSignalPlace) {
  return isCoffeeWorkName(place.name) || isCoffeeWorkType(place);
}

function isCoffeeWorkType(place: AreaSignalPlace) {
  const typeText = [place.primaryType, ...(place.types ?? [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (!typeText) return false;
  if (/\b(?:bar|night_club|liquor_store)\b/i.test(typeText)) return false;
  return /\b(?:caf(?:e|\u00e9)|coffee|coffee_shop|coffee_roastery|coffee_stand|bakery|bagel_shop|donut_shop|pastry_shop|tea|tea_house|juice_shop)\b/i.test(
    typeText,
  );
}

function isCoffeeWorkName(name: string) {
  const hasCoffeeSignal =
    /\b(?:coffee|coffeehouse|espresso|caf(?:e|\u00e9)|bakery|bakehouse|bagels?|donuts?|patisserie|tea|boba|roaster|philz|blue bottle|starbucks|peet'?s)\b/i.test(
      name,
    );

  if (!hasCoffeeSignal) return false;
  if (
    /\b(?:saloon|pub|tavern|lounge|nightclub|cocktail|brewery)\b/i.test(name)
  ) {
    return false;
  }

  return (
    !/\bbar\b/i.test(name) ||
    /\b(?:coffee|espresso|caf(?:e|\u00e9)|tea)\b/i.test(name)
  );
}

export function formatCommuteAreaSignalReply(
  areaSignals: AreaSignalSummary | null,
) {
  if (!areaSignals || areaSignals.purpose !== "commute") return null;

  const commute = areaSignals.commute;
  if (!commute) return null;
  const origin =
    areaSignals.target.neighborhood &&
    areaSignals.target.neighborhood !== areaSignals.target.label
      ? `${areaSignals.target.label} in ${areaSignals.target.neighborhood}`
      : areaSignals.target.label;
  const destination = commute.destinationLabel;
  const modePhrase = formatCommuteModePhrase(commute.travelMode);

  if (commute.status === "ok" && commute.durationMinutes != null) {
    const lead = `Google says about ${commute.durationMinutes} min ${modePhrase} from ${origin} to ${destination}${commute.travelMode === "TRANSIT" ? " for a 9am weekday arrival" : ""}`;
    const transitDetail = formatCommuteTransitDetail(commute.transit);
    const realtimeClause = formatCommuteRealtimeClause(commute.realtime);
    return `${lead}${transitDetail ? ` — ${transitDetail}` : ""}.${realtimeClause ? ` ${realtimeClause}` : ""} I would still sanity-check the exact departure window, since headways shift outside commute hours.`;
  }

  if (
    commute.reason === "routes_api_not_enabled" ||
    commute.reason === "missing_api_key"
  ) {
    return `I can't pull live transit times yet — the live route lookup isn't switched on for me. For ${origin} to ${destination}, check Google Maps directly rather than trusting a guess from me.`;
  }

  if (commute.reason === "no_route_found") {
    return `Google didn't return a ${modePhrase} route from ${origin} to ${destination} just now, so I would not quote a number. Check Google Maps directly for the live time.`;
  }

  return `I tried to pull a live ${modePhrase} time from ${origin} to ${destination}, but the lookup failed just now. I would not guess a commute number — check Google Maps for the live time.`;
}

function formatCommuteModePhrase(travelMode: string) {
  switch (travelMode) {
    case "BICYCLE":
      return "by bike";
    case "DRIVE":
      return "driving";
    case "WALK":
      return "walking";
    default:
      return "door-to-door on transit";
  }
}

function formatCommuteRealtimeClause(
  realtime: NonNullable<AreaSignalSummary["commute"]>["realtime"],
) {
  if (!realtime || realtime.nextDepartureMinutes.length === 0) return null;

  const minutes = realtime.nextDepartureMinutes;
  if (minutes.length === 1) {
    return `Right now 511 shows the next one leaving in ${minutes[0]} minute${minutes[0] === 1 ? "" : "s"}.`;
  }

  const cadence =
    realtime.headwayMinutes != null
      ? ` — roughly every ${realtime.headwayMinutes} min`
      : "";
  return `Right now 511 shows the next ones in ${formatList(minutes.map(String))} minutes${cadence}.`;
}

function formatCommuteTransitDetail(
  transit: NonNullable<AreaSignalSummary["commute"]>["transit"],
) {
  if (!transit) return null;

  const parts: string[] = [];
  if (transit.walkToFirstStopMinutes != null && transit.firstStopName) {
    parts.push(
      `${transit.walkToFirstStopMinutes} min walk to ${transit.firstStopName}`,
    );
  } else if (transit.firstStopName) {
    parts.push(`boarding at ${transit.firstStopName}`);
  }
  if (transit.lineNames.length > 0) {
    parts.push(`via ${formatList(transit.lineNames.slice(0, 3))}`);
  }
  parts.push(
    transit.transferCount === 0
      ? "no transfers"
      : `${transit.transferCount} transfer${transit.transferCount === 1 ? "" : "s"}`,
  );

  return parts.join(", ");
}

export function formatNoiseAreaSignalReply(
  areaSignals: AreaSignalSummary | null,
  listingContext: ListingLocationContext | null,
) {
  if (!areaSignals || areaSignals.purpose !== "noise") return null;

  const target = listingContext
    ? `${listingContext.address}${listingContext.neighborhood ? ` in ${listingContext.neighborhood}` : ""}`
    : areaSignals.target.label;
  const signal = formatSoundscoreSignal(areaSignals);

  if (signal) {
    return `${target}: ${signal} I would still ask the agent about window orientation and whether the unit faces the street, because those can matter as much as the block score.`;
  }

  if (areaSignals.soundscore?.status === "error") {
    return `${target}: I tried to pull a HowLoud SoundScore, but the lookup failed just now. I would treat arterial frontage as a noise risk until the unit-facing details are confirmed.`;
  }

  return `${target}: I do not have a HowLoud SoundScore for that address yet. I would check whether the unit faces the street, has double-pane windows, and sits above late-night commercial frontage.`;
}
