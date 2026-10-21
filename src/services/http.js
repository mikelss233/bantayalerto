// Shared fetch helper for all external APIs: timeout, in-memory TTL cache, and call logging
// (the log feeds the admin dashboard's "API health" panel).
const cache = new Map();
let logger = () => {};

const setLogger = (fn) => { logger = fn; };
const clearCache = () => cache.clear();

async function fetchJson(service, url, { ttlMs = 5 * 60 * 1000, timeoutMs = 8000, ...opts } = {}) {
  const key = `${opts.method || 'GET'} ${url} ${opts.body || ''}`;
  const hit = cache.get(key);
  if (ttlMs && hit && hit.exp > Date.now()) return hit.data;

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'BantayAlerto/1.0 (student project)', Accept: 'application/json', ...opts.headers },
    });
    if (!res.ok) throw new Error(`${service} responded ${res.status}`);
    const data = await res.json();
    if (ttlMs) cache.set(key, { data, exp: Date.now() + ttlMs });
    logger(service, true, Date.now() - started);
    return data;
  } catch (err) {
    logger(service, false, Date.now() - started);
    // Serve stale data if we have it rather than failing the whole request.
    if (hit) return hit.data;
    throw err.name === 'AbortError' ? new Error(`${service} timed out`) : err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, setLogger, clearCache };
