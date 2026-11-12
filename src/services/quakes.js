// =====================================================================
// EARTHQUAKE SERVICE  (API #2: USGS Earthquake Catalog)
//
// WHAT IT DOES:
//   Gets the earthquakes from the last 7 days near a place.
//
// WHERE THE DATA COMES FROM:
//   USGS (United States Geological Survey) keeps a free, worldwide list of
//   earthquakes, updated every few minutes. No API key needed.
//   https://earthquake.usgs.gov/fdsnws/event/1/
//
// WHERE IT IS USED:
//   - The "Recent earthquakes nearby" list and the red circles on the map
//   - The risk score (a strong earthquake close by makes the risk higher)
// =====================================================================
const { fetchJson } = require('./http');      // our helper for calling APIs
const { haversineKm } = require('../util');   // calculates the distance between two points on Earth

// lat/lon  = the place to search around (optional)
// radiusKm = how far around the place to search (default 500 km)
// days     = how many days back (default 7)
// minMag   = the smallest earthquake to include (default magnitude 2.5)
async function getQuakes({ lat, lon, radiusKm = 500, days = 7, minMag = 2.5 } = {}) {
  // Step 1: The start date (7 days ago), written as YYYY-MM-DD.
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  // Step 2: The search settings we send to USGS (newest first, at most 100 earthquakes).
  const p = { format: 'geojson', starttime: start, minmagnitude: minMag, orderby: 'time', limit: 100 };
  if (lat != null && lon != null) {
    // We have a place: search in a circle around it.
    Object.assign(p, { latitude: lat, longitude: lon, maxradiuskm: radiusKm });
  } else {
    // No place: search a box around the whole Philippines (magnitude 3 and up only).
    Object.assign(p, { minlatitude: 4, maxlatitude: 21.5, minlongitude: 116, maxlongitude: 127, minmagnitude: Math.max(minMag, 3) });
  }

  // Step 3: Call USGS.
  const d = await fetchJson('USGS Earthquake', 'https://earthquake.usgs.gov/fdsnws/event/1/query?' + new URLSearchParams(p));

  // Step 4: Keep only what we need from each earthquake, with simple names.
  return (d.features || []).map((f) => {
    const [qLon, qLat, depth] = f.geometry.coordinates; // USGS gives [longitude, latitude, depth]
    return {
      id: f.id,
      mag: f.properties.mag,       // magnitude (how strong it was)
      place: f.properties.place,   // e.g. "18 km WNW of Bantogon, Philippines"
      time: f.properties.time,     // when it happened
      url: f.properties.url,       // link to the USGS page for this earthquake
      depthKm: depth,
      lat: qLat, lon: qLon,
      // How far the earthquake is from the user's place, in km (the risk score uses this).
      distanceKm: lat != null && lon != null ? Math.round(haversineKm(lat, lon, qLat, qLon)) : null,
    };
  });
}

module.exports = { getQuakes };
