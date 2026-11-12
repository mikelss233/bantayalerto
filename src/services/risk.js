// =====================================================================
// RISK SCORE  (the "brain" of BantayAlerto)
//
// WHAT IT DOES:
//   Combines the results of three APIs (weather, earthquakes, NASA events)
//   into ONE risk score from 0 to 100, a level (Low / Moderate / High / Critical),
//   advice for the user, and the list of REASONS for the score.
//
// HOW THE SCORE WORKS:
//   We start at 0 and add points for each danger we find (heavy rain, strong wind,
//   a nearby earthquake, a nearby storm...). The total is capped at 100.
//   Every time we add points we also save the reason, so the user can see WHY
//   the risk is high. That is what makes the score "explainable".
//
// WHY IT IS EASY TO TEST:
//   This file doesn't call any API or the database. It only does math on the data
//   it is given, so the automated tests can check it with made-up weather.
//
// NOTE: This is a readiness guide, not an official warning. The wind levels follow
// PAGASA's wind signals (Signal 2 = 62-88 km/h, Signal 3 = 89-117 km/h).
// =====================================================================

// The 4 risk levels. A score BELOW "max" gets that level:
//   0-19 Low, 20-44 Moderate, 45-69 High, 70-100 Critical.
// color = the color shown on the risk card, advice = the message shown to the user.
const LEVELS = [
  { max: 20, level: 'Low', color: '#2e9e5b', advice: 'Conditions are normal. Keep your go-bag and checklist up to date.' },
  { max: 45, level: 'Moderate', color: '#e0a800', advice: 'Stay informed. Review your evacuation route and charge your devices.' },
  { max: 70, level: 'High', color: '#e8590c', advice: 'Prepare to evacuate. Move valuables up high and monitor official advisories.' },
  { max: 101, level: 'Critical', color: '#c92a2a', advice: 'Evacuate if you are in a low-lying or hazardous area. Go to the nearest open center now.' },
];

function assessRisk({ weather, quakes = [], events = [] }) {
  let score = 0;
  const factors = []; // the list of reasons shown under the score
  // add() adds points AND saves the reason, so every point is explained.
  const add = (points, text) => { score += points; factors.push({ points, text }); };

  // ---- 1. WEATHER ----
  if (weather) {
    // Use the WORST rain and wind out of "right now" and the next 3 days.
    const rain = Math.max(weather.precipitation || 0, ...(weather.forecast || []).map((f) => f.rainMm || 0));
    const wind = Math.max(weather.windGusts || 0, weather.windSpeed || 0, ...(weather.forecast || []).map((f) => f.windMax || 0));

    // Rain: only ONE of these can apply (the highest one that matches).
    if (rain >= 100) add(35, `Extreme rainfall expected (${Math.round(rain)} mm/day)`);
    else if (rain >= 50) add(25, `Heavy rainfall expected (${Math.round(rain)} mm/day)`);
    else if (rain >= 20) add(12, `Moderate rainfall expected (${Math.round(rain)} mm/day)`);

    // Wind: only ONE of these can apply.
    if (wind >= 90) add(30, `Destructive winds (${Math.round(wind)} km/h)`);
    else if (wind >= 60) add(20, `Strong winds (${Math.round(wind)} km/h)`);
    else if (wind >= 40) add(8, `Gusty winds (${Math.round(wind)} km/h)`);

    // Weather number 95 or higher = thunderstorm.
    if (weather.code >= 95) add(10, 'Thunderstorm activity');
  }

  // ---- 2. EARTHQUAKES ---- (each nearby earthquake adds points)
  for (const q of quakes) {
    const d = q.distanceKm ?? Infinity; // distance from the user (unknown = very far)
    if (q.mag >= 6 && d <= 150) add(40, `M${q.mag} earthquake ${d} km away`);      // strong and close
    else if (q.mag >= 5 && d <= 150) add(25, `M${q.mag} earthquake ${d} km away`);
    else if (q.mag >= 4 && d <= 100) add(10, `M${q.mag} earthquake ${d} km away`);
    // Smaller or farther earthquakes add nothing.
  }

  // ---- 3. NASA EVENTS ---- (storms, floods, volcanoes within 300 km)
  // Each one adds 15 points, but events can add at most 30 points in total.
  let eventPts = 0;
  for (const e of events) {
    if (['severeStorms', 'floods', 'volcanoes'].includes(e.category) && (e.distanceKm ?? Infinity) <= 300 && eventPts < 30) {
      eventPts += 15;
      add(15, `${e.categoryTitle}: ${e.title} (${e.distanceKm} km)`);
    }
  }

  // ---- 4. FINAL RESULT ----
  score = Math.min(100, score);                        // never more than 100
  const band = LEVELS.find((l) => score < l.max);      // pick the level for this score
  return { score, level: band.level, color: band.color, advice: band.advice, factors };
}

module.exports = { assessRisk };
