#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseScriptClient, loadDotEnv, parseArgs } from "./lib/cli.mjs";
import { searchCategoryNearby } from "./lib/mapbox-search.mjs";

loadDotEnv();
const args = parseArgs();

const market = args.get("market") ?? process.env.LISTINGS_IMPORT_MARKET ?? "san-francisco-ca";
const dryRun = args.get("dry-run") === "true";
const delayMs = Number(args.get("delay-ms") ?? 100);
const limit = args.has("limit") ? Number(args.get("limit")) : null;

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!mapboxToken) {
  console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN.");
  process.exit(1);
}

const supabase = createSupabaseScriptClient({ optional: dryRun });

const categoryMap = [
  { key: "transit", mapboxCategory: "train_station" },
  { key: "restaurant", mapboxCategory: "restaurant" },
  { key: "park", mapboxCategory: "park" },
  { key: "grocery", mapboxCategory: "grocery" },
];

async function main() {
  let query = supabase
    .from("apartment_listings")
    .select("id, address_line, latitude, longitude")
    .eq("provider_market", market)
    .is("poi_enriched_at", null)
    .is("inactive_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (limit) query = query.limit(limit);
  const { data: listings, error } = await query;
  if (error) throw error;

  console.log(`Enriching ${listings.length} listings with POI data (market: ${market}).`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    const lat = Number(listing.latitude);
    const lng = Number(listing.longitude);
    const poiSummary = {};

    try {
      for (const { key, mapboxCategory } of categoryMap) {
        poiSummary[key] = await searchCategoryNearby(mapboxCategory, lat, lng, mapboxToken);
        if (delayMs > 0) await delay(delayMs);
      }

      if (dryRun) {
        const counts = categoryMap.map(({ key }) => `${key}: ${poiSummary[key].length}`).join(", ");
        console.log(`[${i + 1}/${listings.length}] ${listing.address_line} → ${counts} (dry run)`);
        enriched += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("apartment_listings")
        .update({
          poi_summary: poiSummary,
          poi_enriched_at: new Date().toISOString(),
        })
        .eq("id", listing.id);
      if (updateError) throw updateError;

      const topPoi = Object.values(poiSummary).flat()[0];
      console.log(`[${i + 1}/${listings.length}] ${listing.address_line} → ${topPoi?.name ?? "no POIs"}`);
      enriched += 1;
    } catch (err) {
      console.error(`[${i + 1}/${listings.length}] ${listing.address_line} → ERROR: ${err.message}`);
      failed += 1;
    }
  }

  console.log(JSON.stringify({ market, total: listings.length, enriched, failed, dryRun }, null, 2));
}

await main();
