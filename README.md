# BantayAlerto – Disaster Readiness Portal

A web system that helps residents prepare for typhoons, floods and earthquakes, and lets
local officials manage evacuation centers, verify incident reports and broadcast alerts.

**Problem solved:** disaster information is scattered across many sites. BantayAlerto fuses
live weather, earthquake and natural-event data into one *explainable* risk score for any
location, points residents to the nearest open evacuation center, and gives admins the tools to respond.

## External APIs (6)
| # | API | Used for | Key needed |
|---|-----|----------|-----------|
| 1 | Open-Meteo (fallback: MET Norway) | Current weather + 3-day forecast, weather snapshot on each report | No |
| 2 | USGS Earthquake Catalog | Recent earthquakes near a location | No |
| 3 | NASA EONET | Active storms, floods, volcanoes | No |
| 4 | Nominatim (OpenStreetMap; fallback: Photon) | Place search (PH), reverse geocoding for "Use my location", user cities and center addresses | No |
| 5 | Leaflet + OpenStreetMap tiles | Interactive hazard map | No |
| 6 | Semaphore SMS / Resend email | Alert broadcasts to users | Optional (simulated if absent) |

## Core features
- Registration / login (bcrypt + JWT in httpOnly cookie), roles **admin** and **user** (self-signup is always `user`)
- SQLite database (users, centers, reports, alerts, checklist_items, api_log)
- **Full CRUD:** incident reports (users manage their own while pending; admins verify/resolve) and evacuation centers (admin)
- Admin dashboard: totals, Chart.js charts, center capacity, API health (success rate / latency per API), latest reports
- Preparedness checklist, alert broadcasts, user management (promote/demote/delete)

## Innovation / technical notes
- `src/services/risk.js` – pure, unit-tested scoring engine (rain, wind, nearby quakes, NASA events → Low/Moderate/High/Critical with reasons)
- Shared HTTP helper: timeouts, TTL cache, stale-on-error fallback, per-call logging → graceful degradation if an API is down
- Parameterized SQL, output escaping, helmet CSP, rate limiting, server-side validation and ownership checks

## Run locally
```bash
npm install
npm start              # http://localhost:3000
npm test               # 12 tests, external APIs mocked
```
Environment variables are listed in `.env.example`. Default admin: `admin@bantay.local` / `Admin123!`
(change via `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Deploy (free)
Push to GitHub → Render → New Web Service (uses `render.yaml`). Set `ADMIN_PASSWORD`.
Note: Render's free tier has an ephemeral disk, so the SQLite file resets on redeploy; for permanent data
add a Render disk, or swap `src/db.js` to Postgres/Supabase.

## Structure
`src/routes/*` REST endpoints · `src/services/*` API clients + risk engine · `public/` SPA frontend · `test/` tests
