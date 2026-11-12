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
- Shared HTTP helper: timeouts, TTL cache, stale-on-error fallback, 60 s circuit breaker, per-call logging → graceful degradation if an API is down
- Provider fallbacks: Open-Meteo → MET Norway, Nominatim → Photon (both rate-limit shared cloud IPs such as Render's)
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

## Where to find things
```
bantay-alerto/
├── src/                      Backend (Node.js + Express)
│   ├── server.js             Start here: opens the DB, seeds admin + demo centers, starts the server
│   ├── app.js                Middleware order, security headers, mounts every route
│   ├── db.js                 Database tables, admin seeding, demo centers
│   ├── auth.js               Login cookie (JWT), requireAuth / requireAdmin
│   ├── util.js               Small helpers (distance, input cleaning, HttpError)
│   ├── routes/               One file per URL group (/api/...)
│   │   ├── auth.js           register, login, logout, me, profile
│   │   ├── reports.js        incident reports CRUD
│   │   ├── centers.js        evacuation centers CRUD
│   │   ├── checklist.js      preparedness checklist
│   │   ├── admin.js          dashboard stats, users, alerts
│   │   └── external.js       weather, quakes, events, geocode, reverse, /risk
│   └── services/             One file per outside API + the risk engine
│       ├── http.js           fetchJson: timeout, cache, circuit breaker, logging
│       ├── weather.js        Open-Meteo (fallback MET Norway)
│       ├── quakes.js         USGS Earthquake
│       ├── eonet.js          NASA EONET
│       ├── geocode.js        Nominatim (fallback Photon)
│       ├── notify.js         Semaphore SMS + Resend email
│       └── risk.js           risk score rules
├── public/                   Frontend (no build step)
│   ├── index.html            the one page
│   ├── css/style.css         all styling
│   └── js/
│       ├── main.js           entry point
│       ├── router.js         #/ routes, nav bar, login/admin guards
│       ├── core.js           shared helpers: api(), toast(), esc(), app state
│       └── pages/            one file per screen
│           ├── map.js        Live hazard map (#/)
│           ├── auth.js       Login / Register
│           ├── reports.js    Incident reports
│           ├── centers.js    Evacuation centers
│           ├── checklist.js  Checklist
│           ├── alerts.js     Alerts
│           ├── dashboard.js  Admin dashboard
│           └── users.js      User management
├── test/                     npm test (api.test.js, risk.test.js)
├── docs/                     System documentation (.docx) + screenshots
└── render.yaml               Render deployment
```

**Rule of thumb:** a screen → `public/js/pages/`; an `/api/...` URL → `src/routes/`; anything that talks to an outside API → `src/services/`.
