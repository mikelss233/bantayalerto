// API 4: Nominatim (OpenStreetMap geocoding, no key required) - max 1 req/sec, so results are cached.
const { fetchJson } = require('./http');

const SETTLEMENTS = new Set(['city', 'town', 'municipality', 'village', 'state', 'province', 'region', 'county']);

// preferPlaces: for the map search box, rank cities/towns above streets that merely share the name
// (e.g. "Iligan City" is also a street in Cavite).
async function geocode(q, { preferPlaces = false } = {}) {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: 5, addressdetails: 0, countrycodes: 'ph' });
  const rows = await fetchJson('Nominatim', url, { ttlMs: 60 * 60 * 1000 });
  const ranked = preferPlaces ? [...rows].sort((a, b) => SETTLEMENTS.has(b.addresstype) - SETTLEMENTS.has(a.addresstype)) : rows;
  return ranked.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

// Coordinates -> a short place name such as "Iligan City, Lanao del Norte".
async function reverseGeocode(lat, lon) {
  const url = 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: 10, addressdetails: 1 });
  const r = await fetchJson('Nominatim', url, { ttlMs: 60 * 60 * 1000 });
  const a = r.address || {};
  const place = a.city || a.town || a.municipality || a.village || a.county || r.name;
  const region = a.state || a.region || a.province;
  return { label: [place, region].filter(Boolean).join(', ') || r.display_name || null };
}

// Best-effort: never lets a geocoding failure block a save.
async function tryGeocode(q, opts) {
  try { return (await geocode(q, opts))[0] || null; } catch { return null; }
}

module.exports = { geocode, reverseGeocode, tryGeocode };
