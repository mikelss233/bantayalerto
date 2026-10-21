const { Router } = require('express');
const { requireAdmin } = require('../auth');
const { tryGeocode } = require('../services/geocode');
const { HttpError, haversineKm, str, num, validCoords } = require('../util');

module.exports = (db) => {
  const r = Router();

  async function parse(body) {
    const name = str(body.name, 120), address = str(body.address, 250);
    if (!name || !address) throw new HttpError(400, 'Name and address are required');
    const capacity = Math.max(0, Math.floor(num(body.capacity) ?? 0));
    const occupancy = Math.max(0, Math.floor(num(body.occupancy) ?? 0));
    if (occupancy > capacity) throw new HttpError(400, 'Occupancy cannot exceed capacity');
    let status = ['open', 'full', 'closed'].includes(body.status) ? body.status : 'open';
    if (status === 'open' && capacity > 0 && occupancy >= capacity) status = 'full';
    let lat = num(body.lat), lon = num(body.lon);
    if (!validCoords(lat, lon)) { // auto-locate from the address via Nominatim
      const g = await tryGeocode(address);
      if (!g) throw new HttpError(400, 'Could not locate that address; please provide latitude and longitude');
      ({ lat, lon } = g);
    }
    return { name, address, lat, lon, capacity, occupancy, status, contact: str(body.contact, 60) };
  }

  r.get('/', (req, res) => {
    let rows = db.prepare('SELECT * FROM centers ORDER BY name').all();
    const lat = num(req.query.lat), lon = num(req.query.lon);
    if (validCoords(lat, lon)) {
      rows = rows.map((c) => ({ ...c, distanceKm: c.lat == null ? null : +haversineKm(lat, lon, c.lat, c.lon).toFixed(1) }))
        .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    }
    if (req.query.status) rows = rows.filter((c) => c.status === req.query.status);
    res.json(rows);
  });

  r.post('/', requireAdmin, async (req, res) => {
    const c = await parse(req.body);
    const info = db.prepare('INSERT INTO centers (name,address,lat,lon,capacity,occupancy,contact,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(c.name, c.address, c.lat, c.lon, c.capacity, c.occupancy, c.contact, c.status, req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM centers WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/:id', requireAdmin, async (req, res) => {
    if (!db.prepare('SELECT 1 FROM centers WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'Center not found');
    const c = await parse(req.body);
    db.prepare('UPDATE centers SET name=?,address=?,lat=?,lon=?,capacity=?,occupancy=?,contact=?,status=? WHERE id=?')
      .run(c.name, c.address, c.lat, c.lon, c.capacity, c.occupancy, c.contact, c.status, req.params.id);
    res.json(db.prepare('SELECT * FROM centers WHERE id = ?').get(req.params.id));
  });

  r.delete('/:id', requireAdmin, (req, res) => {
    const info = db.prepare('DELETE FROM centers WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Center not found');
    res.json({ ok: true });
  });

  return r;
};
