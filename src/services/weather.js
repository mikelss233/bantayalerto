// Gets the weather for a place: the weather now + the next 3 days.
// First we ask Open-Meteo. If it doesn't answer, we ask MET Norway instead.
const { fetchJson } = require('./http'); // helper that calls outside websites

// Turns a weather number into words. Example: 63 means "Rain".
const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

// ---------- Option 1: Open-Meteo ----------
async function getOpenMeteo(lat, lon) {
  // The web address we call, with the place and the details we want.
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat, longitude: lon,
    timezone: 'auto',   // use the place's own time
    forecast_days: 3,   // today + 2 more days
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m', // weather now
    daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max',                           // weather per day
  });
  const d = await fetchJson('Open-Meteo', url); // ask Open-Meteo
  const c = d.current || {};

  // Give the answer simple names.
  return {
    temperature: c.temperature_2m,      // °C
    humidity: c.relative_humidity_2m,   // %
    precipitation: c.precipitation,     // rain now, in mm
    windSpeed: c.wind_speed_10m,        // km/h
    windGusts: c.wind_gusts_10m,        // strongest wind bursts, km/h
    code: c.weather_code,
    description: CODES[c.weather_code] || 'Unknown',
    source: 'Open-Meteo',
    // One row per day.
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],               // total rain that day
      rainChance: d.daily.precipitation_probability_max[i], // chance of rain (%)
      windMax: d.daily.wind_speed_10m_max[i],             // strongest wind that day
    })),
  };
}

// ---------- Option 2 (backup): MET Norway ----------

// MET Norway uses words like "heavyrain" instead of numbers.
// This list changes those words into the same numbers as above.
const MET_CODES = [['thunder', 95], ['heavyrain', 65], ['lightrain', 61], ['rain', 63], ['sleet', 61], ['snow', 61], ['fog', 45], ['partlycloudy', 2], ['cloudy', 3], ['fair', 1], ['clearsky', 0]];
const metCode = (sym = '') => (MET_CODES.find(([k]) => sym.includes(k)) || [null, null])[1];

async function getMetNo(lat, lon) {
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  // MET Norway requires us to say who we are.
  const d = await fetchJson('MET Norway', url, { headers: { 'User-Agent': 'BantayAlerto/1.0 github.com/mikelss233/bantayalerto' } });

  // MET Norway sends a list of hours. The first one is "now".
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway returned no data');
  const now = series[0].data;

  const kmh = (ms) => (ms == null ? null : Math.round(ms * 36) / 10); // change wind from m/s to km/h
  const code = metCode(now.next_1_hours?.summary?.symbol_code || now.next_6_hours?.summary?.symbol_code);

  // Put the hours into days, adding up the rain and keeping the strongest wind.
  // (The times are in world time, so we move them to the place's local time first.)
  const offsetMs = Math.round(lon / 15) * 3600e3;
  const days = new Map();
  for (const t of series) {
    const date = new Date(Date.parse(t.time) + offsetMs).toISOString().slice(0, 10);
    const day = days.get(date) || { date, rainMm: 0, rainChance: null, windMax: 0 }; // MET Norway has no chance of rain
    day.rainMm += t.data.next_1_hours?.details?.precipitation_amount ?? t.data.next_6_hours?.details?.precipitation_amount ?? 0;
    day.windMax = Math.max(day.windMax, kmh(t.data.instant.details.wind_speed) || 0);
    days.set(date, day);
  }

  // Same simple names as Open-Meteo, so the app works the same with either one.
  const i = now.instant.details;
  return {
    temperature: i.air_temperature,
    humidity: i.relative_humidity,
    precipitation: now.next_1_hours?.details?.precipitation_amount ?? 0,
    windSpeed: kmh(i.wind_speed),
    windGusts: kmh(i.wind_speed_of_gust),
    code,
    description: CODES[code] || 'Unknown',
    source: 'MET Norway',
    forecast: [...days.values()].slice(0, 3).map((f) => ({ ...f, rainMm: Math.round(f.rainMm * 10) / 10 })), // first 3 days
  };
}

// The rest of the app calls this one.
// Try Open-Meteo first. If it fails, try MET Norway.
async function getWeather(lat, lon) {
  try { return await getOpenMeteo(lat, lon); } catch (primary) {
    try { return await getMetNo(lat, lon); } catch { throw primary; }
  }
}

module.exports = { getWeather };
