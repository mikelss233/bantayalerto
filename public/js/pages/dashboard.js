// Admin dashboard: totals, Chart.js charts, API health, latest reports.
import { $, view, esc, pill, api, state } from '../core.js';

export async function adminPage() {
  const s = await api('/admin/stats'); const t = s.totals;
  const stat = (n, l) => `<div class="card stat"><b>${n}</b><span>${l}</span></div>`;
  const pct = s.capacity.capacity ? Math.round(s.capacity.occupancy / s.capacity.capacity * 100) : 0;
  view.innerHTML = `<h1>Admin dashboard</h1><div class="grid g4">${stat(t.users, 'Registered users')}${stat(t.reports, 'Incident reports')}${stat(t.pending, 'Pending review')}${stat(t.centers, 'Evacuation centers')}${stat(pct + '%', 'Center capacity used')}${stat(t.alerts, 'Alerts sent')}</div>
    <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Reports by type</h2><div class="chart"><canvas id="c1"></canvas></div></div>
    <div class="card"><h2>Reports by severity</h2><div class="chart"><canvas id="c2"></canvas></div></div>
    <div class="card"><h2>Reports per day (14 days)</h2><div class="chart"><canvas id="c3"></canvas></div></div>
    <div class="card"><h2>External API health (24h)</h2><div class="table-wrap">${s.apiHealth.length ? `<table><tr><th>Service</th><th>Calls</th><th>Success</th><th>Avg ms</th></tr>${s.apiHealth.map((a) => `<tr><td>${esc(a.service)}</td><td>${a.calls}</td><td>${Math.round(a.ok / a.calls * 100)}%</td><td>${a.avgMs}</td></tr>`).join('')}</table>` : '<p class="mut">No API calls yet. Open the Live Map first.</p>'}</div></div>
    <div class="card"><h2>Latest reports</h2>${s.recentReports.length ? '<ul class="clean">' + s.recentReports.map((r) => `<li>${pill(r.severity)} <b>${esc(r.title)}</b> <span class="small mut">${esc(r.reporter)} · ${pill(r.status)}</span></li>`).join('') + '</ul>' : '<p class="mut">None yet.</p>'}<a href="#/reports">Manage reports →</a></div></div>`;
  const mk = (id, type, rows) => { if (typeof Chart !== 'undefined') state.charts.push(new Chart($(id), { type, data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.value), backgroundColor: ['#1d4ed8', '#e8590c', '#2e9e5b', '#c92a2a', '#e0a800', '#7048e8', '#0c8599', '#868e96'], borderColor: '#1d4ed8' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: type === 'doughnut' } }, scales: type === 'doughnut' ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } } } })); };
  mk('#c1', 'bar', s.reportsByType); mk('#c2', 'doughnut', s.reportsBySeverity); mk('#c3', 'line', s.reportsPerDay);
}
