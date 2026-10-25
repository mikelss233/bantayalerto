const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DEFAULT_CHECKLIST = [
  'Prepare a go-bag (water, food, flashlight, radio, first-aid kit)',
  'Store 3 days of drinking water (4 liters per person per day)',
  'Save emergency hotline numbers on your phone',
  'Agree on a family meeting point and evacuation route',
  'Know the nearest evacuation center',
  'Keep copies of IDs and documents in a waterproof bag',
  'Charge power banks and keep a battery-powered radio',
  'Secure heavy furniture and know how to shut off power/gas',
];

function openDb(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bantay.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      phone TEXT,
      city TEXT,
      lat REAL, lon REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL, lon REAL,
      capacity INTEGER NOT NULL DEFAULT 0,
      occupancy INTEGER NOT NULL DEFAULT 0,
      contact TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','closed')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      address TEXT,
      lat REAL, lon REAL,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','resolved','rejected')),
      weather_snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'advisory',
      target_city TEXT,
      recipients INTEGER NOT NULL DEFAULT 0,
      delivery TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS api_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      ok INTEGER NOT NULL,
      ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_checklist_user ON checklist_items(user_id);
  `);
  return db;
}

function seedChecklist(db, userId) {
  const ins = db.prepare('INSERT INTO checklist_items (user_id, item) VALUES (?, ?)');
  db.transaction(() => DEFAULT_CHECKLIST.forEach((i) => ins.run(userId, i)))();
}

function seedAdmin(db) {
  const email = (process.env.ADMIN_EMAIL || 'admin@bantay.local').toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const info = db.prepare(
    "INSERT INTO users (name, email, password_hash, role, city) VALUES ('System Admin', ?, ?, 'admin', 'Quezon City')"
  ).run(email, bcrypt.hashSync(password, 10));
  seedChecklist(db, info.lastInsertRowid);
}

function seedDemoCenters(db) {
  const exists = db.prepare('SELECT 1 FROM centers WHERE name = ?');
  const ins = db.prepare('INSERT INTO centers (name, address, lat, lon, capacity, occupancy, contact, status) VALUES (?,?,?,?,?,?,?,?)');
  [
    ['Quezon City Hall Gymnasium', 'Elliptical Rd, Diliman, Quezon City', 14.6507, 121.0494, 600, 0, '8988-4242', 'open'],
    ['Marikina Sports Center', 'Shoe Ave, Sto. Niño, Marikina', 14.6339, 121.0959, 900, 120, '8646-2360', 'open'],
    ['Cainta Municipal Covered Court', 'Ortigas Ave Ext, Cainta, Rizal', 14.5786, 121.1222, 400, 400, '8655-1111', 'full'],
    ['Pasig City Evacuation Hub', 'Caruncho Ave, Pasig', 14.5764, 121.0851, 500, 0, '8643-1111', 'open'],
    // Iligan City demo centers - placeholders; admins can edit them to the real barangay sites.
    ['Iligan City Hall Gymnasium', 'City Hall area, Iligan City, Lanao del Norte', 8.2290, 124.2420, 700, 0, '', 'open'],
    ['Iligan Sports Complex', 'Iligan City, Lanao del Norte', 8.2315, 124.2575, 1000, 150, '', 'open'],
    ['Tubod Covered Court', 'Tubod, Iligan City, Lanao del Norte', 8.2180, 124.2310, 350, 0, '', 'open'],
  ].forEach((r) => { if (!exists.get(r[0])) ins.run(...r); });
}

module.exports = { openDb, seedAdmin, seedDemoCenters, seedChecklist, DEFAULT_CHECKLIST };
