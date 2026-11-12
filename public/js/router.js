// Hash router: maps #/path to a page, guards logged-in and admin-only pages, draws the nav bar.
import { $, view, esc, api, toast, state } from './core.js';
import { loginPage, registerPage } from './pages/auth.js';
import { home } from './pages/map.js';
import { reportsPage } from './pages/reports.js';
import { centersPage } from './pages/centers.js';
import { checklistPage } from './pages/checklist.js';
import { alertsPage } from './pages/alerts.js';
import { adminPage } from './pages/dashboard.js';
import { usersPage } from './pages/users.js';

function renderNav() {
  const links = [['#/', 'Live Map']];
  if (state.me) links.push(['#/reports', state.me.role === 'admin' ? 'All Reports' : 'My Reports'], ['#/centers', 'Evacuation Centers'], ['#/checklist', 'Checklist'], ['#/alerts', 'Alerts']);
  else links.push(['#/centers', 'Evacuation Centers']);
  if (state.me?.role === 'admin') links.push(['#/admin', 'Dashboard'], ['#/users', 'Users']);
  links.push(state.me ? ['#/logout', `Logout (${state.me.name.split(' ')[0]})`] : ['#/login', 'Login'], ...(state.me ? [] : [['#/register', 'Register']]));
  const cur = location.hash || '#/';
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}" class="${cur === h ? 'on' : ''}">${esc(t)}</a>`).join('');
}

const routes = {
  '/': home, '/login': loginPage, '/register': registerPage, '/reports': reportsPage, '/centers': centersPage,
  '/checklist': checklistPage, '/alerts': alertsPage, '/admin': adminPage, '/users': usersPage,
};
const needsAuth = ['/reports', '/checklist', '/alerts'];
const needsAdmin = ['/admin', '/users'];

export async function route() {
  state.charts.forEach((c) => c.destroy()); state.charts = [];
  if (state.map) { state.map.remove(); state.map = null; }
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (path === '/logout') { await api('/auth/logout', { method: 'POST' }); state.me = null; toast('Logged out'); location.hash = '#/'; return; }
  renderNav();
  if ((needsAuth.includes(path) || needsAdmin.includes(path)) && !state.me) { location.hash = '#/login'; return; }
  if (needsAdmin.includes(path) && state.me.role !== 'admin') { view.innerHTML = '<div class="card">Admins only.</div>'; return; }
  view.innerHTML = '<p class="mut">Loading…</p>';
  try { await (routes[path] || home)(); } catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
