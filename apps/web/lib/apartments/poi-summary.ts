import type { Json } from "@/lib/supabase/types";
import type { EnrichedDetail } from "@/lib/apartments/types";

function asObject(value: Json | undefined): Record<string, Json> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  return null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeTransitName(name: string): string {
  return name.toLowerCase().replace(/\s*(station|stop|bart|muni|terminal)\s*$/i, "").trim();
}

function parsePois(obj: Record<string, Json>, key: string): { name: string; distance: number }[] {
  const arr = Array.isArray(obj[key]) ? (obj[key] as Json[]) : [];
  const seen = new Set<string>();
  return arr.flatMap((item) => {
    const o = asObject(item);
    const name = asString(o?.name);
    if (!name) return [];
    const dedupeKey = name.toLowerCase().trim();
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{ name, distance: Number(o?.distance ?? 0) }];
  });
}

function mergePoiLists(
  lists: { name: string; distance: number }[][],
): { name: string; distance: number }[] {
  const seen = new Set<string>();
  return lists.flat().filter((item) => {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parsePoiSummary(raw: Json | null | undefined): EnrichedDetail["poiSummary"] {
  const obj = asObject(raw);
  if (!obj) return null;
  const transitRaw = parsePois(obj, "transit");
  const seen = new Set<string>();
  const transit = transitRaw.filter((item) => {
    const key = normalizeTransitName(item.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    transit,
    restaurant: parsePois(obj, "restaurant"),
    parks: mergePoiLists([parsePois(obj, "park"), parsePois(obj, "parks")]),
    grocery: parsePois(obj, "grocery"),
  };
}
