// API 4: Nominatim (OpenStreetMap geocoding, no key required) - max 1 req/sec, so results are cached.
const { fetchJson } = require('./http');

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: 5, addressdetails: 0 });
  const rows = await fetchJson('Nominatim', url, { ttlMs: 60 * 60 * 1000 });
  return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

// Best-effort: never lets a geocoding failure block a save.
async function tryGeocode(q) {
  try { return (await geocode(q))[0] || null; } catch { return null; }
}

module.exports = { geocode, tryGeocode };
