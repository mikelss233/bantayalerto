const { Router } = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { sendSms, sendEmail } = require('../services/notify');
const { HttpError, str } = require('../util');

const LEVELS = ['advisory', 'watch', 'warning', 'emergency'];

module.exports = (db) => {
  const r = Router();

  // Anyone logged in can read broadcast alerts.
  r.get('/alerts', requireAuth, (_req, res) =>
    res.json(db.prepare('SELECT a.*, u.name AS sent_by FROM alerts a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 50').all()
      .map((a) => ({ ...a, delivery: a.delivery ? JSON.parse(a.delivery) : [] }))));

  r.use(requireAdmin);

  r.get('/stats', (_req, res) => {
    const one = (sql) => db.prepare(sql).get().c;
    const group = (sql) => db.prepare(sql).all();
    res.json({
      totals: {
        users: one("SELECT COUNT(*) c FROM users WHERE role='user'"),
        admins: one("SELECT COUNT(*) c FROM users WHERE role='admin'"),
        reports: one('SELECT COUNT(*) c FROM reports'),
        pending: one("SELECT COUNT(*) c FROM reports WHERE status='pending'"),
        centers: one('SELECT COUNT(*) c FROM centers'),
        alerts: one('SELECT COUNT(*) c FROM alerts'),
      },
      capacity: db.prepare("SELECT COALESCE(SUM(capacity),0) capacity, COALESCE(SUM(occupancy),0) occupancy FROM centers WHERE status != 'closed'").get(),
      reportsByType: group('SELECT type label, COUNT(*) value FROM reports GROUP BY type ORDER BY value DESC'),
      reportsByStatus: group('SELECT status label, COUNT(*) value FROM reports GROUP BY status'),
      reportsBySeverity: group('SELECT severity label, COUNT(*) value FROM reports GROUP BY severity'),
      reportsPerDay: group("SELECT date(created_at) label, COUNT(*) value FROM reports WHERE created_at >= date('now','-13 days') GROUP BY date(created_at) ORDER BY label"),
      apiHealth: group(`SELECT service, COUNT(*) calls, SUM(ok) ok, ROUND(AVG(ms)) avgMs, MAX(created_at) lastCall
                        FROM api_log WHERE created_at >= datetime('now','-1 day') GROUP BY service ORDER BY service`),
      recentReports: db.prepare('SELECT r.id, r.title, r.type, r.severity, r.status, r.created_at, u.name reporter FROM reports r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 5').all(),
    });
  });

  r.get('/users', (_req, res) => res.json(db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.city, u.created_at,
            (SELECT COUNT(*) FROM reports WHERE user_id = u.id) AS reports
     FROM users u ORDER BY u.id`).all()));

  r.put('/users/:id/role', (req, res) => {
    const role = req.body.role;
    if (!['admin', 'user'].includes(role)) throw new HttpError(400, 'Invalid role');
    if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot change your own role');
    const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    if (!info.changes) throw new HttpError(404, 'User not found');
    res.json({ ok: true });
  });

  r.delete('/users/:id', (req, res) => {
    if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'User not found');
    res.json({ ok: true });
  });

  // Broadcast an alert to users (optionally filtered by city) through SMS + email APIs.
  r.post('/alerts', async (req, res) => {
    const title = str(req.body.title, 100), message = str(req.body.message, 300);
    const level = LEVELS.includes(req.body.level) ? req.body.level : 'advisory';
    const city = str(req.body.city, 80);
    if (!title || !message) throw new HttpError(400, 'Title and message are required');
    // "Iligan", "Iligan City" and "City of Iligan" all target the same residents.
    const norm = (c) => String(c || '').toLowerCase().replace(/\b(city|of)\b/g, '').replace(/[^a-z]/g, '');
    const all = db.prepare("SELECT email, phone, city FROM users WHERE role='user'").all();
    const users = city ? all.filter((u) => norm(u.city) === norm(city)) : all;
    const text = `[${level.toUpperCase()}] ${title}: ${message}`;
    const delivery = await Promise.all([
      sendSms(users.map((u) => u.phone).filter(Boolean), text),
      sendEmail(users.map((u) => u.email), `[${level.toUpperCase()}] ${title}`, message),
    ]);
    const info = db.prepare('INSERT INTO alerts (admin_id,title,message,level,target_city,recipients,delivery) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, title, message, level, city || null, users.length, JSON.stringify(delivery));
    res.status(201).json({ id: info.lastInsertRowid, recipients: users.length, delivery });
  });

  return r;
};
