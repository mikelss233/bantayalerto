const { Router } = require('express');
const { getWeather } = require('../services/weather');
const { getQuakes } = require('../services/quakes');
const { getEvents } = require('../services/eonet');
const { geocode, reverseGeocode } = require('../services/geocode');
const { assessRisk } = require('../services/risk');
const { HttpError, str, num, validCoords } = require('../util');

function coords(q) {
  const lat = num(q.lat), lon = num(q.lon);
  if (!validCoords(lat, lon)) throw new HttpError(400, 'Valid lat and lon are required');
  return { lat, lon };
}

// Each upstream call is wrapped so one failing API degrades gracefully instead of breaking the page.
// Upstream failures reach the browser as a readable 502 instead of a generic 500.
const upstream = async (p) => { try { return await p; } catch (e) { throw new HttpError(502, e.message); } };
const safe = async (p, fallback) => { try { return { data: await p }; } catch (e) { return { data: fallback, error: e.message }; } };

module.exports = () => {
  const r = Router();

  r.get('/weather', async (req, res) => { const { lat, lon } = coords(req.query); res.json(await upstream(getWeather(lat, lon))); });

  r.get('/quakes', async (req, res) => {
    const hasPos = req.query.lat !== undefined;
    const { lat, lon } = hasPos ? coords(req.query) : {};
    res.json(await upstream(getQuakes({ lat, lon, radiusKm: num(req.query.radius) || 500 })));
  });

  r.get('/events', async (req, res) => {
    const hasPos = req.query.lat !== undefined;
    const { lat, lon } = hasPos ? coords(req.query) : {};
    res.json(await upstream(getEvents({ lat, lon })));
  });

  r.get('/geocode', async (req, res) => {
    const q = str(req.query.q, 120);
    if (q.length < 3) throw new HttpError(400, 'Enter at least 3 characters');
    res.json(await upstream(geocode(q, { preferPlaces: true })));
  });

  r.get('/reverse', async (req, res) => {
    const { lat, lon } = coords(req.query);
    res.json(await upstream(reverseGeocode(lat, lon)));
  });

  // Combined, explainable risk assessment for a location.
  r.get('/risk', async (req, res) => {
    const { lat, lon } = coords(req.query);
    const [w, q, e] = await Promise.all([
      safe(getWeather(lat, lon), null),
      safe(getQuakes({ lat, lon, radiusKm: 300 }), []),
      safe(getEvents({ lat, lon }), []),
    ]);
    const events = e.data.filter((x) => x.distanceKm <= 1500);
    res.json({
      lat, lon,
      weather: w.data, quakes: q.data.slice(0, 10), events: events.slice(0, 10),
      risk: assessRisk({ weather: w.data, quakes: q.data, events }),
      sources: { weather: !w.error, quakes: !q.error, events: !e.error },
      errors: Object.fromEntries([['weather', w.error], ['quakes', q.error], ['events', e.error]].filter(([, m]) => m)),
    });
  });

  return r;
};
