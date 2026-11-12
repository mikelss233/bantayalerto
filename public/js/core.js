// Shared helpers and app-wide state used by every page.
export const $ = (s, r = document) => r.querySelector(s);
export const view = $('#view');
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pill = (v) => `<span class="pill ${esc(v)}">${esc(v)}</span>`;
export const fmtDate = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString();
export const DEFAULT_POS = { lat: 14.5995, lon: 120.9842, label: 'Manila' };

// me = logged-in user (or null); map/charts = the current page's Leaflet map and Chart.js charts, cleaned up on navigation.
export const state = { me: null, map: null, charts: [] };

// Every call to our server goes through here: JSON in/out, cookie sent automatically, errors become readable messages.
export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
export const formData = (form) => Object.fromEntries(new FormData(form).entries());
// Where to centre the map: the logged-in user's city, otherwise Manila.
export const currentLocation = () => (state.me?.lat != null ? { lat: state.me.lat, lon: state.me.lon, label: state.me.city || 'Your area' } : DEFAULT_POS);
