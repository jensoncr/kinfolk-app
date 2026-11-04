#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseScriptClient, loadDotEnv, parseArgs } from "./lib/cli.mjs";
import { reverseGeocodeNeighborhood } from "./lib/mapbox-geocode.mjs";

loadDotEnv();
const args = parseArgs();

const market = args.get("market") ?? process.env.LISTINGS_IMPORT_MARKET ?? "san-francisco-ca";
const dryRun = args.get("dry-run") === "true";
const delayMs = Number(args.get("delay-ms") ?? 100);
const limit = Number(args.get("limit") ?? 10000);

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!mapboxToken) {
  console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN.");
  process.exit(1);
}

const supabase = createSupabaseScriptClient({ optional: dryRun });

async function main() {
  const { data: rows, error } = await supabase
    .from("apartment_listings")
    .select("id, address_line, city, neighborhood, latitude, longitude")
    .eq("provider_market", market)
    .eq("listing_status", "active")
    .limit(limit);

  if (error) throw error;

  const needsGeocode = rows.filter(
    (r) => r.latitude != null && r.longitude != null && (r.neighborhood === r.city || !r.neighborhood),
  );

  console.log(`Found ${needsGeocode.length} of ${rows.length} listings needing neighborhood geocoding.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < needsGeocode.length; i++) {
    const row = needsGeocode[i];
    try {
      const neighborhood = await reverseGeocodeNeighborhood(row.latitude, row.longitude, mapboxToken);

      if (!neighborhood || neighborhood === row.city) {
        console.log(`[${i + 1}/${needsGeocode.length}] ${row.address_line} → (no neighborhood found)`);
        skipped += 1;
      } else if (dryRun) {
        console.log(`[${i + 1}/${needsGeocode.length}] ${row.address_line} → ${neighborhood} (dry run)`);
        updated += 1;
      } else {
        const { error: updateError } = await supabase
          .from("apartment_listings")
          .update({ neighborhood })
          .eq("id", row.id);
        if (updateError) throw updateError;
        console.log(`[${i + 1}/${needsGeocode.length}] ${row.address_line} → ${neighborhood}`);
        updated += 1;
      }
    } catch (err) {
      console.error(`[${i + 1}/${needsGeocode.length}] ${row.address_line} → ERROR: ${err.message}`);
      failed += 1;
    }

    if (i < needsGeocode.length - 1 && delayMs > 0) {
      await delay(delayMs);
    }
  }

  console.log(JSON.stringify({ market, total: rows.length, geocoded: needsGeocode.length, updated, skipped, failed, dryRun }, null, 2));
}

await main();
