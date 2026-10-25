const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { attachUser } = require('./auth');
const { setLogger } = require('./services/http');

function createApp(db) {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway proxies

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org','https://cdn.jsdelivr.net'],
        connectSrc: ["'self'"],
      },
    },
    // OSM's tile policy blocks requests without a Referer; helmet's default is no-referrer
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const logCall = db.prepare('INSERT INTO api_log (service, ok, ms) VALUES (?,?,?)');
  setLogger((service, ok, ms) => { try { logCall.run(service, ok ? 1 : 0, ms); } catch { /* never break a request for logging */ } });

  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10000 : 240, standardHeaders: true, legacyHeaders: false }));
  app.use('/api', attachUser(db));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/external', require('./routes/external')());
  app.use('/api/centers', require('./routes/centers')(db));
  app.use('/api/reports', require('./routes/reports')(db));
  app.use('/api/checklist', require('./routes/checklist')(db));
  app.use('/api/admin', require('./routes/admin')(db));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
  });
  return app;
}

module.exports = { createApp };
