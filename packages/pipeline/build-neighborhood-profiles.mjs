#!/usr/bin/env node
import { createSupabaseScriptClient, loadDotEnv, parseArgs } from "./lib/cli.mjs";

loadDotEnv();
const args = parseArgs();

const market = args.get("market") ?? process.env.LISTINGS_IMPORT_MARKET ?? "san-francisco-ca";
const dryRun = args.get("dry-run") === "true";

const supabase = createSupabaseScriptClient({ optional: dryRun });

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

async function main() {
  const { data: listings, error } = await supabase
    .from("apartment_listings")
    .select("neighborhood, city, latitude, longitude, monthly_rent, rent_min, bedrooms, amenities")
    .eq("provider_market", market)
    .eq("listing_status", "active");

  if (error) throw error;

  const byNeighborhood = new Map();
  for (const row of listings) {
    const hood = row.neighborhood ?? row.city;
    if (!hood || hood === row.city) continue;
    if (!byNeighborhood.has(hood)) byNeighborhood.set(hood, []);
    byNeighborhood.get(hood).push(row);
  }

  console.log(`Found ${byNeighborhood.size} neighborhoods from ${listings.length} active listings.`);

  const profiles = [];
  for (const [name, rows] of byNeighborhood) {
    const rents = rows
      .map((r) => r.monthly_rent ?? r.rent_min)
      .filter((r) => r != null)
      .sort((a, b) => a - b);

    const bedroomDist = {};
    for (const r of rows) {
      const key = String(r.bedrooms ?? "unknown");
      bedroomDist[key] = (bedroomDist[key] ?? 0) + 1;
    }

    const amenityCounts = {};
    for (const r of rows) {
      for (const a of r.amenities ?? []) {
        amenityCounts[a] = (amenityCounts[a] ?? 0) + 1;
      }
    }
    const topAmenities = Object.entries(amenityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([a]) => a);

    const lats = rows.filter((r) => r.latitude != null).map((r) => Number(r.latitude));
    const lngs = rows.filter((r) => r.longitude != null).map((r) => Number(r.longitude));
    const centroidLat = lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
    const centroidLng = lngs.length > 0 ? lngs.reduce((a, b) => a + b, 0) / lngs.length : null;

    const profile = {
      market,
      name,
      display_name: name,
      latitude: centroidLat ? Number(centroidLat.toFixed(7)) : null,
      longitude: centroidLng ? Number(centroidLng.toFixed(7)) : null,
      listing_count: rows.length,
      median_rent: median(rents),
      rent_min: rents.length > 0 ? rents[0] : null,
      rent_max: rents.length > 0 ? rents[rents.length - 1] : null,
      bedroom_distribution: bedroomDist,
      common_amenities: topAmenities,
      stats_computed_at: new Date().toISOString(),
    };

    profiles.push(profile);

    const rentStr = rents.length > 0 ? `$${rents[0]}–$${rents[rents.length - 1]}` : "no rent data";
    console.log(`  ${name}: ${rows.length} listings, ${rentStr}`);
  }

  if (dryRun) {
    console.log(`\nDry run — would upsert ${profiles.length} neighborhood profiles.`);
    return;
  }

  const { error: upsertError } = await supabase
    .from("neighborhood_profiles")
    .upsert(profiles, { onConflict: "market,name" });
  if (upsertError) throw upsertError;

  console.log(`\nUpserted ${profiles.length} neighborhood profiles for ${market}.`);
}

await main();
