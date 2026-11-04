const GEOCODE_BASE = "https://api.mapbox.com/search/geocode/v6/reverse";

export async function reverseGeocodeNeighborhood(lat, lng, token) {
  const url = `${GEOCODE_BASE}?longitude=${lng}&latitude=${lat}&types=neighborhood,locality,place&access_token=${token}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Mapbox geocode failed (${response.status}) for ${lat},${lng}`);
    return null;
  }

  const data = await response.json();
  const features = data.features ?? [];

  for (const type of ["neighborhood", "locality", "place"]) {
    const match = features.find(
      (f) => f.properties?.feature_type === type && f.properties?.name,
    );
    if (match) return match.properties.name;
  }

  return null;
}
