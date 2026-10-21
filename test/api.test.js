process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const { openDb, seedAdmin } = require('../src/db');
const { createApp } = require('../src/app');
const { clearCache } = require('../src/services/http');

// Mock every external API so tests are deterministic and offline.
const realFetch = global.fetch;
const external = (url) => {
  if (url.includes('open-meteo')) return { current: { temperature_2m: 30, relative_humidity_2m: 80, precipitation: 5, weather_code: 63, wind_speed_10m: 20, wind_gusts_10m: 35 }, daily: { time: ['2026-10-21'], precipitation_sum: [60], precipitation_probability_max: [90], wind_speed_10m_max: [45] } };
  if (url.includes('usgs')) return { features: [{ id: 'q1', properties: { mag: 5.1, place: 'Test', time: 1, url: 'u' }, geometry: { coordinates: [121.1, 14.7, 10] } }] };
  if (url.includes('eonet')) return { events: [{ id: 'e1', title: 'Storm', categories: [{ id: 'severeStorms', title: 'Severe Storms' }], link: 'l', geometry: [{ type: 'Point', date: 'd', coordinates: [121.5, 14.9] }] }] };
  if (url.includes('nominatim')) return [{ display_name: 'Quezon City, Philippines', lat: '14.676', lon: '121.0437' }];
  throw new Error('unmocked ' + url);
};

let server, base, adminCookie, userCookie;
test.before(async () => {
  global.fetch = async (url, opts) => (/127\.0\.0\.1/.test(String(url)) ? realFetch(url, opts) : { ok: true, status: 200, json: async () => external(String(url)) });
  const db = openDb(':memory:');
  seedAdmin(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); global.fetch = realFetch; });

const call = async (method, path, body, cookie) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json().catch(() => null), cookie: setCookie ? setCookie.split(';')[0] : null };
};

test('registration validates and always creates role=user', async () => {
  assert.strictEqual((await call('POST', '/api/auth/register', { name: 'A', email: 'bad', password: 'longenough' })).status, 400);
  assert.strictEqual((await call('POST', '/api/auth/register', { name: 'A', email: 'a@b.co', password: 'short' })).status, 400);
  const r = await call('POST', '/api/auth/register', { name: 'Juan', email: 'juan@test.ph', password: 'password1', city: 'Quezon City', role: 'admin' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.user.role, 'user'); // privilege escalation attempt ignored
  assert.ok(r.body.user.lat, 'city geocoded through Nominatim');
  userCookie = r.cookie;
  assert.strictEqual((await call('POST', '/api/auth/register', { name: 'Juan', email: 'JUAN@test.ph', password: 'password1' })).status, 409);
});

test('login works and rejects bad passwords', async () => {
  assert.strictEqual((await call('POST', '/api/auth/login', { email: 'admin@bantay.local', password: 'nope' })).status, 401);
  const r = await call('POST', '/api/auth/login', { email: 'admin@bantay.local', password: 'Admin123!' });
  assert.strictEqual(r.body.user.role, 'admin');
  adminCookie = r.cookie;
});

test('role-based access control', async () => {
  assert.strictEqual((await call('GET', '/api/admin/stats')).status, 401);
  assert.strictEqual((await call('GET', '/api/admin/stats', null, userCookie)).status, 403);
  assert.strictEqual((await call('GET', '/api/admin/stats', null, adminCookie)).status, 200);
  assert.strictEqual((await call('POST', '/api/centers', { name: 'x', address: 'y' }, userCookie)).status, 403);
});

test('centers CRUD (admin) with auto-geocoding', async () => {
  const c = await call('POST', '/api/centers', { name: 'QC Hall', address: 'Quezon City Hall', capacity: 100, occupancy: 100 }, adminCookie);
  assert.strictEqual(c.status, 201);
  assert.strictEqual(c.body.status, 'full');
  assert.ok(c.body.lat);
  assert.strictEqual((await call('PUT', `/api/centers/${c.body.id}`, { ...c.body, occupancy: 10, status: 'open' }, adminCookie)).body.status, 'open');
  assert.strictEqual((await call('POST', '/api/centers', { name: 'bad', address: 'z', capacity: 1, occupancy: 5 }, adminCookie)).status, 400);
  assert.strictEqual((await call('GET', '/api/centers?lat=14.6&lon=121')).body[0].name, 'QC Hall');
  assert.strictEqual((await call('DELETE', `/api/centers/${c.body.id}`, null, adminCookie)).status, 200);
});

test('incident reports CRUD with ownership rules', async () => {
  const c = await call('POST', '/api/reports', { type: 'flood', title: 'Flooded street', address: 'Quezon City', severity: 'high' }, userCookie);
  assert.strictEqual(c.status, 201);
  assert.ok(c.body.weather_snapshot, 'weather snapshot captured from Open-Meteo');
  const id = c.body.id;
  assert.strictEqual((await call('POST', '/api/reports', { type: 'nonsense', title: 'abc' }, userCookie)).status, 400);
  assert.strictEqual((await call('GET', `/api/reports/${id}`, null, adminCookie)).status, 200);
  assert.strictEqual((await call('PUT', `/api/reports/${id}`, { status: 'verified' }, userCookie)).status, 403);
  assert.strictEqual((await call('PUT', `/api/reports/${id}`, { title: 'Flooded street (updated)' }, userCookie)).body.title, 'Flooded street (updated)');
  assert.strictEqual((await call('PUT', `/api/reports/${id}`, { status: 'verified' }, adminCookie)).body.status, 'verified');
  assert.strictEqual((await call('DELETE', `/api/reports/${id}`, null, userCookie)).status, 409); // verified => locked for user
  const other = await call('POST', '/api/auth/register', { name: 'Maria', email: 'maria@test.ph', password: 'password1' });
  assert.strictEqual((await call('GET', `/api/reports/${id}`, null, other.cookie)).status, 403);
  assert.strictEqual((await call('DELETE', `/api/reports/${id}`, null, adminCookie)).status, 200);
});

test('external endpoints + combined risk', async () => {
  clearCache();
  const r = await call('GET', '/api/external/risk?lat=14.6&lon=121');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.sources, { weather: true, quakes: true, events: true });
  assert.ok(['Moderate', 'High', 'Critical'].includes(r.body.risk.level));
  assert.strictEqual((await call('GET', '/api/external/weather?lat=abc&lon=1')).status, 400);
  assert.strictEqual((await call('GET', '/api/external/geocode?q=Manila')).body[0].lat, 14.676);
});

test('alert broadcast and admin dashboard stats incl. API health', async () => {
  const a = await call('POST', '/api/admin/alerts', { title: 'Typhoon', message: 'Stay safe', level: 'warning' }, adminCookie);
  assert.strictEqual(a.status, 201);
  assert.ok(a.body.recipients >= 2);
  const s = await call('GET', '/api/admin/stats', null, adminCookie);
  assert.ok(s.body.apiHealth.length >= 3);
  assert.ok((await call('GET', '/api/admin/alerts', null, userCookie)).body.length === 1);
});

test('checklist is seeded and togglable', async () => {
  const list = (await call('GET', '/api/checklist', null, userCookie)).body;
  assert.ok(list.length >= 8);
  assert.strictEqual((await call('PUT', `/api/checklist/${list[0].id}`, { done: true }, userCookie)).body.done, 1);
});

test('external API failure degrades gracefully', async () => {
  clearCache();
  const prev = global.fetch;
  global.fetch = async (url, o) => (/127\.0\.0\.1/.test(String(url)) ? realFetch(url, o) : { ok: false, status: 503, json: async () => ({}) });
  const r = await call('GET', '/api/external/risk?lat=10&lon=123');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.sources, { weather: false, quakes: false, events: false });
  global.fetch = prev;
});
