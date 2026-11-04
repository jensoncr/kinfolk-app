#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseScriptClient, loadDotEnv, parseArgs } from "./lib/cli.mjs";
import { searchCategoryNearby } from "./lib/mapbox-search.mjs";

loadDotEnv();
const args = parseArgs();

const market = args.get("market") ?? process.env.LISTINGS_IMPORT_MARKET ?? "san-francisco-ca";
const dryRun = args.get("dry-run") === "true";
const delayMs = Number(args.get("delay-ms") ?? 100);

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!mapboxToken) {
  console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN.");
  process.exit(1);
}

const supabase = createSupabaseScriptClient({ optional: dryRun });

const categories = ["transit", "restaurant", "park", "grocery"];

async function main() {
  const { data: profiles, error } = await supabase
    .from("neighborhood_profiles")
    .select("id, name, latitude, longitude")
    .eq("market", market)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error) throw error;
  console.log(`Enriching ${profiles.length} neighborhood profiles with POI data.`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const lat = Number(profile.latitude);
    const lng = Number(profile.longitude);
    const poiSummary = {};

    try {
      for (const category of categories) {
        poiSummary[category] = await searchCategoryNearby(category, lat, lng, mapboxToken);
        if (delayMs > 0) await delay(delayMs);
      }

      if (dryRun) {
        const counts = categories.map((c) => `${c}: ${poiSummary[c].length}`).join(", ");
        console.log(`[${i + 1}/${profiles.length}] ${profile.name} → ${counts} (dry run)`);
        enriched += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("neighborhood_profiles")
        .update({
          poi_summary: poiSummary,
          poi_enriched_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
      if (updateError) throw updateError;

      const topPoi = Object.values(poiSummary).flat()[0];
      console.log(`[${i + 1}/${profiles.length}] ${profile.name} → ${topPoi?.name ?? "no POIs"}`);
      enriched += 1;
    } catch (err) {
      console.error(`[${i + 1}/${profiles.length}] ${profile.name} → ERROR: ${err.message}`);
      failed += 1;
    }
  }

  console.log(JSON.stringify({ market, total: profiles.length, enriched, failed, dryRun }, null, 2));
}

await main();
