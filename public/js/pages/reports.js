// Incident reports: full CRUD (users: own pending reports; admins: all, plus status).
import { $, view, esc, pill, fmtDate, api, toast, formData, state } from '../core.js';

export async function reportsPage() {
  const meta = await api('/reports/meta');
  const admin = state.me.role === 'admin';
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
