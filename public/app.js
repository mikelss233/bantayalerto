'use strict';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (v) => `<span class="pill ${esc(v)}">${esc(v)}</span>`;
const fmtDate = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString();
const DEFAULT_POS = { lat: 14.5995, lon: 120.9842, label: 'Manila' };

let me = null, map = null, charts = [];

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const location_ = () => (me?.lat != null ? { lat: me.lat, lon: me.lon, label: me.city || 'Your area' } : DEFAULT_POS);

function renderNav() {
  const links = [['#/', 'Live Map']];
  if (me) links.push(['#/reports', me.role === 'admin' ? 'All Reports' : 'My Reports'], ['#/centers', 'Evacuation Centers'], ['#/checklist', 'Checklist'], ['#/alerts', 'Alerts']);
  else links.push(['#/centers', 'Evacuation Centers']);
  if (me?.role === 'admin') links.push(['#/admin', 'Dashboard'], ['#/users', 'Users']);
  links.push(me ? ['#/logout', `Logout (${me.name.split(' ')[0]})`] : ['#/login', 'Login'], ...(me ? [] : [['#/register', 'Register']]));
  const cur = location.hash || '#/';
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}" class="${cur === h ? 'on' : ''}">${esc(t)}</a>`).join('');
}

// ---------- Router ----------
const routes = {
  '/': home, '/login': loginPage, '/register': registerPage, '/reports': reportsPage, '/centers': centersPage,
  '/checklist': checklistPage, '/alerts': alertsPage, '/admin': adminPage, '/users': usersPage,
};
const needsAuth = ['/reports', '/checklist', '/alerts'];
const needsAdmin = ['/admin', '/users'];

async function route() {
  charts.forEach((c) => c.destroy()); charts = [];
  if (map) { map.remove(); map = null; }
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (path === '/logout') { await api('/auth/logout', { method: 'POST' }); me = null; toast('Logged out'); location.hash = '#/'; return; }
  renderNav();
  if ((needsAuth.includes(path) || needsAdmin.includes(path)) && !me) { location.hash = '#/login'; return; }
  if (needsAdmin.includes(path) && me.role !== 'admin') { view.innerHTML = '<div class="card">Admins only.</div>'; return; }
  view.innerHTML = '<p class="mut">Loading…</p>';
  try { await (routes[path] || home)(); } catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}

// ---------- Auth ----------
function authForm(kind) {
  const reg = kind === 'register';
  view.innerHTML = `<div class="card narrow"><h1>${reg ? 'Create account' : 'Welcome back'}</h1>
    <form id="f">
      ${reg ? '<label>Full name<input name="name" required maxlength="80"></label>' : ''}
      <label>Email<input type="email" name="email" required></label>
      <label>Password${reg ? ' (min 8 characters)' : ''}<input type="password" name="password" required minlength="${reg ? 8 : 1}"></label>
      ${reg ? '<label>Mobile (for SMS alerts)<input name="phone" placeholder="09171234567"></label><label>City / municipality<input name="city" placeholder="Quezon City"></label>' : ''}
      <div class="err" id="e"></div><button>${reg ? 'Register' : 'Log in'}</button>
    </form>
    <p class="small mut">${reg ? 'Already registered? <a href="#/login">Log in</a>' : 'No account? <a href="#/register">Register</a>'}</p></div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { me = (await api('/auth/' + kind, { method: 'POST', body: formData(ev.target) })).user; toast('Welcome, ' + me.name); location.hash = me.role === 'admin' ? '#/admin' : '#/'; }
    catch (e) { $('#e').textContent = e.message; }
  };
}
function loginPage() { return authForm('login'); }
function registerPage() { return authForm('register'); }

// ---------- Home: live map + risk ----------
async function home() {
  let pos = location_();
  view.innerHTML = `<h1>Live hazard map</h1>
    <div class="card row" style="margin-bottom:14px">
      <input class="grow" id="q" placeholder="Search a place (e.g. Tacloban City)" value="">
      <button id="go">Search</button><button class="sec" id="gps">📍 Use my location</button>
      <button class="sec" data-place="Manila" data-lat="14.5995" data-lon="120.9842">Manila</button>
      <button class="sec" data-place="Iligan City" data-lat="8.2280" data-lon="124.2452">Iligan City</button>
    </div>
    <div class="grid g2"><div><div id="map"></div></div>
      <div class="grid"><div id="risk" class="card risk">Assessing…</div><div class="card" id="wx"></div></div></div>
    <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Recent earthquakes nearby (7 days)</h2><div id="qk"></div></div>
      <div class="card"><h2>Active natural events (NASA EONET)</h2><div id="ev"></div></div></div>`;

  map = L.map('map').setView([pos.lat, pos.lon], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  async function load() {
    layer.clearLayers();
    map.setView([pos.lat, pos.lon], 8);
    L.circleMarker([pos.lat, pos.lon], { radius: 9, color: '#1d4ed8', fillOpacity: .9 }).addTo(layer).bindPopup('Selected location: ' + esc(pos.label));
    try {
      const [d, centers] = await Promise.all([api(`/external/risk?lat=${pos.lat}&lon=${pos.lon}`), api(`/centers?lat=${pos.lat}&lon=${pos.lon}`)]);
      const r = d.risk;
      $('#risk').style.borderLeftColor = r.color;
      $('#risk').innerHTML = `<h2>Risk for ${esc(pos.label)}</h2><div class="row"><span class="score" style="color:${r.color}">${esc(r.level)}</span><span class="mut">score ${r.score}/100</span></div>
        <div class="bar"><i style="width:${r.score}%;background:${r.color}"></i></div><p>${esc(r.advice)}</p>
        ${r.factors.length ? '<ul class="clean small">' + r.factors.map((f) => `<li>+${f.points} ${esc(f.text)}</li>`).join('') + '</ul>' : '<p class="small mut">No active hazards detected.</p>'}
        ${Object.values(d.sources).includes(false) ? '<p class="err small">Some data sources are temporarily unavailable; the score may be incomplete.</p>' : ''}
        ${centers[0] ? `<p class="small">Nearest center: <b>${esc(centers[0].name)}</b> (${centers[0].distanceKm} km) ${pill(centers[0].status)}</p>` : ''}`;
      const w = d.weather;
      $('#wx').innerHTML = w ? `<h2>Weather now</h2><div class="row"><b style="font-size:26px">${w.temperature}°C</b><span>${esc(w.description)}</span></div>
        <p class="small mut">Humidity ${w.humidity}% · Wind ${w.windSpeed} km/h (gusts ${w.windGusts}) · Rain ${w.precipitation} mm</p>
        <table><tr><th>Day</th><th>Rain</th><th>Chance</th><th>Wind max</th></tr>${w.forecast.map((f) => `<tr><td>${esc(f.date)}</td><td>${f.rainMm} mm</td><td>${f.rainChance ?? '-'}%</td><td>${f.windMax} km/h</td></tr>`).join('')}</table>` : '<span class="err">Weather unavailable.</span>';
      $('#qk').innerHTML = d.quakes.length ? '<ul class="clean small">' + d.quakes.map((q) => `<li><b>M${q.mag}</b> ${esc(q.place)} · ${q.distanceKm} km · ${new Date(q.time).toLocaleString()}</li>`).join('') + '</ul>' : '<p class="mut">No earthquakes within 300 km this week.</p>';
      d.quakes.forEach((q) => L.circleMarker([q.lat, q.lon], { radius: 4 + q.mag * 2, color: '#c92a2a', fillOpacity: .4 }).addTo(layer).bindPopup(`M${q.mag} ${esc(q.place)}`));
      $('#ev').innerHTML = d.events.length ? '<ul class="clean small">' + d.events.map((e) => `<li><b>${esc(e.categoryTitle)}</b>: ${esc(e.title)} · ${e.distanceKm} km</li>`).join('') + '</ul>' : '<p class="mut">No active events nearby.</p>';
      d.events.forEach((e) => L.circleMarker([e.lat, e.lon], { radius: 7, color: '#e8590c', fillOpacity: .6 }).addTo(layer).bindPopup(esc(e.title)));
      centers.filter((c) => c.lat != null).forEach((c) => L.circleMarker([c.lat, c.lon], { radius: 8, color: c.status === 'open' ? '#2e9e5b' : '#868e96', fillOpacity: .8 }).addTo(layer)
        .bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.address)}<br>${c.occupancy}/${c.capacity} · ${esc(c.status)}`));
    } catch (e) { $('#risk').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  }
  $('#go').onclick = async () => {
    const q = $('#q').value.trim(); if (q.length < 3) return toast('Type at least 3 characters');
    try { const [g] = await api('/external/geocode?q=' + encodeURIComponent(q)); if (!g) return toast('Place not found'); pos = { lat: g.lat, lon: g.lon, label: g.label.split(',').slice(0, 2).join(',') }; load(); }
    catch (e) { toast(e.message); }
  };
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') $('#go').click(); };
  $('#gps').onclick = () => {
    if (!navigator.geolocation) return toast('Your browser does not support location');
    const btn = $('#gps'); btn.disabled = true; btn.textContent = 'Locating…';
    const done = () => { btn.disabled = false; btn.textContent = '📍 Use my location'; };
    navigator.geolocation.getCurrentPosition(async (p) => {
      pos = { lat: p.coords.latitude, lon: p.coords.longitude, label: 'My location' };
      try { const r = await api(`/external/reverse?lat=${pos.lat}&lon=${pos.lon}`); if (r.label) pos.label = r.label; } catch { /* keep generic label */ }
      done(); load();
    }, (err) => {
      done();
      toast(err.code === 1 ? 'Location blocked. Allow it in the browser address bar, or search a place instead.'
        : err.code === 3 ? 'Location timed out. Try again or search a place.' : 'Could not determine your location. Search a place instead.');
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  };
  document.querySelectorAll('[data-place]').forEach((b) => { b.onclick = () => { pos = { lat: +b.dataset.lat, lon: +b.dataset.lon, label: b.dataset.place }; load(); }; });
  load();
}

// ---------- Reports (full CRUD) ----------
async function reportsPage() {
  const meta = await api('/reports/meta');
  const admin = me.role === 'admin';
  view.innerHTML = `<h1>${admin ? 'All incident reports' : 'My incident reports'}</h1>
    <div class="grid g2"><div class="card"><h2 id="ft">Report an incident</h2>
      <form id="f"><input type="hidden" name="id">
        <label>Type<select name="type">${meta.types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label>Title<input name="title" required minlength="3" maxlength="120"></label>
        <label>Severity<select name="severity">${meta.severities.map((s) => `<option ${s === 'medium' ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Location / address<input name="address" placeholder="Brgy., city (auto-located via OpenStreetMap)"></label>
        <label>Details<textarea name="description" maxlength="2000"></textarea></label>
        ${admin ? `<label>Status<select name="status">${meta.statuses.map((s) => `<option>${s}</option>`).join('')}</select></label>` : ''}
        <div class="err" id="e"></div><div class="row"><button>Save</button><button type="button" class="sec" id="cancel">Clear</button></div></form></div>
    <div class="card"><div class="row"><h2 class="grow">Reports</h2><select id="fs" style="width:auto"><option value="">All statuses</option>${meta.statuses.map((s) => `<option>${s}</option>`).join('')}</select></div><div id="list" class="table-wrap"></div></div></div>`;
  let rows = [];
  const f = $('#f');
  async function refresh() {
    rows = await api('/reports' + ($('#fs').value ? '?status=' + $('#fs').value : ''));
    $('#list').innerHTML = rows.length ? `<table><tr><th>Incident</th><th>Severity</th><th>Status</th><th></th></tr>${rows.map((r) => `<tr><td><b>${esc(r.title)}</b><br><span class="small mut">${esc(r.type)} · ${esc(r.address || 'no address')}${admin ? ' · by ' + esc(r.reporter) : ''}<br>${fmtDate(r.created_at)}${r.weather_snapshot ? ` · ${esc(r.weather_snapshot.description)}, ${r.weather_snapshot.temperature}°C` : ''}</span></td>
      <td>${pill(r.severity)}</td><td>${pill(r.status)}</td>
      <td class="row">${admin || r.status === 'pending' ? `<button class="sm sec" data-edit="${r.id}">Edit</button><button class="sm danger" data-del="${r.id}">Delete</button>` : '<span class="small mut">locked</span>'}</td></tr>`).join('')}</table>` : '<p class="mut">No reports yet.</p>';
  }
  const clear = () => { f.reset(); f.id.value = ''; $('#ft').textContent = 'Report an incident'; };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const d = formData(f); const id = d.id; delete d.id;
    try { await api(id ? '/reports/' + id : '/reports', { method: id ? 'PUT' : 'POST', body: d }); toast(id ? 'Report updated' : 'Report submitted'); clear(); refresh(); $('#e').textContent = ''; }
    catch (e) { $('#e').textContent = e.message; }
  };
  $('#cancel').onclick = clear; $('#fs').onchange = refresh;
  $('#list').onclick = async (ev) => {
    const ed = ev.target.dataset.edit, del = ev.target.dataset.del;
    if (ed) { const r = rows.find((x) => x.id == ed); for (const k of ['type', 'title', 'severity', 'address', 'description', 'status']) if (f[k]) f[k].value = r[k] ?? ''; f.id.value = r.id; $('#ft').textContent = 'Edit report #' + r.id; scrollTo(0, 0); }
    if (del && confirm('Delete this report?')) { try { await api('/reports/' + del, { method: 'DELETE' }); toast('Deleted'); refresh(); } catch (e) { toast(e.message); } }
  };
  refresh();
}

// ---------- Evacuation centers (public list, admin CRUD) ----------
async function centersPage() {
  const admin = me?.role === 'admin';
  const p = location_();
  view.innerHTML = `<h1>Evacuation centers</h1><p class="mut small">Sorted by distance from ${esc(p.label)}.</p>
    <div class="grid ${admin ? 'g2' : ''}">${admin ? `<div class="card"><h2 id="ft">Add center</h2><form id="f"><input type="hidden" name="id">
      <label>Name<input name="name" required></label><label>Address (auto-located if no coordinates)<input name="address" required></label>
      <div class="row"><label class="grow">Latitude<input name="lat"></label><label class="grow">Longitude<input name="lon"></label></div>
      <div class="row"><label class="grow">Capacity<input type="number" min="0" name="capacity" value="0"></label><label class="grow">Occupancy<input type="number" min="0" name="occupancy" value="0"></label></div>
      <label>Contact<input name="contact"></label><label>Status<select name="status"><option>open</option><option>full</option><option>closed</option></select></label>
      <div class="err" id="e"></div><div class="row"><button>Save</button><button type="button" class="sec" id="cancel">Clear</button></div></form></div>` : ''}
    <div class="card table-wrap" id="list"></div></div>`;
  let rows = [];
  const refresh = async () => {
    rows = await api(`/centers?lat=${p.lat}&lon=${p.lon}`);
    $('#list').innerHTML = rows.length ? `<table><tr><th>Center</th><th>Occupancy</th><th>Status</th>${admin ? '<th></th>' : ''}</tr>${rows.map((c) => `<tr><td><b>${esc(c.name)}</b><br><span class="small mut">${esc(c.address)}${c.contact ? ' · ☎ ' + esc(c.contact) : ''}${c.distanceKm != null ? ' · ' + c.distanceKm + ' km' : ''}</span></td>
      <td>${c.occupancy}/${c.capacity}<div class="bar"><i style="width:${c.capacity ? Math.min(100, c.occupancy / c.capacity * 100) : 0}%"></i></div></td><td>${pill(c.status)}</td>
      ${admin ? `<td class="row"><button class="sm sec" data-edit="${c.id}">Edit</button><button class="sm danger" data-del="${c.id}">Delete</button></td>` : ''}</tr>`).join('')}</table>` : '<p class="mut">No centers listed.</p>';
  };
  if (admin) {
    const f = $('#f');
    const clear = () => { f.reset(); f.id.value = ''; $('#ft').textContent = 'Add center'; };
    f.onsubmit = async (ev) => {
      ev.preventDefault(); const d = formData(f); const id = d.id; delete d.id;
      try { await api(id ? '/centers/' + id : '/centers', { method: id ? 'PUT' : 'POST', body: d }); toast('Saved'); clear(); $('#e').textContent = ''; refresh(); } catch (e) { $('#e').textContent = e.message; }
    };
    $('#cancel').onclick = clear;
    $('#list').onclick = async (ev) => {
      const ed = ev.target.dataset.edit, del = ev.target.dataset.del;
      if (ed) { const c = rows.find((x) => x.id == ed); for (const k of ['name', 'address', 'lat', 'lon', 'capacity', 'occupancy', 'contact', 'status']) f[k].value = c[k] ?? ''; f.id.value = c.id; $('#ft').textContent = 'Edit center'; scrollTo(0, 0); }
      if (del && confirm('Delete this center?')) { await api('/centers/' + del, { method: 'DELETE' }); toast('Deleted'); refresh(); }
    };
  }
  refresh();
}

// ---------- Checklist ----------
async function checklistPage() {
  view.innerHTML = '<h1>My preparedness checklist</h1><div class="card narrow" style="max-width:640px;margin:0"><div class="bar"><i id="pb"></i></div><p class="small mut" id="pt"></p><ul class="clean check" id="l"></ul>' +
    '<form class="row" id="f"><input class="grow" name="item" placeholder="Add your own item" required maxlength="200"><button>Add</button></form></div>';
  let items = [];
  const draw = () => {
    const done = items.filter((i) => i.done).length;
    $('#pb').style.width = (items.length ? done / items.length * 100 : 0) + '%'; $('#pt').textContent = `${done} of ${items.length} ready`;
    $('#l').innerHTML = items.map((i) => `<li class="${i.done ? 'done' : ''}"><input type="checkbox" data-id="${i.id}" ${i.done ? 'checked' : ''}><span class="grow">${esc(i.item)}</span><button class="sm sec" data-del="${i.id}">✕</button></li>`).join('');
  };
  items = await api('/checklist'); draw();
  $('#l').onchange = async (e) => { const it = items.find((i) => i.id == e.target.dataset.id); it.done = e.target.checked ? 1 : 0; await api('/checklist/' + it.id, { method: 'PUT', body: { done: e.target.checked } }); draw(); };
  $('#l').onclick = async (e) => { const id = e.target.dataset.del; if (id) { await api('/checklist/' + id, { method: 'DELETE' }); items = items.filter((i) => i.id != id); draw(); } };
  $('#f').onsubmit = async (e) => { e.preventDefault(); items.push(await api('/checklist', { method: 'POST', body: formData(e.target) })); e.target.reset(); draw(); };
}

// ---------- Alerts ----------
async function alertsPage() {
  const admin = me.role === 'admin';
  view.innerHTML = `<h1>Alerts</h1><div class="grid ${admin ? 'g2' : ''}">${admin ? `<div class="card"><h2>Broadcast an alert (SMS + email)</h2><form id="f">
    <label>Level<select name="level"><option>advisory</option><option>watch</option><option>warning</option><option>emergency</option></select></label>
    <label>Title<input name="title" required maxlength="100"></label><label>Message (max 300)<textarea name="message" required maxlength="300"></textarea></label>
    <label>Only users in city (optional)<input name="city"></label><div class="err" id="e"></div><button>Send alert</button></form></div>` : ''}
    <div class="card" id="list"></div></div>`;
  const refresh = async () => {
    const rows = await api('/admin/alerts');
    $('#list').innerHTML = '<h2>Recent alerts</h2>' + (rows.length ? '<ul class="clean">' + rows.map((a) => `<li>${pill(a.level)} <b>${esc(a.title)}</b><br>${esc(a.message)}<br><span class="small mut">${fmtDate(a.created_at)}${a.target_city ? ' · ' + esc(a.target_city) : ' · everyone'}${admin ? ` · ${a.recipients} recipients (${a.delivery.map((d) => d.channel + ': ' + d.mode).join(', ')})` : ''}</span></li>`).join('') + '</ul>' : '<p class="mut">No alerts sent.</p>');
  };
  if (admin) $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const r = await api('/admin/alerts', { method: 'POST', body: formData(ev.target) }); toast(`Sent to ${r.recipients} user(s)`); ev.target.reset(); $('#e').textContent = ''; refresh(); } catch (e) { $('#e').textContent = e.message; }
  };
  refresh();
}

// ---------- Admin dashboard ----------
async function adminPage() {
  const s = await api('/admin/stats'); const t = s.totals;
  const stat = (n, l) => `<div class="card stat"><b>${n}</b><span>${l}</span></div>`;
  const pct = s.capacity.capacity ? Math.round(s.capacity.occupancy / s.capacity.capacity * 100) : 0;
  view.innerHTML = `<h1>Admin dashboard</h1><div class="grid g4">${stat(t.users, 'Registered users')}${stat(t.reports, 'Incident reports')}${stat(t.pending, 'Pending review')}${stat(t.centers, 'Evacuation centers')}${stat(pct + '%', 'Center capacity used')}${stat(t.alerts, 'Alerts sent')}</div>
    <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Reports by type</h2><div class="chart"><canvas id="c1"></canvas></div></div>
    <div class="card"><h2>Reports by severity</h2><div class="chart"><canvas id="c2"></canvas></div></div>
    <div class="card"><h2>Reports per day (14 days)</h2><div class="chart"><canvas id="c3"></canvas></div></div>
    <div class="card"><h2>External API health (24h)</h2><div class="table-wrap">${s.apiHealth.length ? `<table><tr><th>Service</th><th>Calls</th><th>Success</th><th>Avg ms</th></tr>${s.apiHealth.map((a) => `<tr><td>${esc(a.service)}</td><td>${a.calls}</td><td>${Math.round(a.ok / a.calls * 100)}%</td><td>${a.avgMs}</td></tr>`).join('')}</table>` : '<p class="mut">No API calls yet. Open the Live Map first.</p>'}</div></div>
    <div class="card"><h2>Latest reports</h2>${s.recentReports.length ? '<ul class="clean">' + s.recentReports.map((r) => `<li>${pill(r.severity)} <b>${esc(r.title)}</b> <span class="small mut">${esc(r.reporter)} · ${pill(r.status)}</span></li>`).join('') + '</ul>' : '<p class="mut">None yet.</p>'}<a href="#/reports">Manage reports →</a></div></div>`;
  const mk = (id, type, rows) => { if (typeof Chart !== 'undefined') charts.push(new Chart($(id), { type, data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.value), backgroundColor: ['#1d4ed8', '#e8590c', '#2e9e5b', '#c92a2a', '#e0a800', '#7048e8', '#0c8599', '#868e96'], borderColor: '#1d4ed8' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: type === 'doughnut' } }, scales: type === 'doughnut' ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } } } })); };
  mk('#c1', 'bar', s.reportsByType); mk('#c2', 'doughnut', s.reportsBySeverity); mk('#c3', 'line', s.reportsPerDay);
}

// ---------- Users (admin) ----------
async function usersPage() {
  view.innerHTML = '<h1>Users</h1><div class="card table-wrap" id="l"></div>';
  const refresh = async () => {
    const rows = await api('/admin/users');
    $('#l').innerHTML = `<table><tr><th>Name</th><th>Contact</th><th>Role</th><th>Reports</th><th></th></tr>${rows.map((u) => `<tr><td><b>${esc(u.name)}</b><br><span class="small mut">${esc(u.city || '')}</span></td><td>${esc(u.email)}<br><span class="small mut">${esc(u.phone || '')}</span></td><td>${pill(u.role)}</td><td>${u.reports}</td>
      <td class="row">${u.id === me.id ? '<span class="small mut">you</span>' : `<button class="sm sec" data-role="${u.id}" data-to="${u.role === 'admin' ? 'user' : 'admin'}">Make ${u.role === 'admin' ? 'user' : 'admin'}</button><button class="sm danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table>`;
  };
  $('#l').onclick = async (e) => {
    try {
      if (e.target.dataset.role) { await api(`/admin/users/${e.target.dataset.role}/role`, { method: 'PUT', body: { role: e.target.dataset.to } }); refresh(); }
      if (e.target.dataset.del && confirm('Delete this user and all their data?')) { await api('/admin/users/' + e.target.dataset.del, { method: 'DELETE' }); refresh(); }
    } catch (err) { toast(err.message); }
  };
  refresh();
}

window.addEventListener('hashchange', route);
(async () => { try { me = (await api('/auth/me')).user; } catch { /* anonymous */ } route(); })();
