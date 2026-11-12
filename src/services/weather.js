// ============================================================================
// WEATHER SERVICE (API 1)
// ----------------------------------------------------------------------------
// Gets the current weather + a 3-day forecast for one location (lat/lon).
//
// Two providers, both free and with no API key:
//   1. Open-Meteo  (main)      https://open-meteo.com
//   2. MET Norway  (fallback)  https://api.met.no
//
// Why two? On Render's free plan many apps share one internet address, and
// Open-Meteo sometimes refuses it ("too many requests"). When that happens we
// ask MET Norway instead, so the map still shows weather.
//
// Both functions return the SAME shape of object, so the rest of the app
// (risk score, weather card, report snapshot) doesn't care which one answered:
//   { temperature, humidity, precipitation, windSpeed, windGusts,
//     code, description, source, forecast: [{ date, rainMm, rainChance, windMax }] }
//
// Used by: src/routes/external.js (/api/external/weather and /risk)
//          src/routes/reports.js  (weather snapshot saved with each report)
// ============================================================================

// fetchJson is our shared helper for calling outside APIs (src/services/http.js).
// It adds an 8-second timeout, a 5-minute cache, logging for the admin
// dashboard, and skips a service for 60 s after it fails.
const { fetchJson } = require('./http');

// Weather codes -> readable words.
// Open-Meteo describes the sky with a number (the international "WMO" code),
// e.g. 63 = "Rain". The risk engine also uses these numbers: 95 and up means
// a thunderstorm, which adds points to the risk score.
const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

// ----------------------------------------------------------------------------
// PROVIDER 1: Open-Meteo
// ----------------------------------------------------------------------------
async function getOpenMeteo(lat, lon) {
  // Build the request URL. URLSearchParams turns the object into
  // "?latitude=8.22&longitude=124.24&..." and safely encodes the values.
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat, longitude: lon,
    timezone: 'auto',   // dates come back in the location's own time zone (Philippine time)
    forecast_days: 3,   // today + the next 2 days
    // "current" = what it is like right now (units: °C, %, mm, km/h)
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    // "daily" = one value per day: total rain, chance of rain, strongest wind
    daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
  });

  // Call the API. If it fails or times out, this throws an error and
  // getWeather() below switches to MET Norway.
  const d = await fetchJson('Open-Meteo', url);
  const c = d.current || {};

  // Rename Open-Meteo's field names into our app's own simpler names.
  return {
    temperature: c.temperature_2m,          // °C, measured 2 m above the ground
    humidity: c.relative_humidity_2m,       // %
    precipitation: c.precipitation,         // mm of rain right now
    windSpeed: c.wind_speed_10m,            // km/h, measured 10 m above the ground
    windGusts: c.wind_gusts_10m,            // km/h, short strongest bursts
    code: c.weather_code,                   // WMO number (see CODES above)
    description: CODES[c.weather_code] || 'Unknown',
    source: 'Open-Meteo',                   // shown on the weather card ("via Open-Meteo")
    // Open-Meteo sends each daily value as a separate list
    //   time: ['2026-11-13', '2026-11-14', ...], precipitation_sum: [0.1, 3.7, ...]
    // so we zip them together into one object per day.
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],               // total rain that day (mm)
      rainChance: d.daily.precipitation_probability_max[i], // highest chance of rain that day (%)
      windMax: d.daily.wind_speed_10m_max[i],             // strongest wind that day (km/h)
    })),
  };
}

// ----------------------------------------------------------------------------
// PROVIDER 2 (fallback): MET Norway
// ----------------------------------------------------------------------------
// MET Norway is the Norwegian weather service; its free API covers the whole
// world. It has no key, but its rules require every app to identify itself
// with a "User-Agent" header (see getMetNo below).

// MET Norway describes the sky with words like "heavyrainandthunder" or
// "partlycloudy_day" instead of numbers. This list turns those words into the
// same WMO numbers Open-Meteo uses, so the risk engine treats both the same.
// ORDER MATTERS: we take the FIRST match, so "heavyrain" must come before
// "rain", and "partlycloudy" before "cloudy".
const MET_CODES = [['thunder', 95], ['heavyrain', 65], ['lightrain', 61], ['rain', 63], ['sleet', 61], ['snow', 61], ['fog', 45], ['partlycloudy', 2], ['cloudy', 3], ['fair', 1], ['clearsky', 0]];
// e.g. metCode('heavyrainandthunder') -> 95,  metCode('partlycloudy_day') -> 2
const metCode = (sym = '') => (MET_CODES.find(([k]) => sym.includes(k)) || [null, null])[1];

async function getMetNo(lat, lon) {
  // MET Norway asks for at most 4 decimal places in coordinates.
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  const d = await fetchJson('MET Norway', url, { headers: { 'User-Agent': 'BantayAlerto/1.0 github.com/mikelss233/bantayalerto' } });

  // The answer is a "timeseries": a long list of time steps, hourly for the
  // first ~2.5 days and every 6 hours after that. Each step has:
  //   instant      -> conditions at that moment (temperature, wind, ...)
  //   next_1_hours -> rain expected in the next hour + a sky symbol
  //   next_6_hours -> the same for the next 6 hours
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway returned no data');

  const now = series[0].data; // the first step is "right now"

  // MET Norway gives wind in metres per second; our app uses km/h.
  // 1 m/s = 3.6 km/h. (ms * 36) / 10 rounds the result to 1 decimal place.
  const kmh = (ms) => (ms == null ? null : Math.round(ms * 36) / 10);

  // Sky symbol for the next hour (or the next 6 hours if hourly is missing) -> WMO number.
  const code = metCode(now.next_1_hours?.summary?.symbol_code || now.next_6_hours?.summary?.symbol_code);

  // Build a daily forecast out of the time steps.
  // MET Norway's times are in UTC. To find which LOCAL day a step belongs to,
  // we shift it by the location's time zone, estimated from its longitude:
  // every 15° east of Greenwich is +1 hour (Philippines ≈ 120° E -> +8 hours).
  const offsetMs = Math.round(lon / 15) * 3600e3;
  const days = new Map(); // '2026-11-13' -> { date, rainMm, rainChance, windMax }
  for (const t of series) {
    const date = new Date(Date.parse(t.time) + offsetMs).toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const day = days.get(date) || { date, rainMm: 0, rainChance: null, windMax: 0 };
    // Add up the rain for that day (use the 1-hour amount, or the 6-hour amount for later steps).
    day.rainMm += t.data.next_1_hours?.details?.precipitation_amount ?? t.data.next_6_hours?.details?.precipitation_amount ?? 0;
    // Keep the strongest wind seen that day.
    day.windMax = Math.max(day.windMax, kmh(t.data.instant.details.wind_speed) || 0);
    days.set(date, day);
  }
  // rainChance stays null: this free MET endpoint doesn't give a chance of rain.
  // The weather table shows "—" in that column when MET Norway answered.

  const i = now.instant.details;
  // Same shape as getOpenMeteo() returns, so the rest of the app can't tell the difference.
  return {
    temperature: i.air_temperature,
    humidity: i.relative_humidity,
    precipitation: now.next_1_hours?.details?.precipitation_amount ?? 0,
    windSpeed: kmh(i.wind_speed),
    windGusts: kmh(i.wind_speed_of_gust), // usually not in the compact data -> null, hidden on screen
    code,
    description: CODES[code] || 'Unknown',
    source: 'MET Norway',
    // First 3 days only, with rain rounded to 1 decimal place.
    forecast: [...days.values()].slice(0, 3).map((f) => ({ ...f, rainMm: Math.round(f.rainMm * 10) / 10 })),
  };
}

// ----------------------------------------------------------------------------
// The only function other files use.
// Try Open-Meteo first; if it fails, try MET Norway. If BOTH fail, report
// Open-Meteo's error (the main provider). The /risk endpoint then still works
// without weather and the page shows "Weather unavailable".
// ----------------------------------------------------------------------------
async function getWeather(lat, lon) {
  try { return await getOpenMeteo(lat, lon); } catch (primary) {
    try { return await getMetNo(lat, lon); } catch { throw primary; }
  }
}

module.exports = { getWeather };
