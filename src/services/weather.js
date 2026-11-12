// =====================================================================
// WEATHER SERVICE  (API #1)
//
// WHAT IT DOES:
//   Gets the weather for any place (using its latitude and longitude):
//   the weather right now, plus a forecast for the next 3 days.
//
// WHERE THE WEATHER COMES FROM:
//   1. Open-Meteo  - our main weather API (free, no API key needed)
//   2. MET Norway  - our backup weather API (also free, no key)
//
// WHY WE HAVE A BACKUP:
//   Our website is hosted on Render's free plan, where many websites share
//   the same internet address. Open-Meteo sometimes blocks that address
//   because it gets too many requests. When that happens, we ask MET Norway
//   instead, so the user still sees the weather.
//
// WHERE THE WEATHER IS USED:
//   - The weather card on the Live Map page
//   - The risk score (heavy rain and strong wind make the risk higher)
//   - Incident reports (we save the weather at the moment a report is filed)
// =====================================================================

// fetchJson is our own helper for calling outside APIs (in http.js).
// It stops waiting after 8 seconds, remembers answers for 5 minutes,
// and records every call for the admin dashboard's "API health" table.
const { fetchJson } = require('./http');

// Weather APIs describe the sky with a number instead of words.
// This list turns the number into words we can show on the screen.
// Example: 63 = "Rain". Numbers 95 and above are thunderstorms.
const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

// =====================================================================
// MAIN API: Open-Meteo
// We send the location, and Open-Meteo sends back the weather.
// =====================================================================
async function getOpenMeteo(lat, lon) {
  // Step 1: Build the web address (URL) we will request.
  // It includes the location and the list of weather details we want.
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat, longitude: lon,
    timezone: 'auto',   // show dates in the place's own time (Philippine time)
    forecast_days: 3,   // today and the next 2 days
    // Weather RIGHT NOW: temperature, humidity, rain, weather number, wind, wind gusts
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    // Weather PER DAY: total rain, chance of rain, strongest wind
    daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
  });

  // Step 2: Send the request and wait for the answer.
  // If Open-Meteo fails, an error happens here and we switch to MET Norway (see the bottom).
  const d = await fetchJson('Open-Meteo', url);
  const c = d.current || {};

  // Step 3: Copy the answer into our own simple format.
  // Open-Meteo uses long names like "temperature_2m"; we use short names like "temperature".
  return {
    temperature: c.temperature_2m,      // in °C
    humidity: c.relative_humidity_2m,   // in %
    precipitation: c.precipitation,     // rain right now, in mm
    windSpeed: c.wind_speed_10m,        // in km/h
    windGusts: c.wind_gusts_10m,        // short, strongest bursts of wind, in km/h
    code: c.weather_code,               // the weather number
    description: CODES[c.weather_code] || 'Unknown', // the weather number in words
    source: 'Open-Meteo',               // which API answered (shown on the weather card)
    // The 3-day forecast: one entry per day.
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],               // total rain that day, in mm
      rainChance: d.daily.precipitation_probability_max[i], // chance of rain, in %
      windMax: d.daily.wind_speed_10m_max[i],             // strongest wind that day, in km/h
    })),
  };
}

// =====================================================================
// BACKUP API: MET Norway (the weather service of Norway; covers the whole world)
// Only used when Open-Meteo fails.
// =====================================================================

// MET Norway describes the sky with words (like "heavyrain") instead of numbers.
// This list changes those words into the same numbers Open-Meteo uses,
// so the rest of our app can treat both APIs the same way.
const MET_CODES = [['thunder', 95], ['heavyrain', 65], ['lightrain', 61], ['rain', 63], ['sleet', 61], ['snow', 61], ['fog', 45], ['partlycloudy', 2], ['cloudy', 3], ['fair', 1], ['clearsky', 0]];
const metCode = (sym = '') => (MET_CODES.find(([k]) => sym.includes(k)) || [null, null])[1];

async function getMetNo(lat, lon) {
  // Step 1: Build the web address with the location.
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });

  // Step 2: Send the request. MET Norway's rules say every app must
  // introduce itself (the "User-Agent"), so we send our app's name.
  const d = await fetchJson('MET Norway', url, { headers: { 'User-Agent': 'BantayAlerto/1.0 github.com/mikelss233/bantayalerto' } });

  // MET Norway sends a long list of times (hour by hour).
  // The first item in the list is the weather right now.
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway returned no data');
  const now = series[0].data;

  // MET Norway measures wind in meters per second; our app uses km/h.
  // (1 m/s = 3.6 km/h)
  const kmh = (ms) => (ms == null ? null : Math.round(ms * 36) / 10);

  // Turn MET Norway's sky word into our weather number.
  const code = metCode(now.next_1_hours?.summary?.symbol_code || now.next_6_hours?.summary?.symbol_code);

  // Step 3: Build the 3-day forecast.
  // MET Norway gives us hours, not days, so we group the hours by day:
  // we add up the rain and keep the strongest wind for each day.
  // Its times are in world time (UTC), so we first change them to the
  // place's local time (the Philippines is 8 hours ahead).
  const offsetMs = Math.round(lon / 15) * 3600e3;
  const days = new Map();
  for (const t of series) {
    const date = new Date(Date.parse(t.time) + offsetMs).toISOString().slice(0, 10);
    const day = days.get(date) || { date, rainMm: 0, rainChance: null, windMax: 0 }; // MET Norway doesn't give a chance of rain
    day.rainMm += t.data.next_1_hours?.details?.precipitation_amount ?? t.data.next_6_hours?.details?.precipitation_amount ?? 0;
    day.windMax = Math.max(day.windMax, kmh(t.data.instant.details.wind_speed) || 0);
    days.set(date, day);
  }

  // Step 4: Return the weather in the SAME format as Open-Meteo,
  // so the rest of the app works the same no matter which API answered.
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
    forecast: [...days.values()].slice(0, 3).map((f) => ({ ...f, rainMm: Math.round(f.rainMm * 10) / 10 })), // only 3 days
  };
}

// =====================================================================
// THE FUNCTION THE REST OF THE APP USES
// 1. Try Open-Meteo.
// 2. If Open-Meteo fails, try MET Norway.
// 3. If both fail, report the error. The page then shows "Weather unavailable",
//    but the rest of the page (earthquakes, events, risk) still works.
// =====================================================================
async function getWeather(lat, lon) {
  try { return await getOpenMeteo(lat, lon); } catch (primary) {
    try { return await getMetNo(lat, lon); } catch { throw primary; }
  }
}

module.exports = { getWeather };
