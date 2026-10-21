// API 1: Open-Meteo (no key required) - https://open-meteo.com
const { fetchJson } = require('./http');

const CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

async function getWeather(lat, lon) {
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
    forecast: (d.daily?.time || []).map((date, i) => ({
      date,
      rainMm: d.daily.precipitation_sum[i],
      rainChance: d.daily.precipitation_probability_max[i],
      windMax: d.daily.wind_speed_10m_max[i],
    })),
  };
}

module.exports = { getWeather };
