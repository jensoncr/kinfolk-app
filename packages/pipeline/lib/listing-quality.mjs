const DEFAULT_OPTIONS = {
  maxRejectedRatio: 0.2,
  minRejectedBeforeRatioAbort: 10,
  minimumRent: 500,
  maximumRent: 75000,
  maximumBedrooms: 20,
  maximumBathrooms: 20,
  baselineMaximumBedrooms: 6,
  baselineMinimumRentPerBedroom: 500,
  minimumRentPerBedroom: null,
  sameBedroomMinimumSamples: 5,
  rentPerBedroomMedianMultiplier: 0.35,
  sameBedroomRentMultiplier: 0.45,
};

const MARKET_RENT_PER_BEDROOM_FLOORS = new Map([
  ["san-francisco-ca", 650],
]);

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function listingFromItem(item) {
  return item?.listing ?? item;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function roundedBedroomBucket(bedrooms) {
  if (bedrooms == null || bedrooms < 0) return null;
  return String(Math.round(bedrooms));
}

function rentPerBedroomFor(listing) {
  const rent = numberOrNull(listing?.monthly_rent ?? listing?.rent_min);
  const bedrooms = numberOrNull(listing?.bedrooms ?? listing?.bedrooms_min);
  if (rent == null || bedrooms == null || bedrooms <= 0) return null;
  return rent / bedrooms;
}

function issue(code, message, details = {}) {
  return {
    code,
    severity: "reject",
    message,
    details,
  };
}

function optionsWithDefaults(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
  };
}

export function buildListingQualityContext(items, options = {}) {
  const config = optionsWithDefaults(options);
  const listings = items.map(listingFromItem).filter(Boolean);
  const rentPerBedroomValues = [];
  const rentByBedroom = new Map();

  for (const listing of listings) {
    const rent = numberOrNull(listing.monthly_rent ?? listing.rent_min);
    const bedrooms = numberOrNull(listing.bedrooms ?? listing.bedrooms_min);
    const rentPerBedroom = rentPerBedroomFor(listing);
    if (
      rent == null ||
      bedrooms == null ||
      rentPerBedroom == null ||
      bedrooms <= 0 ||
      bedrooms > config.baselineMaximumBedrooms ||
      rentPerBedroom < config.baselineMinimumRentPerBedroom
    ) {
      continue;
    }

    rentPerBedroomValues.push(rentPerBedroom);

    const bucket = roundedBedroomBucket(bedrooms);
    if (!bucket) continue;
    const values = rentByBedroom.get(bucket) ?? [];
    values.push(rent);
    rentByBedroom.set(bucket, values);
  }

  const medianRentByBedroom = {};
  const samplesByBedroom = {};
  for (const [bucket, values] of rentByBedroom.entries()) {
    medianRentByBedroom[bucket] = median(values);
    samplesByBedroom[bucket] = values.length;
  }

  return {
    market: options.market ?? null,
    listingCount: listings.length,
    rentPerBedroomSamples: rentPerBedroomValues.length,
    medianRentPerBedroom: median(rentPerBedroomValues),
    medianRentByBedroom,
    samplesByBedroom,
  };
}

export function evaluateListingQuality(item, context, options = {}) {
  const config = optionsWithDefaults(options);
  const listing = listingFromItem(item);
  const issues = [];
  const rent = numberOrNull(listing?.monthly_rent ?? listing?.rent_min);
  const bedrooms = numberOrNull(listing?.bedrooms ?? listing?.bedrooms_min);
  const bathrooms = numberOrNull(listing?.bathrooms ?? listing?.bathrooms_min);
  const rentPerBedroom = rentPerBedroomFor(listing);
  const marketFloor =
    config.minimumRentPerBedroom ??
    MARKET_RENT_PER_BEDROOM_FLOORS.get(String(context?.market ?? options.market ?? "")) ??
    config.baselineMinimumRentPerBedroom;

  if (rent != null && rent < config.minimumRent) {
    issues.push(
      issue("rent_below_minimum", "Monthly rent is below the import sanity floor.", {
        rent,
        minimumRent: config.minimumRent,
      }),
    );
  }

  if (rent != null && rent > config.maximumRent) {
    issues.push(
      issue("rent_above_maximum", "Monthly rent is above the import sanity ceiling.", {
        rent,
        maximumRent: config.maximumRent,
      }),
    );
  }

  if (bedrooms != null && (bedrooms < 0 || bedrooms > config.maximumBedrooms)) {
    issues.push(
      issue("bedrooms_out_of_range", "Bedroom count is outside the import sanity range.", {
        bedrooms,
        maximumBedrooms: config.maximumBedrooms,
      }),
    );
  }

  if (bathrooms != null && (bathrooms < 0 || bathrooms > config.maximumBathrooms)) {
    issues.push(
      issue("bathrooms_out_of_range", "Bathroom count is outside the import sanity range.", {
        bathrooms,
        maximumBathrooms: config.maximumBathrooms,
      }),
    );
  }

  if (rentPerBedroom != null && rentPerBedroom < marketFloor) {
    issues.push(
      issue("rent_per_bedroom_below_floor", "Rent per bedroom is too low for this market.", {
        bedrooms,
        rent,
        rentPerBedroom: Math.round(rentPerBedroom),
        marketFloor,
      }),
    );
  }

  const medianRentPerBedroom = numberOrNull(context?.medianRentPerBedroom);
  if (
    rentPerBedroom != null &&
    medianRentPerBedroom != null &&
    rentPerBedroom < medianRentPerBedroom * config.rentPerBedroomMedianMultiplier
  ) {
    issues.push(
      issue("rent_per_bedroom_batch_outlier", "Rent per bedroom is a severe outlier in this import batch.", {
        bedrooms,
        rent,
        rentPerBedroom: Math.round(rentPerBedroom),
        medianRentPerBedroom: Math.round(medianRentPerBedroom),
        multiplier: config.rentPerBedroomMedianMultiplier,
      }),
    );
  }

  const bedroomBucket = roundedBedroomBucket(bedrooms);
  const sameBedroomSamples = bedroomBucket ? context?.samplesByBedroom?.[bedroomBucket] ?? 0 : 0;
  const sameBedroomMedianRent = bedroomBucket ? numberOrNull(context?.medianRentByBedroom?.[bedroomBucket]) : null;
  if (
    rent != null &&
    sameBedroomMedianRent != null &&
    sameBedroomSamples >= config.sameBedroomMinimumSamples &&
    rent < sameBedroomMedianRent * config.sameBedroomRentMultiplier
  ) {
    issues.push(
      issue("same_bedroom_rent_outlier", "Monthly rent is a severe outlier for this bedroom count.", {
        bedroomBucket,
        rent,
        sameBedroomMedianRent: Math.round(sameBedroomMedianRent),
        sameBedroomSamples,
        multiplier: config.sameBedroomRentMultiplier,
      }),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function partitionListingsByQuality(items, options = {}) {
  const context = buildListingQualityContext(items, options);
  const accepted = [];
  const rejected = [];
  const issueCounts = {};

  for (const item of items) {
    const result = evaluateListingQuality(item, context, options);
    if (result.ok) {
      accepted.push(item);
      continue;
    }

    for (const qualityIssue of result.issues) {
      issueCounts[qualityIssue.code] = (issueCounts[qualityIssue.code] ?? 0) + 1;
    }

    const listing = listingFromItem(item);
    rejected.push({
      item,
      externalId: listing?.external_id ?? null,
      address: listing?.address_line ?? null,
      unit: listing?.unit ?? null,
      rent: listing?.monthly_rent ?? listing?.rent_min ?? null,
      bedrooms: listing?.bedrooms ?? listing?.bedrooms_min ?? null,
      issues: result.issues,
    });
  }

  return {
    accepted,
    rejected,
    context,
    summary: {
      totalListings: items.length,
      acceptedListings: accepted.length,
      rejectedListings: rejected.length,
      issueCounts,
      medianRentPerBedroom:
        context.medianRentPerBedroom == null ? null : Math.round(context.medianRentPerBedroom),
      rentPerBedroomSamples: context.rentPerBedroomSamples,
    },
  };
}

export function shouldAbortForQualityRejections(report, options = {}) {
  const config = optionsWithDefaults(options);
  const rejectedCount = report.rejected.length;
  if (rejectedCount === 0) return false;
  if (report.accepted.length === 0) return true;
  if (rejectedCount < config.minRejectedBeforeRatioAbort) return false;
  return rejectedCount / report.summary.totalListings > config.maxRejectedRatio;
}
