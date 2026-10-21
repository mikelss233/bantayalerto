const jwt = require('jsonwebtoken');
const { HttpError } = require('./util');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const sign = (user) => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '7d' });

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 };
}

// Loads the user fresh from the DB so role changes / deletions take effect immediately.
function attachUser(db) {
  return (req, _res, next) => {
    const token = req.cookies?.token;
    if (token) {
      try {
        const { id } = jwt.verify(token, SECRET);
        req.user = db.prepare('SELECT id, name, email, role, phone, city, lat, lon FROM users WHERE id = ?').get(id) || null;
      } catch { req.user = null; }
    }
    next();
  };
}

const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in')));
const requireAdmin = (req, _res, next) =>
  !req.user ? next(new HttpError(401, 'Please log in')) : req.user.role !== 'admin' ? next(new HttpError(403, 'Admins only')) : next();

module.exports = { sign, cookieOptions, attachUser, requireAuth, requireAdmin };
