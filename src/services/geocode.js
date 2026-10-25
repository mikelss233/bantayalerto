// API 4: Nominatim (OpenStreetMap geocoding, no key required) - max 1 req/sec, so results are cached.
// Fallback: Photon by komoot (same OpenStreetMap data, no key) - Nominatim answers 429 to shared
// cloud IPs such as Render's free tier, so lookups switch providers instead of failing.
const { fetchJson } = require('./http');

const HOUR = 60 * 60 * 1000;
const SETTLEMENTS = new Set(['city', 'town', 'municipality', 'village', 'state', 'province', 'region', 'county']);
const PH_BBOX = '116,4,127,21.5';
const PHOTON_PLACE_LAYERS = ['city', 'county', 'state', 'district', 'locality'];

// Try the primary provider, then the fallback; if both fail, report the primary's error.
async function withFallback(primary, fallback) {
  try { return await primary(); } catch (err) {
    try { return await fallback(); } catch { throw err; }
  }
}

async function nominatimSearch(q, preferPlaces) {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: 5, addressdetails: 0, countrycodes: 'ph' });
  const rows = await fetchJson('Nominatim', url, { ttlMs: HOUR });
  const ranked = preferPlaces ? [...rows].sort((a, b) => SETTLEMENTS.has(b.addresstype) - SETTLEMENTS.has(a.addresstype)) : rows;
  return ranked.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

const photonLabel = (p) => [p.name, p.city !== p.name ? p.city : null, p.state, 'Philippines'].filter(Boolean).join(', ');

async function photonSearch(q, preferPlaces) {
  const query = async (text, layers) => {
    const params = new URLSearchParams({ q: text, limit: 5, bbox: PH_BBOX });
    layers.forEach((l) => params.append('layer', l));
    const d = await fetchJson('Photon', 'https://photon.komoot.io/api/?' + params, { ttlMs: HOUR });
    return (d.features || []).filter((f) => f.properties?.countrycode === 'PH');
  };
  let rows = [];
  if (preferPlaces) {
    // Photon indexes "Iligan", not "Iligan City", so drop the suffix and rank actual cities first.
    const bare = q.replace(/\b(city of|city)\b/gi, '').replace(/\s+/g, ' ').trim() || q;
    rows = (await query(bare, PHOTON_PLACE_LAYERS)).sort((a, b) => (b.properties.type === 'city') - (a.properties.type === 'city'));
  }
  if (!rows.length) rows = await query(q, []);
  return rows.map((f) => ({ label: photonLabel(f.properties), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
}

// preferPlaces: for the map search box and user cities, rank cities/towns above streets that merely
// share the name (e.g. "Iligan City" is also a street in Cavite).
async function geocode(q, { preferPlaces = false } = {}) {
  return withFallback(() => nominatimSearch(q, preferPlaces), () => photonSearch(q, preferPlaces));
}

// Coordinates -> a short place name such as "Iligan, Northern Mindanao".
async function reverseGeocode(lat, lon) {
  return withFallback(async () => {
    const url = 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: 10, addressdetails: 1 });
    const r = await fetchJson('Nominatim', url, { ttlMs: HOUR });
    const a = r.address || {};
    const place = a.city || a.town || a.municipality || a.village || a.county || r.name;
    const region = a.state || a.region || a.province;
    return { label: [place, region].filter(Boolean).join(', ') || r.display_name || null };
  }, async () => {
    const d = await fetchJson('Photon', 'https://photon.komoot.io/reverse?' + new URLSearchParams({ lat, lon }), { ttlMs: HOUR });
    const p = d.features?.[0]?.properties || {};
    return { label: [p.city || p.county || p.district || p.name, p.state].filter(Boolean).join(', ') || null };
  });
}

// Best-effort: never lets a geocoding failure block a save.
async function tryGeocode(q, opts) {
  try { return (await geocode(q, opts))[0] || null; } catch { return null; }
}

module.exports = { geocode, reverseGeocode, tryGeocode };
