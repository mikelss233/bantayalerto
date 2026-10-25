// API 1: Open-Meteo (no key required) - https://open-meteo.com
const { fetchJson } = require('./http');

const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

async function getOpenMeteo(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto', forecast_days: 3,
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    daily: 'precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
  });
  const d = await fetchJson('Open-Meteo', url);
  const c = d.current || {};
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    precipitation: c.precipitation,
    windSpeed: c.wind_speed_10m,
    windGusts: c.wind_gusts_10m,
    code: c.weather_code,
    description: CODES[c.weather_code] || 'Unknown',
    source: 'Open-Meteo',
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],
      rainChance: d.daily.precipitation_probability_max[i],
      windMax: d.daily.wind_speed_10m_max[i],
    })),
  };
}

// Fallback: MET Norway (no key, needs an identifying User-Agent) - https://api.met.no
// Open-Meteo rate-limits shared cloud IPs such as Render's free tier, so we switch providers rather than show nothing.
const MET_CODES = [['thunder', 95], ['heavyrain', 65], ['lightrain', 61], ['rain', 63], ['sleet', 61], ['snow', 61], ['fog', 45], ['partlycloudy', 2], ['cloudy', 3], ['fair', 1], ['clearsky', 0]];
const metCode = (sym = '') => (MET_CODES.find(([k]) => sym.includes(k)) || [null, null])[1];

async function getMetNo(lat, lon) {
  const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  const d = await fetchJson('MET Norway', url, { headers: { 'User-Agent': 'BantayAlerto/1.0 github.com/mikelss233/bantayalerto' } });
  const series = d.properties?.timeseries || [];
  if (!series.length) throw new Error('MET Norway returned no data');
  const now = series[0].data;
  const kmh = (ms) => (ms == null ? null : Math.round(ms * 36) / 10);
  const code = metCode(now.next_1_hours?.summary?.symbol_code || now.next_6_hours?.summary?.symbol_code);
  // Group hourly/6-hourly steps into local calendar days (approximate offset from longitude).
  const offsetMs = Math.round(lon / 15) * 3600e3;
  const days = new Map();
  for (const t of series) {
    const date = new Date(Date.parse(t.time) + offsetMs).toISOString().slice(0, 10);
    const day = days.get(date) || { date, rainMm: 0, rainChance: null, windMax: 0 };
    day.rainMm += t.data.next_1_hours?.details?.precipitation_amount ?? t.data.next_6_hours?.details?.precipitation_amount ?? 0;
    day.windMax = Math.max(day.windMax, kmh(t.data.instant.details.wind_speed) || 0);
    days.set(date, day);
  }
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
    forecast: [...days.values()].slice(0, 3).map((f) => ({ ...f, rainMm: Math.round(f.rainMm * 10) / 10 })),
  };
}

async function getWeather(lat, lon) {
  try { return await getOpenMeteo(lat, lon); } catch (primary) {
    try { return await getMetNo(lat, lon); } catch { throw primary; }
  }
}

module.exports = { getWeather };
