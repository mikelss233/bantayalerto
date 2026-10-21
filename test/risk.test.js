const test = require('node:test');
const assert = require('node:assert');
const { assessRisk } = require('../src/services/risk');

test('calm conditions are Low', () => {
  const r = assessRisk({ weather: { precipitation: 0, windSpeed: 10, forecast: [{ rainMm: 2, windMax: 15 }], code: 1 }, quakes: [], events: [] });
  assert.strictEqual(r.level, 'Low');
  assert.strictEqual(r.score, 0);
});

test('typhoon-like weather plus nearby quake is Critical and explains why', () => {
  const r = assessRisk({
    weather: { precipitation: 12, windSpeed: 80, windGusts: 110, forecast: [{ rainMm: 130, windMax: 100 }], code: 95 },
    quakes: [{ mag: 6.2, distanceKm: 90 }],
    events: [{ category: 'severeStorms', categoryTitle: 'Severe Storms', title: 'Typhoon X', distanceKm: 120 }],
  });
  assert.strictEqual(r.level, 'Critical');
  assert.ok(r.factors.length >= 4);
  assert.ok(r.score <= 100);
});

test('distant quakes are ignored', () => {
  const r = assessRisk({ weather: null, quakes: [{ mag: 6.5, distanceKm: 900 }], events: [] });
  assert.strictEqual(r.score, 0);
});
