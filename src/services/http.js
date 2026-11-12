// =====================================================================
// API HELPER  (http.js)
//
// WHAT IT DOES:
//   Every call our server makes to an outside API (weather, earthquakes,
//   NASA, maps, SMS, email) goes through ONE function here: fetchJson().
//
// WHY ONE SHARED FUNCTION:
//   The safety features below are written once, and every API gets them:
//   1. TIMEOUT     - stop waiting after 8 seconds, so a slow API can't freeze the page.
//   2. CACHE       - remember each answer for 5 minutes. If many people ask for the
//                    same thing, we only call the API once. This is faster and keeps
//                    us under the free APIs' limits.
//   3. LOGGING     - record every call (success or fail, and how long it took).
//                    The admin dashboard's "API health" table shows these records.
//   4. OLD ANSWER  - if an API fails but we have an older saved answer, use it
//                    instead of showing an error.
//   5. COOL-DOWN   - if an API fails, skip it for 60 seconds. Without this, every
//                    visitor would wait 8 seconds for an API we already know is down.
// =====================================================================

// The cache: saved answers. Each one has the data and the time it expires.
const cache = new Map();

// The cool-down list: which APIs failed recently, and until when we skip them.
const COOLDOWN_MS = 60 * 1000; // 60 seconds
const downUntil = new Map();

// The function that records each call. app.js connects it to the api_log database table.
let logger = () => {};
const setLogger = (fn) => { logger = fn; };

// Empties the cache and the cool-down list (used by the automated tests).
const clearCache = () => { cache.clear(); downUntil.clear(); };

// service = the API's name (for the records), url = the address to call.
// ttlMs = how long to keep the answer (default 5 min), timeoutMs = how long to wait (default 8 s).
async function fetchJson(service, url, { ttlMs = 5 * 60 * 1000, timeoutMs = 8000, ...opts } = {}) {
  // Step 1: If we already have a fresh saved answer, return it right away (no API call).
  const key = `${opts.method || 'GET'} ${url} ${opts.body || ''}`;
  const hit = cache.get(key);
  if (ttlMs && hit && hit.exp > Date.now()) return hit.data;

  // Step 2: If this API failed in the last 60 seconds, don't call it again yet.
  // Use an old saved answer if we have one; otherwise report it as unavailable.
  // (This only applies to getting data. Sending SMS/email is never skipped.)
  const isRead = !opts.method || opts.method === 'GET';
  if (isRead && downUntil.get(service) > Date.now()) {
    if (hit) return hit.data;
    throw new Error(`${service} is unavailable; retrying shortly`);
  }

  // Step 3: Start an 8-second timer. If the API hasn't answered by then, we cancel the request.
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Step 4: Call the API. The User-Agent tells the API which app is calling
    // (OpenStreetMap and MET Norway require this).
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'BantayAlerto/1.0 (student project)', Accept: 'application/json', ...opts.headers },
    });
    if (!res.ok) throw new Error(`${service} responded ${res.status}`); // e.g. 429 = "too many requests"
    const data = await res.json();

    // Step 5 (it worked): save the answer, mark the API as working, record the call.
    if (ttlMs) cache.set(key, { data, exp: Date.now() + ttlMs });
    downUntil.delete(service);
    logger(service, true, Date.now() - started);
    return data;
  } catch (err) {
    // Step 5 (it failed): record the failure and start the 60-second cool-down.
    logger(service, false, Date.now() - started);
    if (isRead) downUntil.set(service, Date.now() + COOLDOWN_MS);
    // Use an old saved answer if we have one, instead of failing.
    if (hit) return hit.data;
    // Otherwise report the error ("timed out" if the 8 seconds ran out).
    throw err.name === 'AbortError' ? new Error(`${service} timed out`) : err;
  } finally {
    clearTimeout(timer); // always stop the timer
  }
}

module.exports = { fetchJson, setLogger, clearCache };
