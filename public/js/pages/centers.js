// Evacuation centers: public list sorted by distance; admin CRUD.
import { $, view, esc, pill, api, toast, formData, state, currentLocation } from '../core.js';

export async function centersPage() {
  const admin = state.me?.role === 'admin';
  const p = currentLocation();
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
