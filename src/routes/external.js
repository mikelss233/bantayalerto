// =====================================================================
// EXTERNAL API ROUTES  (the addresses the browser calls: /api/external/...)
//
// WHAT IT DOES:
//   The browser never calls the outside APIs itself. It calls OUR server at
//   these addresses, and the server calls the APIs (the files in src/services/).
//
//   GET /api/external/weather  -> weather for a place
//   GET /api/external/quakes   -> earthquakes near a place
//   GET /api/external/events   -> NASA natural events
//   GET /api/external/geocode  -> search a place by name
//   GET /api/external/reverse  -> place name for a GPS position
//   GET /api/external/risk     -> ALL of the above combined + the risk score
//                                 (this is the one the Live Map uses)
//
// WHY THE SERVER CALLS THE APIs (not the browser):
//   - API keys stay secret on the server.
//   - One saved answer can be shared by every visitor (faster, fewer API calls).
//   - /risk combines 3 APIs into one answer.
// =====================================================================
const { Router } = require('express');
const { getWeather } = require('../services/weather');
const { getQuakes } = require('../services/quakes');
const { getEvents } = require('../services/eonet');
const { geocode, reverseGeocode } = require('../services/geocode');
const { assessRisk } = require('../services/risk');
const { HttpError, str, num, validCoords } = require('../util');

// Reads lat and lon from the address (e.g. ?lat=8.22&lon=124.24) and checks they are valid.
// Invalid -> error 400 ("bad request").
function coords(q) {
  const lat = num(q.lat), lon = num(q.lon);
  if (!validCoords(lat, lon)) throw new HttpError(400, 'Valid lat and lon are required');
  return { lat, lon };
}

// upstream(): if an outside API fails, send the browser a clear error (502 = "the API we
// depend on failed") with the real reason, instead of a vague "Something went wrong".
const upstream = async (p) => { try { return await p; } catch (e) { throw new HttpError(502, e.message); } };

// safe(): used by /risk. If one API fails, use an empty answer for it and remember the error,
// so the other APIs still show. One broken API removes one part of the page, not the whole page.
const safe = async (p, fallback) => { try { return { data: await p }; } catch (e) { return { data: fallback, error: e.message }; } };

module.exports = () => {
  const r = Router();

  // Weather for a place.
  r.get('/weather', async (req, res) => { const { lat, lon } = coords(req.query); res.json(await upstream(getWeather(lat, lon))); });

  // Earthquakes near a place (or the whole Philippines if no place is given).
  r.get('/quakes', async (req, res) => {
    const hasPos = req.query.lat !== undefined;
    const { lat, lon } = hasPos ? coords(req.query) : {};
    res.json(await upstream(getQuakes({ lat, lon, radiusKm: num(req.query.radius) || 500 })));
  });

  // NASA natural events (closest first if a place is given).
  r.get('/events', async (req, res) => {
    const hasPos = req.query.lat !== undefined;
    const { lat, lon } = hasPos ? coords(req.query) : {};
    res.json(await upstream(getEvents({ lat, lon })));
  });

  // Search a place by name (the Live Map search box). Needs at least 3 letters.
  r.get('/geocode', async (req, res) => {
    const q = str(req.query.q, 120);
    if (q.length < 3) throw new HttpError(400, 'Enter at least 3 characters');
    res.json(await upstream(geocode(q, { preferPlaces: true })));
  });

  // Place name for a GPS position ("Use my location").
  r.get('/reverse', async (req, res) => {
    const { lat, lon } = coords(req.query);
    res.json(await upstream(reverseGeocode(lat, lon)));
  });

  // THE MAIN ONE: everything the Live Map needs, in one answer.
  r.get('/risk', async (req, res) => {
    const { lat, lon } = coords(req.query);

    // Call the 3 APIs AT THE SAME TIME (Promise.all), so we wait only as long as
    // the slowest one, not all three added together.
    const [w, q, e] = await Promise.all([
      safe(getWeather(lat, lon), null),
      safe(getQuakes({ lat, lon, radiusKm: 300 }), []), // earthquakes within 300 km
      safe(getEvents({ lat, lon }), []),
    ]);
    const events = e.data.filter((x) => x.distanceKm <= 1500); // only show events within 1,500 km

    res.json({
      lat, lon,
      weather: w.data, quakes: q.data.slice(0, 10), events: events.slice(0, 10), // at most 10 of each
      risk: assessRisk({ weather: w.data, quakes: q.data, events }),            // the risk score (risk.js)
      // Which APIs worked (true) or failed (false). If any failed, the page shows
      // "Some data sources are temporarily unavailable".
      sources: { weather: !w.error, quakes: !q.error, events: !e.error },
      // The reason each failed API failed (useful for fixing problems).
      errors: Object.fromEntries([['weather', w.error], ['quakes', q.error], ['events', e.error]].filter(([, m]) => m)),
    });
  });

  return r;
};
