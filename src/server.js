const { openDb, seedAdmin, seedDemoCenters } = require('./db');
const { createApp } = require('./app');

const db = openDb();
seedAdmin(db);
if (process.env.SEED_DEMO !== 'false') seedDemoCenters(db);

const port = process.env.PORT || 3000;
createApp(db).listen(port, () => {
  console.log(`BantayAlerto running on http://localhost:${port}`);
  if (!process.env.ADMIN_PASSWORD) console.warn('Using default admin login admin@bantay.local / Admin123! - set ADMIN_EMAIL and ADMIN_PASSWORD for production.');
});
