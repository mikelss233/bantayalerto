// API 2: USGS Earthquake Catalog (no key required) - https://earthquake.usgs.gov/fdsnws/event/1/
const { fetchJson } = require('./http');
const { haversineKm } = require('../util');

async function getQuakes({ lat, lon, radiusKm = 500, days = 7, minMag = 2.5 } = {}) {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const p = { format: 'geojson', starttime: start, minmagnitude: minMag, orderby: 'time', limit: 100 };
  if (lat != null && lon != null) Object.assign(p, { latitude: lat, longitude: lon, maxradiuskm: radiusKm });
  else Object.assign(p, { minlatitude: 4, maxlatitude: 21.5, minlongitude: 116, maxlongitude: 127, minmagnitude: Math.max(minMag, 3) }); // Philippine region

  const d = await fetchJson('USGS Earthquake', 'https://earthquake.usgs.gov/fdsnws/event/1/query?' + new URLSearchParams(p));
  return (d.features || []).map((f) => {
    const [qLon, qLat, depth] = f.geometry.coordinates;
    return {
      id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
      url: f.properties.url, depthKm: depth, lat: qLat, lon: qLon,
      distanceKm: lat != null && lon != null ? Math.round(haversineKm(lat, lon, qLat, qLon)) : null,
    };
  });
}

module.exports = { getQuakes };
