// The "brain" of the system: fuses weather + earthquakes + NASA events into one explainable risk score.
// Pure function so it is easy to unit-test and easy to explain during Q&A.
const LEVELS = [
  { max: 20, level: 'Low', color: '#2e9e5b', advice: 'Conditions are normal. Keep your go-bag and checklist up to date.' },
  { max: 45, level: 'Moderate', color: '#e0a800', advice: 'Stay informed. Review your evacuation route and charge your devices.' },
  { max: 70, level: 'High', color: '#e8590c', advice: 'Prepare to evacuate. Move valuables up high and monitor official advisories.' },
  { max: 101, level: 'Critical', color: '#c92a2a', advice: 'Evacuate if you are in a low-lying or hazardous area. Go to the nearest open center now.' },
];

function assessRisk({ weather, quakes = [], events = [] }) {
  let score = 0;
  const factors = [];
  const add = (points, text) => { score += points; factors.push({ points, text }); };

  if (weather) {
    const rain = Math.max(weather.precipitation || 0, ...(weather.forecast || []).map((f) => f.rainMm || 0));
    const wind = Math.max(weather.windGusts || 0, weather.windSpeed || 0, ...(weather.forecast || []).map((f) => f.windMax || 0));
    if (rain >= 100) add(35, `Extreme rainfall expected (${Math.round(rain)} mm/day)`);
    else if (rain >= 50) add(25, `Heavy rainfall expected (${Math.round(rain)} mm/day)`);
    else if (rain >= 20) add(12, `Moderate rainfall expected (${Math.round(rain)} mm/day)`);
    if (wind >= 90) add(30, `Destructive winds (${Math.round(wind)} km/h)`);
    else if (wind >= 60) add(20, `Strong winds (${Math.round(wind)} km/h)`);
    else if (wind >= 40) add(8, `Gusty winds (${Math.round(wind)} km/h)`);
    if (weather.code >= 95) add(10, 'Thunderstorm activity');
  }

  for (const q of quakes) {
    const d = q.distanceKm ?? Infinity;
    if (q.mag >= 6 && d <= 150) add(40, `M${q.mag} earthquake ${d} km away`);
    else if (q.mag >= 5 && d <= 150) add(25, `M${q.mag} earthquake ${d} km away`);
    else if (q.mag >= 4 && d <= 100) add(10, `M${q.mag} earthquake ${d} km away`);
  }

  let eventPts = 0;
  for (const e of events) {
    if (['severeStorms', 'floods', 'volcanoes'].includes(e.category) && (e.distanceKm ?? Infinity) <= 300 && eventPts < 30) {
      eventPts += 15;
      add(15, `${e.categoryTitle}: ${e.title} (${e.distanceKm} km)`);
    }
  }

  score = Math.min(100, score);
  const band = LEVELS.find((l) => score < l.max);
  return { score, level: band.level, color: band.color, advice: band.advice, factors };
}

module.exports = { assessRisk };
