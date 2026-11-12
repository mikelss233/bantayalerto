// =====================================================================
// PLACE SEARCH SERVICE  (API #4: Nominatim, backup: Photon)
//
// WHAT IT DOES:
//   1. SEARCH ("geocoding"):    place name  -> map position
//      e.g. "Iligan City" -> latitude 8.23, longitude 124.24
//   2. REVERSE ("reverse geocoding"): map position -> place name
//      e.g. the user's GPS position -> "Iligan, Northern Mindanao"
//
// WHERE THE DATA COMES FROM (both free, no API key, both use OpenStreetMap data):
//   1. Nominatim - the official OpenStreetMap search (main)
//   2. Photon    - a search made by the company komoot (backup)
//
// WHY WE HAVE A BACKUP:
//   On Render's free plan many websites share one internet address. Nominatim
//   blocks that address with "429 Too Many Requests", so we switch to Photon.
//
// WHERE IT IS USED:
//   - The search box on the Live Map
//   - "Use my location" (to show the city name)
//   - Registration (finds the user's city on the map)
//   - Reports and evacuation centers (finds the address on the map)
// =====================================================================
const { fetchJson } = require('./http'); // our helper for calling APIs

const HOUR = 60 * 60 * 1000; // place locations rarely change, so we keep answers for 1 hour
// Types of results that are real places (cities, towns...), not streets or buildings.
const SETTLEMENTS = new Set(['city', 'town', 'municipality', 'village', 'state', 'province', 'region', 'county']);
// A box around the Philippines (west, south, east, north), so Photon only searches here.
const PH_BBOX = '116,4,127,21.5';
// Photon's place types we search when looking for a city.
const PHOTON_PLACE_LAYERS = ['city', 'county', 'state', 'district', 'locality'];

// Try the main API first. If it fails, try the backup.
// If both fail, report the main API's error.
async function withFallback(primary, fallback) {
  try { return await primary(); } catch (err) {
    try { return await fallback(); } catch { throw err; }
  }
}

// ---------- Main API: Nominatim search ----------
async function nominatimSearch(q, preferPlaces) {
  // countrycodes: 'ph' = only search the Philippines. limit: 5 = up to 5 results.
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: 5, addressdetails: 0, countrycodes: 'ph' });
  const rows = await fetchJson('Nominatim', url, { ttlMs: HOUR });
  // "Iligan City" is also the name of a STREET in Cavite, and Nominatim listed it first.
  // So when searching for a place, we move real cities/towns to the top of the list.
  const ranked = preferPlaces ? [...rows].sort((a, b) => SETTLEMENTS.has(b.addresstype) - SETTLEMENTS.has(a.addresstype)) : rows;
  // Keep only the name and the position.
  return ranked.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

// Builds a readable name from Photon's answer, e.g. "Iligan, Northern Mindanao, Philippines".
const photonLabel = (p) => [p.name, p.city !== p.name ? p.city : null, p.state, 'Philippines'].filter(Boolean).join(', ');

// ---------- Backup API: Photon search ----------
async function photonSearch(q, preferPlaces) {
  // Helper that calls Photon and keeps only results in the Philippines.
  const query = async (text, layers) => {
    const params = new URLSearchParams({ q: text, limit: 5, bbox: PH_BBOX });
    layers.forEach((l) => params.append('layer', l));
    const d = await fetchJson('Photon', 'https://photon.komoot.io/api/?' + params, { ttlMs: HOUR });
    return (d.features || []).filter((f) => f.properties?.countrycode === 'PH');
  };
  let rows = [];
  if (preferPlaces) {
    // Photon knows the city as "Iligan", not "Iligan City", so we remove the word "City",
    // search only city-type places, and put actual cities first.
    const bare = q.replace(/\b(city of|city)\b/gi, '').replace(/\s+/g, ' ').trim() || q;
    rows = (await query(bare, PHOTON_PLACE_LAYERS)).sort((a, b) => (b.properties.type === 'city') - (a.properties.type === 'city'));
  }
  // If that found nothing (or we're looking up a street address), do a normal search.
  if (!rows.length) rows = await query(q, []);
  // Photon gives [longitude, latitude]; we keep the name and the position.
  return rows.map((f) => ({ label: photonLabel(f.properties), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
}

// ---------- SEARCH: place name -> map position ----------
// preferPlaces = true for the map search box and user cities (show cities before streets).
async function geocode(q, { preferPlaces = false } = {}) {
  return withFallback(() => nominatimSearch(q, preferPlaces), () => photonSearch(q, preferPlaces));
}

// ---------- REVERSE: map position -> place name ("Use my location") ----------
async function reverseGeocode(lat, lon) {
  return withFallback(async () => {
    // Main: Nominatim. zoom: 10 = we want the city level, not the exact street.
    const url = 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: 10, addressdetails: 1 });
    const r = await fetchJson('Nominatim', url, { ttlMs: HOUR });
    const a = r.address || {};
    // Take the first one that exists: city, town, municipality... then the region.
    const place = a.city || a.town || a.municipality || a.village || a.county || r.name;
    const region = a.state || a.region || a.province;
    return { label: [place, region].filter(Boolean).join(', ') || r.display_name || null }; // "Iligan, Northern Mindanao"
  }, async () => {
    // Backup: Photon.
    const d = await fetchJson('Photon', 'https://photon.komoot.io/reverse?' + new URLSearchParams({ lat, lon }), { ttlMs: HOUR });
    const p = d.features?.[0]?.properties || {};
    return { label: [p.city || p.county || p.district || p.name, p.state].filter(Boolean).join(', ') || null };
  });
}

// "Try" version used when saving reports, centers and users:
// returns the best match, or null if nothing was found or both APIs failed.
// This way a search problem never stops the user from saving.
async function tryGeocode(q, opts) {
  try { return (await geocode(q, opts))[0] || null; } catch { return null; }
}

module.exports = { geocode, reverseGeocode, tryGeocode };
