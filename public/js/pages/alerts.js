// Alerts: list for everyone logged in; broadcast form for admins.
import { $, view, esc, pill, fmtDate, api, toast, formData, state } from '../core.js';

export async function alertsPage() {
  const admin = state.me.role === 'admin';
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
