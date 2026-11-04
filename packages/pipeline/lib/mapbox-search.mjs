const SEARCH_BASE = "https://api.mapbox.com/search/searchbox/v1/category";

function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function searchCategoryNearby(category, lat, lng, token, limit = 5) {
  const url = `${SEARCH_BASE}/${category}?proximity=${lng},${lat}&limit=${limit}&access_token=${token}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Mapbox category search failed (${response.status}) for ${category} at ${lat},${lng}`);
    return [];
  }

  const data = await response.json();
  const features = data.features ?? [];

  return features.map((f) => {
    const coords = f.geometry?.coordinates ?? [];
    const dist =
      coords.length === 2 ? haversineDistance(lat, lng, coords[1], coords[0]) : null;
    return {
      name: f.properties?.name ?? "Unknown",
      distance: dist != null ? Number(dist.toFixed(2)) : null,
    };
  });
}
