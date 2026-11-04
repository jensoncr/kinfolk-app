// RentCast long-term rent AVM client (GET /v1/avm/rent/long-term, verified
// against https://developers.rentcast.io/reference/rent-estimate-long-term).
// The API key is read lazily at call time: without RENTCAST_API_KEY every
// lookup quietly returns null (one debug line total, nothing user-facing), and
// the integration lights up with no code changes once the var exists. The free
// tier is 50 calls/month, so callers gate and cache aggressively — see
// resolveListingRentContext in lib/text-agent/rent-context.ts. Leaf module:
// no @/ imports so vitest can load it without the alias.

const rentCastRentEstimateUrl = "https://api.rentcast.io/v1/avm/rent/long-term";
const requestTimeoutMs = 5_000;
const maxComps = 3;

export type RentCastComp = {
  address: string;
  distanceMiles: number | null;
  rent: number;
};

export type RentCastRentEstimate = {
  compCount: number;
  comps: RentCastComp[];
  rentEstimate: number;
  rentRangeHigh: number | null;
  rentRangeLow: number | null;
};

export type RentCastSubject = {
  address?: string | null;
  bathrooms?: number | null;
  bedrooms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  squareFootage?: number | null;
};

/**
 * Retryable failure (network error, timeout, 429, 5xx). Distinct from a null
 * return ("RentCast has no estimate for this subject"): callers cache null as
 * a miss with escalating backoff, and a transient blip must not burn a paid
 * call AND suppress future retries for a listing that may price fine.
 */
class RentCastUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RentCastUnavailableError";
  }
}

let warnedMissingKey = false;

function readApiKey() {
  const key = process.env.RENTCAST_API_KEY?.trim();
  if (key) {
    return key;
  }
  if (!warnedMissingKey) {
    warnedMissingKey = true;
    console.debug(
      "[rentcast] RENTCAST_API_KEY is not set — skipping RentCast rent estimates",
    );
  }
  return null;
}

export function isRentCastConfigured() {
  return readApiKey() != null;
}

export async function fetchRentCastRentEstimate(
  subject: RentCastSubject,
): Promise<RentCastRentEstimate | null> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return null;
  }

  const url = new URL(rentCastRentEstimateUrl);
  if (subject.latitude != null && subject.longitude != null) {
    url.searchParams.set("latitude", String(subject.latitude));
    url.searchParams.set("longitude", String(subject.longitude));
  } else if (subject.address?.trim()) {
    url.searchParams.set("address", subject.address.trim());
  } else {
    return null;
  }
  if (subject.bedrooms != null) {
    url.searchParams.set("bedrooms", String(subject.bedrooms));
  }
  if (subject.bathrooms != null) {
    url.searchParams.set("bathrooms", String(subject.bathrooms));
  }
  if (subject.squareFootage != null && subject.squareFootage > 0) {
    url.searchParams.set("squareFootage", String(subject.squareFootage));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new RentCastUnavailableError(
      `RentCast request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    console.debug(
      `[rentcast] rent estimate request failed: ${response.status}`,
    );
    // 429/5xx are quota/outage conditions; 4xx means RentCast has nothing
    // for this subject (a genuine, cacheable miss).
    if (response.status === 429 || response.status >= 500) {
      throw new RentCastUnavailableError(
        `RentCast responded ${response.status}.`,
      );
    }
    return null;
  }

  try {
    return parseRentEstimate(await response.json());
  } catch (error) {
    throw new RentCastUnavailableError(
      `RentCast returned an unreadable body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseRentEstimate(raw: unknown): RentCastRentEstimate | null {
  const record = asRecord(raw);
  const rentEstimate = readPositiveNumber(record?.rent);
  if (!record || rentEstimate == null) {
    return null;
  }

  const comps = (Array.isArray(record.comparables) ? record.comparables : [])
    .flatMap((entry) => {
      const comp = asRecord(entry);
      const address =
        typeof comp?.formattedAddress === "string"
          ? comp.formattedAddress.trim()
          : "";
      const rent = readPositiveNumber(comp?.price);
      if (!address || rent == null) {
        return [];
      }
      const distance = readPositiveNumber(comp?.distance);
      return [
        {
          address,
          distanceMiles: distance == null ? null : Number(distance.toFixed(2)),
          rent: Math.round(rent),
        },
      ];
    });

  return {
    compCount: comps.length,
    comps: comps.slice(0, maxComps),
    rentEstimate: Math.round(rentEstimate),
    rentRangeHigh: roundOrNull(readPositiveNumber(record.rentRangeHigh)),
    rentRangeLow: roundOrNull(readPositiveNumber(record.rentRangeLow)),
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function roundOrNull(value: number | null) {
  return value == null ? null : Math.round(value);
}
