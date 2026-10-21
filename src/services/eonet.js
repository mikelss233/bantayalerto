// API 3: NASA EONET - open natural events: storms, floods, volcanoes, wildfires (no key required)
const { fetchJson } = require('./http');
const { haversineKm } = require('../util');

async function getEvents({ lat, lon, days = 30 } = {}) {
  const d = await fetchJson('NASA EONET', `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${days}&limit=100`);
  const out = [];
  for (const e of d.events || []) {
    const g = [...(e.geometry || [])].reverse().find((x) => x.type === 'Point');
    if (!g) continue;
    const [eLon, eLat] = g.coordinates;
    out.push({
      id: e.id, title: e.title, category: e.categories?.[0]?.id || 'other', categoryTitle: e.categories?.[0]?.title || 'Event',
      date: g.date, lat: eLat, lon: eLon, link: e.link,
      distanceKm: lat != null && lon != null ? Math.round(haversineKm(lat, lon, eLat, eLon)) : null,
    });
  }
  return lat != null && lon != null ? out.sort((a, b) => a.distanceKm - b.distanceKm) : out;
}

module.exports = { getEvents };
