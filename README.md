# AddisGo — city rides & small-group tours

A complete, self-hosted city guide for Addis Ababa: upfront-fare ride hailing with
nearest-driver matching and QR check-in, small-group tours with group chat, and a
full operations console (CRM) for drivers, riders, rides, tours, safety reports and
the audit log.

The product ships as **one Node process**: JSON API, SQLite storage and a zero-build
vanilla-JS frontend, plus a local copy of Leaflet. No bundler, no framework, no CDN
at runtime.

```
http://localhost:3003
```

---

## Quick start

**Requirements**

- Node.js **22.5+** (built with Node 24.22.0; `node:sqlite` is used directly)
- A modern browser
- Internet access for OpenStreetMap map tiles (the app itself works offline; maps
  fall back to a friendly placeholder)

**Windows**

```powershell
.\run.ps1
```

or double-click `run.bat`.

**Any platform**

```bash
npm install --prefix api
node api/server.js
```

The first start creates `data/addisgo.db`, seeds a demo city and writes a random
JWT signing secret to `data/jwt_secret`. The server listens on **3003** and
automatically tries 3004–3010 if 3003 is busy.

Stop with `Ctrl+C`. To start over with fresh demo data, stop the server and delete
`data/addisgo.db*` — the next start reseeds automatically.

---

## Demo accounts

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| Admin | `admin@addisgo.et` | `Admin123!` | Full operations console |
| Rider | `meron@example.com` | `Rider123!` | Active + past rides, joined tours |
| Driver | `dawit@example.com` | `Driver123!` | Approved, online, incoming requests |
| Driver | `samuel@example.com` | `Driver123!` | Application pending review |
| Guide | `selam@example.com` | `Guide123!` | Hosts tours |
| Guide | `nahom@example.com` | `Guide123!` | Hosts tours |

The sign-in screen also has one-tap demo chips for the admin, rider and driver
accounts.

> These credentials are for local demos only. Change them (or delete the seeded
> database) before exposing the app to a network.

---

## What is included

### Ride hailing

- Four classes with transparent pricing — **Electric E2**, **Comfort**, **Tour Van**
  and **Bajaj** — base fare + per-km + per-minute, class minimums, computed up front.
- Addis-only coordinate guard, road-distance estimate and a drawn route on the map.
- Pickup/dropoff search over curated landmarks, map pin picking and "use my location".
- Nearest-driver discovery sorted by real distance, with class, rating and ETA.
- Ride lifecycle: `requested → accepted → arriving → in_progress → completed`
  (plus `cancelled`), enforced server-side with role checks.
- Scheduled rides, rider/driver cancellation rules, ratings and receipts.
- **QR check-in**: every ride has a signed pass URL (`/api/bookings/:id/qr`) rendered
  as SVG; the driver scans or types the short code before starting the trip.
- Per-ride chat between rider and driver, live map tracking and driver location.

### City tours

- Curated small-group tours with theme, price, duration, meeting point and capacity.
- Join/leave with capacity and start-time rules, host controls and cancellation.
- Group chat for members and the host, polled live.
- "Ride here" pre-fills a ride request to the meeting point.
- Safety reporting on tours and profiles, with duplicate-report protection.

### CRM / operations console

- **Overview**: online drivers, trips today, revenue, bookings by status, live lists.
- **Drivers**: filter by status, approve / suspend / reinstate, view vehicle details.
- **People**: search riders, guides and admins, change role or suspend accounts.
- **Rides**: every booking with status, fare, parties and timestamps.
- **Tours**: upcoming and past tours with occupancy and hosts.
- **Safety**: triage reports (resolve / dismiss) with full context.
- **Audit log**: every sensitive action, who did it and when.

### Rider & driver dashboards

- Rider home: active ride card, recent trips, nearby drivers, recommended tours.
- Driver mode: online toggle with map location picker, live request queue with
  accept, trip state controls, earnings (today / week / lifetime), vehicle profile
  and verification status.
- Profile: details, avatar, language, password change and a safety centre.

---

## Project structure

```
City guide/
├─ api/                     Node API + static file server (zero build)
│  ├─ server.js             HTTP server: routing, headers, gzip, SPA fallback, ports
│  ├─ schema.sql            SQLite schema
│  ├─ lib/                  util, security, db, http, errors, context, seed
│  ├─ routes/               auth, drivers, bookings, tours, misc, admin
│  ├─ tests/                smoke.js (API), browser.js (headless UI), syntax.js
│  └─ node_modules/         only runtime dependency: qrcode-generator
├─ web/                     Frontend (vanilla ES modules, no build step)
│  ├─ index.html
│  ├─ styles.css            single stylesheet (source chunks are build-free edits)
│  ├─ js/                   router, store, api client, pages/, ui/
│  ├─ vendor/leaflet/       pinned Leaflet 1.9.x (local, no CDN)
│  └─ manifest.webmanifest  PWA metadata
├─ data/                    SQLite database + JWT secret (created on first run)
├─ server/                  Rust port kept as a reference/spec (not built or used)
├─ run.ps1 / run.bat        one-command start with version + dependency checks
└─ README.md
```

`server/` is an optional Rust re-implementation of the same API, kept for reference.
The shipped product runs entirely on Node; nothing in `server/` is required to run
or test the app.

---

## API overview

All endpoints live under `/api`. Responses are JSON; errors are
`{ "error": "message", "code": "machine_code" }`.

| Area | Endpoints |
| --- | --- |
| Public | `GET /health`, `GET /public/stats` |
| Session | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /profile`, `POST /profile/password` |
| Notifications | `GET /notifications`, `POST /notifications/read` |
| Safety | `POST /reports` |
| Drivers | `GET /drivers/nearby`, `GET /driver/me`, `PATCH /driver/status`, `PATCH /driver/profile`, `GET /driver/requests`, `POST /driver/verify` |
| Rides | `POST /estimate`, `GET /bookings`, `POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/accept`, `PATCH /bookings/:id/status`, `POST /bookings/:id/cancel`, `POST /bookings/:id/rate`, `GET /bookings/:id/qr`, `GET|POST /bookings/:id/messages` |
| Tours | `GET /tours`, `POST /tours`, `GET /tours/:id`, `POST /tours/:id/join`, `POST /tours/:id/leave`, `POST /tours/:id/cancel`, `GET|POST /tours/:id/messages` |
| Admin | `GET /admin/overview`, `GET /admin/drivers`, `PATCH /admin/drivers/:id`, `GET /admin/users`, `PATCH /admin/users/:id`, `GET /admin/bookings`, `GET /admin/tours`, `GET /admin/reports`, `PATCH /admin/reports/:id`, `GET /admin/audit` |

---

## Security model

- **Passwords**: `scrypt` with per-user salt, stored as
  `scrypt$N$r$p$salt$hash`; constant-time verification.
- **Sessions**: HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie (`addisgo_session`,
  7-day expiry), signed with a 512-bit secret generated on first run
  (`data/jwt_secret`, mode 0600). Set `ADDISGO_JWT_SECRET` (32+ chars) to override.
- **CSRF / origins**: mutating API calls require a same-origin `Origin` (or none for
  server-to-server tools). Extra origins can be allow-listed explicitly.
- **Headers**: strict CSP (`default-src 'self'`, scripts self-only, no inline
  scripts or `onclick` handlers), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, restrictive
  `Permissions-Policy`, and `Strict-Transport-Security` when `ADDISGO_HSTS=1`.
- **Rate limits**: every API call is capped per client address (1,200 reads and
  300 writes per minute by default), on top of the tighter per-account limits:
  login 20 / 10 min per email, password changes 5 / hour, chat 20 / min, driver
  verification 30 / min, reports 5 / hour. Responses are uniform so accounts
  cannot be enumerated, and `429` replies carry `Retry-After`.
- **Request IDs**: every response carries `X-Request-Id` (a caller-supplied id is
  echoed when it is well formed), and error bodies include `request_id` so a
  support report can be traced in the logs.
- **Idempotent writes**: `POST /bookings`, `POST /tours/:id/join`,
  `POST /reports` and `POST /newsletter/subscribe` accept an `Idempotency-Key`
  header. The first response is stored for 24 hours and replayed for retries, so
  a flaky mobile connection cannot create two rides.
- **Authorisation**: every route re-checks the session; riders only see their own
  rides, drivers only their assigned rides and nearby requests, and admin routes
  require the admin role. Rider phone numbers stay hidden from drivers until a ride
  is accepted.
- **Input**: strict validation and length caps on every field, integer IDs, Addis
  bounding-box checks, parameterised SQL only.
- **Audit trail**: sensitive actions are recorded with actor, action and timestamp.

For a real deployment put the app behind HTTPS, set `ADDISGO_COOKIE_SECURE=1`
and `ADDISGO_HSTS=1`, and replace the demo accounts. If a reverse proxy
terminates TLS, also set `ADDISGO_TRUST_PROXY=1` so rate limits and logs use the
real client address.

### Resilience

- **Email queue**: outgoing mail is written to `email_outbox` before delivery.
  Failures are retried in the background with equal-jitter exponential backoff
  (30 s doubling to a 6-hour cap, 5 attempts) and can be retried by hand from
  **Admin → Email & Google**. A crash mid-send is recovered on the next start.
- **Client timeouts**: browser requests abort after 15 seconds and surface a
  clear "took too long" message instead of hanging.
- **Retries**: `GET` requests retry twice on network errors, timeouts and
  `429/502/503/504`, honouring `Retry-After`. Writes only retry when an
  idempotency key is present.
- **Database**: SQLite runs in WAL mode with a 5-second busy timeout, and every
  multi-step write uses `BEGIN IMMEDIATE`.


---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3003` | First port to try (falls back up to +7) |
| `ADDISGO_DATA_DIR` | `./data` | Directory for the database and secret |
| `ADDISGO_DB` | `<data>/addisgo.db` | Explicit SQLite file path |
| `ADDISGO_WEB_DIST` | `./web` | Static frontend root |
| `ADDISGO_JWT_SECRET` | generated | JWT signing secret (32+ characters) |
| `ADDISGO_COOKIE_SECURE` | off | `1` adds `Secure` to the session cookie (HTTPS) |
| `ADDISGO_ALLOWED_ORIGINS` | empty | Comma-separated extra allowed origins |
| `ADDISGO_RATE_LIMIT_READ` | `1200` | Global read requests per minute per client |
| `ADDISGO_RATE_LIMIT_WRITE` | `300` | Global write requests per minute per client |
| `ADDISGO_TRUST_PROXY` | off | `1` trusts `X-Forwarded-For` for client identity |
| `ADDISGO_HSTS` | off | `1` sends `Strict-Transport-Security` (HTTPS only) |
| `ADDISGO_EMAIL_WORKER` | on | `0` disables the background email retry worker (tests) |
| `ADDISGO_LOG` | off | `1` logs every request/error to stderr |

Values can also be placed in a `.env` file in the project root (loaded on start).

### Gmail / email delivery

Out of the box AddisGo writes outgoing mail to `data/emails.log` so the app works
without any credentials. To deliver real email through a personal or Workspace
Gmail account:

1. Sign in to the Google account AddisGo should send from.
2. Turn on **2-Step Verification**: <https://myaccount.google.com/security>.
3. Open **App passwords**: <https://myaccount.google.com/apppasswords>.
4. Create an app password named `AddisGo` and copy the 16 letters.
5. In the app open **Admin → Email & Google**, enter the Gmail address and the
   app password, then press **Verify & save**.
6. Send a test email from the same screen.

The server stores the credentials in the `meta` table (`smtp_user`, `smtp_pass`,
`smtp_host`, `smtp_port`, `smtp_from`) and always uses `smtp.gmail.com` on port
465 for Gmail addresses. Spaces in an app password are removed automatically.
Verification calls Google's SMTP server without sending mail; failures are
shown with an actionable reason (wrong app password, blocked port, TLS, etc.).
Use **Disconnect Gmail** to remove the stored credentials and return to the
local dev log.

Environment variables `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT` and
`SMTP_FROM` are used as fallbacks when nothing is saved in the admin screen.

---

## Tests

Start the server first, then:

```bash
node api/tests/smoke.js              # 68-check end-to-end API suite
node api/tests/email.js              # Gmail config, verification and fallback checks
node api/tests/hardening.js          # rate limits, request ids, idempotency and email retry
node api/tests/phase1.js             # ratings, cancellations and dispatch checks
node api/tests/phase2plus.js         # presence, revenue, analytics and area checks
node api/tests/browser.js            # headless Chrome UI suite (71 checks)
node api/tests/syntax.js             # parses every frontend module
```

`smoke.js` mutates the demo database (creates bookings, approves a driver, cancels a
tour). Delete `data/addisgo.db*` and restart to get pristine demo data again.

`browser.js` drives local Chrome (or Edge) over the DevTools protocol at desktop and
390 px mobile widths and fails on console errors or horizontal overflow. Override
the browser with `ADDISGO_CHROME=<path>` and the target with
`ADDISGO_BASE=http://localhost:3004`.

`npm test --prefix api` runs the smoke suite, `npm run test:email --prefix api` the
Gmail suite, `npm run test:hardening --prefix api` the rate-limit/idempotency suite,
`npm run test:ui --prefix api` the UI suite and
`npm run check --prefix api` the parser check - all without extra dependencies.

---

## Notes & limits

- Map tiles come from OpenStreetMap; without internet the app still works and shows
  a map placeholder. Leaflet itself is served locally.
- Payment is modelled in the booking record (fare, class, receipt) but no payment
  provider is connected in this demo.
- SMS/email delivery is out of scope; notifications are in-app.
- The seed data is fictional and for demonstration only.

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- [Leaflet](https://leafletjs.com) (BSD-2-Clause), vendored.
- QR encoding by [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
