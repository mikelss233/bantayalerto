const { Router } = require('express');
const { requireAuth } = require('../auth');
const { tryGeocode } = require('../services/geocode');
const { getWeather } = require('../services/weather');
const { HttpError, str, num, validCoords } = require('../util');

const TYPES = ['flood', 'landslide', 'fire', 'earthquake damage', 'fallen tree/power line', 'road blockage', 'missing person', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['pending', 'verified', 'resolved', 'rejected'];

module.exports = (db) => {
  const r = Router();
  r.use(requireAuth);
  const isAdmin = (req) => req.user.role === 'admin';

  function load(req) {
    const row = db.prepare('SELECT r.*, u.name AS reporter FROM reports r JOIN users u ON u.id = r.user_id WHERE r.id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'Report not found');
    if (!isAdmin(req) && row.user_id !== req.user.id) throw new HttpError(403, 'Not your report');
    return row;
  }

  r.get('/', (req, res) => {
    const where = [], args = [];
    if (!isAdmin(req)) { where.push('r.user_id = ?'); args.push(req.user.id); }
    for (const f of ['status', 'severity', 'type']) if (req.query[f]) { where.push(`r.${f} = ?`); args.push(req.query[f]); }
    const rows = db.prepare(
      `SELECT r.*, u.name AS reporter FROM reports r JOIN users u ON u.id = r.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC, r.id DESC`
    ).all(...args);
    res.json(rows.map((x) => ({ ...x, weather_snapshot: x.weather_snapshot ? JSON.parse(x.weather_snapshot) : null })));
  });

  r.get('/meta', (_req, res) => res.json({ types: TYPES, severities: SEVERITIES, statuses: STATUSES }));

  r.get('/:id', (req, res) => {
    const row = load(req);
    res.json({ ...row, weather_snapshot: row.weather_snapshot ? JSON.parse(row.weather_snapshot) : null });
  });

  r.post('/', async (req, res) => {
    const type = str(req.body.type, 40), title = str(req.body.title, 120);
    const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'medium';
    if (!TYPES.includes(type)) throw new HttpError(400, 'Choose a valid incident type');
    if (title.length < 3) throw new HttpError(400, 'Title is required (min 3 characters)');
    const address = str(req.body.address, 250);
    let lat = num(req.body.lat), lon = num(req.body.lon);
    if (!validCoords(lat, lon)) {
      lat = lon = null;
      if (address) { const g = await tryGeocode(address); if (g) ({ lat, lon } = g); }
    }
    // Attach the weather at the time/place of the report so responders have context.
    let snapshot = null;
    if (lat !== null) { try { const w = await getWeather(lat, lon); snapshot = JSON.stringify({ temperature: w.temperature, description: w.description, windSpeed: w.windSpeed, precipitation: w.precipitation }); } catch { /* optional */ } }
    const info = db.prepare('INSERT INTO reports (user_id,type,title,description,address,lat,lon,severity,weather_snapshot) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, type, title, str(req.body.description, 2000), address, lat, lon, severity, snapshot);
    req.params.id = info.lastInsertRowid;
    res.status(201).json(load(req));
  });

  r.put('/:id', (req, res) => {
    const row = load(req);
    const admin = isAdmin(req);
    if (!admin && row.status !== 'pending') throw new HttpError(409, 'Only pending reports can be edited');
    const type = str(req.body.type, 40) || row.type;
    const title = str(req.body.title, 120) || row.title;
    if (!TYPES.includes(type)) throw new HttpError(400, 'Invalid incident type');
    const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : row.severity;
    let status = row.status;
    if (req.body.status !== undefined) {
      if (!admin) throw new HttpError(403, 'Only admins can change status');
      if (!STATUSES.includes(req.body.status)) throw new HttpError(400, 'Invalid status');
      status = req.body.status;
    }
    db.prepare("UPDATE reports SET type=?,title=?,description=?,address=?,severity=?,status=?,updated_at=datetime('now') WHERE id=?")
      .run(type, title, req.body.description !== undefined ? str(req.body.description, 2000) : row.description,
        req.body.address !== undefined ? str(req.body.address, 250) : row.address, severity, status, row.id);
    res.json(load(req));
  });

  r.delete('/:id', (req, res) => {
    const row = load(req);
    if (!isAdmin(req) && row.status !== 'pending') throw new HttpError(409, 'Only pending reports can be deleted');
    db.prepare('DELETE FROM reports WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  return r;
};
