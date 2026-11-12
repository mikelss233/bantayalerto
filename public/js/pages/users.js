// Admin user management: promote/demote and delete accounts.
import { $, view, esc, pill, api, toast, state } from '../core.js';

export async function usersPage() {
  view.innerHTML = '<h1>Users</h1><div class="card table-wrap" id="l"></div>';
  const refresh = async () => {
    const rows = await api('/admin/users');
    $('#l').innerHTML = `<table><tr><th>Name</th><th>Contact</th><th>Role</th><th>Reports</th><th></th></tr>${rows.map((u) => `<tr><td><b>${esc(u.name)}</b><br><span class="small mut">${esc(u.city || '')}</span></td><td>${esc(u.email)}<br><span class="small mut">${esc(u.phone || '')}</span></td><td>${pill(u.role)}</td><td>${u.reports}</td>
      <td class="row">${u.id === state.me.id ? '<span class="small mut">you</span>' : `<button class="sm sec" data-role="${u.id}" data-to="${u.role === 'admin' ? 'user' : 'admin'}">Make ${u.role === 'admin' ? 'user' : 'admin'}</button><button class="sm danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table>`;
  };
  $('#l').onclick = async (e) => {
    try {
      if (e.target.dataset.role) { await api(`/admin/users/${e.target.dataset.role}/role`, { method: 'PUT', body: { role: e.target.dataset.to } }); refresh(); }
      if (e.target.dataset.del && confirm('Delete this user and all their data?')) { await api('/admin/users/' + e.target.dataset.del, { method: 'DELETE' }); refresh(); }
    } catch (err) { toast(err.message); }
  };
  refresh();
}
