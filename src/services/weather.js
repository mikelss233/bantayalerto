// Weather service (API 1): current weather + 3-day forecast for a location.
// Main: Open-Meteo. Backup: MET Norway (used when Open-Meteo refuses Render's shared IP).
// Both return the same object shape, so the rest of the app doesn't care which answered.
const { fetchJson } = require('./http'); // shared caller: timeout, cache, logging

// Weather code -> words (e.g. 63 = Rain). Codes 95+ are thunderstorms (adds risk points).
const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

// --- Main provider: Open-Meteo (free, no key) ---
async function getOpenMeteo(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat, longitude: lon,
    timezone: 'auto',   // dates in the location's local time
    forecast_days: 3,
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m', // right now
    daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max',                           // per day
  });
  const d = await fetchJson('Open-Meteo', url); // throws on failure -> backup is tried
  const c = d.current || {};

  // Rename fields to our own simple names (units: °C, %, mm, km/h).
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    precipitation: c.precipitation,
    windSpeed: c.wind_speed_10m,
    windGusts: c.wind_gusts_10m,
    code: c.weather_code,
    description: CODES[c.weather_code] || 'Unknown',
    source: 'Open-Meteo',
    // Daily values come as separate lists; combine them into one object per day.
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],
      rainChance: d.daily.precipitation_probability_max[i],
      windMax: d.daily.wind_speed_10m_max[i],
    })),
  };
}

// --- Backup provider: MET Norway (free, no key, but must send a User-Agent) ---

// MET uses words for the sky (e.g. "heavyrainandthunder"); convert them to the same codes.
// First match wins, so "heavyrain" comes before "rain" and "partlycloudy" before "cloudy".
const MET_CODES = [['thunder', 95], ['heavyrain', 65], ['lightrain', 61], ['rain', 63], ['sleet', 61], ['snow', 61], ['fog', 45], ['partlycloudy', 2], ['cloudy', 3], ['fair', 1], ['clearsky', 0]];
const metCode = (sym = '') => (MET_CODES.find(([k]) => sym.includes(k)) || [null, null])[1];

async function getMetNo(lat, lon) {
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  const d = await fetchJson('MET Norway', url, { headers: { 'User-Agent': 'BantayAlerto/1.0 github.com/mikelss233/bantayalerto' } });

  // A list of time steps (hourly, then every 6 hours). The first step is "now".
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway returned no data');
  const now = series[0].data;

  const kmh = (ms) => (ms == null ? null : Math.round(ms * 36) / 10); // m/s -> km/h, 1 decimal
  const code = metCode(now.next_1_hours?.summary?.symbol_code || now.next_6_hours?.summary?.symbol_code);

  // Group time steps into local days. Times are UTC; shift by ~1 hour per 15° longitude (PH ≈ +8h).
  const offsetMs = Math.round(lon / 15) * 3600e3;
  const days = new Map();
  for (const t of series) {
    const date = new Date(Date.parse(t.time) + offsetMs).toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const day = days.get(date) || { date, rainMm: 0, rainChance: null, windMax: 0 }; // no rain-chance data from MET
    day.rainMm += t.data.next_1_hours?.details?.precipitation_amount ?? t.data.next_6_hours?.details?.precipitation_amount ?? 0; // total rain
    day.windMax = Math.max(day.windMax, kmh(t.data.instant.details.wind_speed) || 0);                                          // strongest wind
    days.set(date, day);
  }

  // Same shape as getOpenMeteo().
  const i = now.instant.details;
  return {
    temperature: i.air_temperature,
    humidity: i.relative_humidity,
    precipitation: now.next_1_hours?.details?.precipitation_amount ?? 0,
    windSpeed: kmh(i.wind_speed),
    windGusts: kmh(i.wind_speed_of_gust), // often missing -> hidden on screen
    code,
    description: CODES[code] || 'Unknown',
    source: 'MET Norway',
    forecast: [...days.values()].slice(0, 3).map((f) => ({ ...f, rainMm: Math.round(f.rainMm * 10) / 10 })),
  };
}

// Used by the rest of the app: try Open-Meteo, then MET Norway.
// If both fail, throw Open-Meteo's error (the page shows "Weather unavailable").
async function getWeather(lat, lon) {
  try { return await getOpenMeteo(lat, lon); } catch (primary) {
    try { return await getMetNo(lat, lon); } catch { throw primary; }
  }
}

module.exports = { getWeather };
