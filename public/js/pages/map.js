// Live hazard map: place search, Use my location, risk, weather, quakes, events, nearest center.
import { $, view, esc, pill, api, toast, state, currentLocation } from '../core.js';

export async function home() {
  let pos = currentLocation();
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

  const map = state.map = L.map('map').setView([pos.lat, pos.lon], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  // Each load gets a number; an answer that arrives after a newer load started, or after the user
  // left this page, is dropped so a slow response can't overwrite the current place.
  let latest = 0;
  async function load() {
    const mine = ++latest;
    layer.clearLayers();
    map.setView([pos.lat, pos.lon], 8);
    L.circleMarker([pos.lat, pos.lon], { radius: 9, color: '#1d4ed8', fillOpacity: .9 }).addTo(layer).bindPopup('Selected location: ' + esc(pos.label));
    try {
      const [d, centers] = await Promise.all([api(`/external/risk?lat=${pos.lat}&lon=${pos.lon}`), api(`/centers?lat=${pos.lat}&lon=${pos.lon}`)]);
      if (mine !== latest || state.map !== map) return;
      const r = d.risk;
      $('#risk').style.borderLeftColor = r.color;
      $('#risk').innerHTML = `<h2>Risk for ${esc(pos.label)}</h2><div class="row"><span class="score" style="color:${r.color}">${esc(r.level)}</span><span class="mut">score ${r.score}/100</span></div>
        <div class="bar"><i style="width:${r.score}%;background:${r.color}"></i></div><p>${esc(r.advice)}</p>
        ${r.factors.length ? '<ul class="clean small">' + r.factors.map((f) => `<li>+${f.points} ${esc(f.text)}</li>`).join('') + '</ul>' : '<p class="small mut">No active hazards detected.</p>'}
        ${Object.values(d.sources).includes(false) ? '<p class="err small">Some data sources are temporarily unavailable; the score may be incomplete.</p>' : ''}
        ${centers[0] ? (centers[0].distanceKm <= 50 ? `<p class="small">Nearest center: <b>${esc(centers[0].name)}</b> (${centers[0].distanceKm} km) ${pill(centers[0].status)}</p>`
          : `<p class="small err">No evacuation center registered within 50 km (closest: ${esc(centers[0].name)}, ${centers[0].distanceKm} km). Contact your barangay/LGU.</p>`) : ''}`;
      const w = d.weather;
      $('#wx').innerHTML = w ? `<h2>Weather now</h2><div class="row"><b style="font-size:26px">${w.temperature}°C</b><span>${esc(w.description)}</span></div>
        <p class="small mut">Humidity ${w.humidity}% · Wind ${w.windSpeed} km/h${w.windGusts != null ? ` (gusts ${w.windGusts})` : ''} · Rain ${w.precipitation} mm${w.source ? ` · via ${esc(w.source)}` : ''}</p>
        <table><tr><th>Day</th><th>Rain</th><th>Chance</th><th>Wind max</th></tr>${w.forecast.map((f) => `<tr><td>${esc(f.date)}</td><td>${f.rainMm} mm</td><td>${f.rainChance != null ? f.rainChance + '%' : '—'}</td><td>${f.windMax} km/h</td></tr>`).join('')}</table>` : '<span class="err">Weather unavailable.</span>';
      $('#qk').innerHTML = d.quakes.length ? '<ul class="clean small">' + d.quakes.map((q) => `<li><b>M${q.mag}</b> ${esc(q.place)} · ${q.distanceKm} km · ${new Date(q.time).toLocaleString()}</li>`).join('') + '</ul>' : '<p class="mut">No earthquakes within 300 km this week.</p>';
      d.quakes.forEach((q) => L.circleMarker([q.lat, q.lon], { radius: 4 + q.mag * 2, color: '#c92a2a', fillOpacity: .4 }).addTo(layer).bindPopup(`M${q.mag} ${esc(q.place)}`));
      $('#ev').innerHTML = d.events.length ? '<ul class="clean small">' + d.events.map((e) => `<li><b>${esc(e.categoryTitle)}</b>: ${esc(e.title)} · ${e.distanceKm} km</li>`).join('') + '</ul>' : '<p class="mut">No active events nearby.</p>';
      d.events.forEach((e) => L.circleMarker([e.lat, e.lon], { radius: 7, color: '#e8590c', fillOpacity: .6 }).addTo(layer).bindPopup(esc(e.title)));
      centers.filter((c) => c.lat != null).forEach((c) => L.circleMarker([c.lat, c.lon], { radius: 8, color: c.status === 'open' ? '#2e9e5b' : '#868e96', fillOpacity: .8 }).addTo(layer)
        .bindPopup(`<b>${esc(c.name)}</b><br>${esc(c.address)}<br>${c.occupancy}/${c.capacity} · ${esc(c.status)}`));
    } catch (e) { if (mine === latest && state.map === map) $('#risk').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  }
  // The last place the user picked wins: search and GPS take a ticket and give up if a newer pick came in meanwhile.
  let choice = 0;
  const stillCurrent = (ticket) => ticket === choice && state.map === map;
  $('#go').onclick = async () => {
    const q = $('#q').value.trim(); if (q.length < 3) return toast('Type at least 3 characters');
    const ticket = ++choice;
    try { const [g] = await api('/external/geocode?q=' + encodeURIComponent(q)); if (!stillCurrent(ticket)) return; if (!g) return toast('Place not found'); pos = { lat: g.lat, lon: g.lon, label: g.label.split(',').slice(0, 2).join(',') }; load(); }
    catch (e) { toast(e.message); }
  };
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') $('#go').click(); };
  $('#gps').onclick = () => {
    if (!navigator.geolocation) return toast('Your browser does not support location');
    const btn = $('#gps'); btn.disabled = true; btn.textContent = 'Locating…';
    const done = () => { btn.disabled = false; btn.textContent = '📍 Use my location'; };
    const ticket = ++choice;
    navigator.geolocation.getCurrentPosition(async (p) => {
      const here = { lat: p.coords.latitude, lon: p.coords.longitude, label: 'My location' };
      try { const r = await api(`/external/reverse?lat=${here.lat}&lon=${here.lon}`); if (r.label) here.label = r.label; } catch { /* keep generic label */ }
      done();
      if (!stillCurrent(ticket)) return; // user picked another place, or left the page, while we were locating
      pos = here; load();
    }, (err) => {
      done();
      toast(err.code === 1 ? 'Location blocked. Allow it in the browser address bar, or search a place instead.'
        : err.code === 3 ? 'Location timed out. Try again or search a place.' : 'Could not determine your location. Search a place instead.');
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  };
  document.querySelectorAll('[data-place]').forEach((b) => { b.onclick = () => { ++choice; pos = { lat: +b.dataset.lat, lon: +b.dataset.lon, label: b.dataset.place }; load(); }; });
  load();
}
