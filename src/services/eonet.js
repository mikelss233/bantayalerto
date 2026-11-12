// =====================================================================
// NATURAL EVENTS SERVICE  (API #3: NASA EONET)
//
// WHAT IT DOES:
//   Gets the natural events happening right now around the world:
//   storms/typhoons, floods, volcanoes and wildfires.
//
// WHERE THE DATA COMES FROM:
//   NASA EONET (Earth Observatory Natural Event Tracker). NASA tracks these
//   events with satellites. Free, no API key needed.
//
// WHERE IT IS USED:
//   - The "Active natural events" list and the orange circles on the map
//   - The risk score (a storm, flood or volcano within 300 km makes the risk higher)
// =====================================================================
const { fetchJson } = require('./http');      // our helper for calling APIs
const { haversineKm } = require('../util');   // calculates the distance between two points on Earth

// lat/lon = the user's place (optional), days = how many days back (default 30)
async function getEvents({ lat, lon, days = 30 } = {}) {
  // Step 1: Ask NASA for all events that are still active ("open") from the last 30 days.
  const d = await fetchJson('NASA EONET', `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${days}&limit=100`);

  // Step 2: Keep only what we need from each event.
  const out = [];
  for (const e of d.events || []) {
    // An event can have many positions over time (a typhoon moves).
    // We want the LATEST one, so we reverse the list and take the first point.
    const g = [...(e.geometry || [])].reverse().find((x) => x.type === 'Point');
    if (!g) continue; // skip events that have no point on the map
    const [eLon, eLat] = g.coordinates; // NASA gives [longitude, latitude]
    out.push({
      id: e.id,
      title: e.title,                                       // e.g. "Typhoon Champi"
      category: e.categories?.[0]?.id || 'other',           // e.g. "severeStorms" (the risk score uses this)
      categoryTitle: e.categories?.[0]?.title || 'Event',   // e.g. "Severe Storms" (shown on screen)
      date: g.date, lat: eLat, lon: eLon, link: e.link,
      // How far the event is from the user's place, in km.
      distanceKm: lat != null && lon != null ? Math.round(haversineKm(lat, lon, eLat, eLon)) : null,
    });
  }

  // Step 3: If we know the user's place, put the closest events first.
  return lat != null && lon != null ? out.sort((a, b) => a.distanceKm - b.distanceKm) : out;
}

module.exports = { getEvents };
