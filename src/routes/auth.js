const { Router } = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { sign, cookieOptions, requireAuth } = require('../auth');
const { seedChecklist } = require('../db');
const { tryGeocode } = require('../services/geocode');
const { HttpError, str, num, validCoords } = require('../util');

module.exports = (db) => {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false });

  r.post('/register', limiter, async (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const phone = str(req.body.phone, 20);
    const city = str(req.body.city, 80);
    if (!name) throw new HttpError(400, 'Name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'A valid email is required');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (phone && !/^(\+?63|0)9\d{9}$/.test(phone.replace(/[\s-]/g, ''))) throw new HttpError(400, 'Use a valid PH mobile number (e.g. 09171234567)');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email is already registered');

    let lat = num(req.body.lat), lon = num(req.body.lon);
    if (!validCoords(lat, lon)) {
      lat = lon = null;
      if (city) { const g = await tryGeocode(city, { preferPlaces: true }); if (g) ({ lat, lon } = g); }
    }
    // Self-registration is ALWAYS role "user"; admins are seeded or promoted by an existing admin.
    const info = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, city, lat, lon) VALUES (?,?,?,?,?,?,?,?)')
      .run(name, email, bcrypt.hashSync(password, 10), 'user', phone || null, city || null, lat, lon);
    seedChecklist(db, info.lastInsertRowid);
    const user = db.prepare('SELECT id, name, email, role, phone, city, lat, lon FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.cookie('token', sign(user), cookieOptions()).status(201).json({ user });
  });

  r.post('/login', limiter, (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(String(req.body.password || ''), row.password_hash)) throw new HttpError(401, 'Invalid email or password');
    const { password_hash, created_at, ...user } = row;
    res.cookie('token', sign(user), cookieOptions()).json({ user });
  });

  r.post('/logout', (_req, res) => res.clearCookie('token').json({ ok: true }));
  r.get('/me', (req, res) => res.json({ user: req.user || null }));

  r.put('/profile', requireAuth, async (req, res) => {
    const name = str(req.body.name, 80) || req.user.name;
    const phone = str(req.body.phone, 20);
    const city = str(req.body.city, 80);
    if (phone && !/^(\+?63|0)9\d{9}$/.test(phone.replace(/[\s-]/g, ''))) throw new HttpError(400, 'Use a valid PH mobile number');
    let { lat, lon } = req.user;
    if (city && city !== req.user.city) { const g = await tryGeocode(city, { preferPlaces: true }); if (g) ({ lat, lon } = g); }
    db.prepare('UPDATE users SET name=?, phone=?, city=?, lat=?, lon=? WHERE id=?').run(name, phone || null, city || null, lat, lon, req.user.id);
    res.json({ user: db.prepare('SELECT id, name, email, role, phone, city, lat, lon FROM users WHERE id = ?').get(req.user.id) });
  });

  return r;
};
