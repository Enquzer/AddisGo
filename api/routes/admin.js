import { AppError } from '../lib/errors.js';
import { requireAdmin } from '../lib/context.js';
import { BOOKING_SELECT, audit, mapBooking, notify, tourView } from '../lib/db.js';
import { hashPassword } from '../lib/security.js';
import { closeSession, fleetAirtime } from '../lib/sessions.js';
import { revenueSummary, saveRevenueConfig, settleBooking } from '../lib/revenue.js';
import { demandCells } from '../lib/geocell.js';
import { analyticsSummary } from '../lib/webstats.js';
import {
  avatarColorFor, charLen, daysAgo, isoFrom, nowIso, round1, todayUtc, validColor, validEmail, validPhone,
} from '../lib/util.js';

const ADMIN_DRIVER_SELECT = `SELECT d.id, d.user_id, u.name, u.email, u.phone, u.avatar_color, u.avatar_url,
    d.vehicle_class, d.make_model, d.plate, d.color, d.license_no, d.status, u.status AS user_status,
    d.is_online, d.lat, d.lng, d.rating, d.rating_count, d.trips, d.created_at, d.approved_at
 FROM drivers d JOIN users u ON u.id = d.user_id`;

function mapAdminDriver(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatar_color: row.avatar_color,
    avatar_url: row.avatar_url ?? '',
    vehicle_class: row.vehicle_class,
    make_model: row.make_model,
    plate: row.plate,
    color: row.color ?? '',
    license_no: row.license_no,
    status: row.status,
    user_status: row.user_status,
    is_online: Boolean(row.is_online),
    lat: row.lat,
    lng: row.lng,
    rating: Number(row.rating ?? 5),
    rating_count: Number(row.rating_count ?? 0),
    trips: Number(row.trips ?? 0),
    created_at: row.created_at,
    approved_at: row.approved_at,
  };
}

const DRIVER_STATUSES = ['pending', 'approved', 'suspended'];
const BOOKING_STATUSES = ['requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled'];
const VEHICLE_CLASSES = ['e2', 'comfort', 'van'];

const ADMIN_USER_SELECT = `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.is_verified,
    u.avatar_color, u.avatar_url, u.bio, u.created_at,
    (SELECT status FROM drivers WHERE user_id = u.id) AS driver_status,
    (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id
       OR b.driver_id = (SELECT id FROM drivers WHERE user_id = u.id)) AS bookings
  FROM users u`;

function mapAdminUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    role: row.role,
    status: row.status,
    is_verified: Boolean(row.is_verified),
    avatar_color: row.avatar_color,
    avatar_url: row.avatar_url ?? '',
    bio: row.bio ?? '',
    created_at: row.created_at,
    driver_status: row.driver_status ?? null,
    bookings: Number(row.bookings ?? 0),
  };
}

function readText(value, field, { min = 0, max = 160, required = false } = {}) {
  const out = String(value ?? '').trim();
  const len = charLen(out);
  if (required && len === 0) throw AppError.bad(`${field} is required.`);
  if (len < min || len > max) throw AppError.bad(`${field} must be ${min}–${max} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)) {
    throw AppError.bad(`${field} contains unsupported characters.`);
  }
  return out;
}

function readPhone(value, { required = false } = {}) {
  const out = String(value ?? '').trim();
  if (!out) {
    if (required) throw AppError.bad('Phone number is required.');
    return '';
  }
  if (!validPhone(out)) throw AppError.bad('Enter a valid phone number (7–15 digits).');
  return out;
}

function readPassword(value) {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw AppError.bad('Password must be 8–128 characters with at least one letter and one number.');
  }
  return password;
}

function readVehicle(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.vehicle_class !== undefined) {
    const value = String(body.vehicle_class ?? '').trim().toLowerCase();
    if (!VEHICLE_CLASSES.includes(value)) throw AppError.bad('Please choose a valid vehicle class.');
    out.vehicle_class = value;
  }
  if (!partial || body.make_model !== undefined) {
    out.make_model = readText(body.make_model, 'Vehicle make and model', { min: 2, max: 60, required: true });
  }
  if (!partial || body.plate !== undefined) {
    out.plate = readText(body.plate, 'Plate number', { min: 2, max: 20, required: true }).toUpperCase();
  }
  if (!partial || body.color !== undefined) {
    out.color = readText(body.color, 'Vehicle colour', { min: 0, max: 30 });
  }
  if (!partial || body.license_no !== undefined) {
    out.license_no = readText(body.license_no, 'Driving licence number', { min: 2, max: 40, required: true }).toUpperCase();
  }
  return out;
}

function driverDependents(db, driverId) {
  return Number(db.get('SELECT COUNT(*) AS n FROM bookings WHERE driver_id = ?', [driverId]).n ?? 0);
}

export async function overview(ctx) {
  requireAdmin(ctx);
  const today = todayUtc();
  const scalar = (sql, params = []) => Number(ctx.db.get(sql, params).n ?? 0);

  const totalUsers = scalar('SELECT COUNT(*) AS n FROM users');
  const customers = scalar("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'");
  const driversTotal = scalar("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved'");
  const driversPending = scalar("SELECT COUNT(*) AS n FROM drivers WHERE status = 'pending'");
  const driversOnline = scalar("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved' AND is_online = 1");
  const activeRides = scalar(
    "SELECT COUNT(*) AS n FROM bookings WHERE status IN ('requested', 'accepted', 'arriving', 'in_progress')",
  );
  const todayBookings = scalar('SELECT COUNT(*) AS n FROM bookings WHERE substr(created_at, 1, 10) = ?', [today]);
  const completedTotal = scalar("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'");
  const revenueTotal = scalar("SELECT COALESCE(SUM(fare), 0) AS n FROM bookings WHERE status = 'completed'");
  const revenueToday = scalar(
    "SELECT COALESCE(SUM(fare), 0) AS n FROM bookings WHERE status = 'completed' AND substr(completed_at, 1, 10) = ?",
    [today],
  );
  const toursUpcoming = scalar("SELECT COUNT(*) AS n FROM tours WHERE status = 'upcoming'");
  const reportsOpen = scalar("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'");
  const avgRow = ctx.db.get("SELECT COALESCE(AVG(rating), 5.0) AS avg FROM drivers WHERE status = 'approved'");

  const chart = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const iso = isoFrom(Date.now() - offset * 86400000);
    const date = iso.slice(0, 10);
    const rides = scalar('SELECT COUNT(*) AS n FROM bookings WHERE substr(created_at, 1, 10) = ?', [date]);
    const revenue = scalar(
      "SELECT COALESCE(SUM(fare), 0) AS n FROM bookings WHERE status = 'completed' AND substr(completed_at, 1, 10) = ?",
      [date],
    );
    chart.push({ date, rides, revenue });
  }

  const recentBookings = ctx.db
    .all(`${BOOKING_SELECT} ORDER BY b.created_at DESC LIMIT 8`)
    .map(mapBooking);
  const pendingDrivers = ctx.db
    .all(`${ADMIN_DRIVER_SELECT} WHERE d.status = 'pending' ORDER BY d.created_at ASC LIMIT 6`)
    .map(mapAdminDriver);

  return {
    stats: {
      total_users: totalUsers,
      customers,
      drivers_total: driversTotal,
      drivers_pending: driversPending,
      drivers_online: driversOnline,
      active_rides: activeRides,
      today_bookings: todayBookings,
      completed_total: completedTotal,
      revenue_total: revenueTotal,
      revenue_today: revenueToday,
      tours_upcoming: toursUpcoming,
      reports_open: reportsOpen,
      avg_rating: round1(Number(avgRow?.avg ?? 5)),
    },
    chart,
    recent_bookings: recentBookings,
    pending_drivers: pendingDrivers,
  };
}

export async function insights(ctx) {
  requireAdmin(ctx);
  const requestedDays = Number(ctx.query.get('days'));
  const days = Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(Math.round(requestedDays), 365) : 30;
  const since = daysAgo(days);
  const scalar = (sql, params = []) => Number(ctx.db.get(sql, params)?.n ?? 0);

  /* --- Cancellations ---------------------------------------------------- */
  const cancelRows = ctx.db.all(
    `SELECT reason_code, blame_party, cancelled_by_role, COUNT(*) AS n
       FROM cancellations
      WHERE created_at >= ?
      GROUP BY reason_code, blame_party, cancelled_by_role
      ORDER BY n DESC`,
    [since],
  );
  const cancellationTotal = cancelRows.reduce((sum, row) => sum + Number(row.n), 0);
  const byReason = cancelRows.map((row) => ({
    code: row.reason_code,
    blame: row.blame_party,
    role: row.cancelled_by_role,
    count: Number(row.n),
    share: cancellationTotal ? round1((Number(row.n) / cancellationTotal) * 100) : 0,
  }));
  const byBlame = { rider: 0, driver: 0, platform: 0, none: 0 };
  const byRole = { rider: 0, driver: 0, admin: 0, system: 0 };
  for (const row of cancelRows) {
    byBlame[row.blame_party] = (byBlame[row.blame_party] ?? 0) + Number(row.n);
    byRole[row.cancelled_by_role] = (byRole[row.cancelled_by_role] ?? 0) + Number(row.n);
  }

  /* --- Ratings ---------------------------------------------------------- */
  const ratingRows = ctx.db.all(
    `SELECT overall, COUNT(*) AS n
       FROM ratings
      WHERE created_at >= ? AND rater_role = 'rider'
      GROUP BY overall`,
    [since],
  );
  const ratingDist = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: Number(ratingRows.find((row) => Number(row.overall) === stars)?.n ?? 0),
  }));
  const ratingTotal = ratingDist.reduce((sum, row) => sum + row.count, 0);
  const avgOverall = ctx.db.get(
    `SELECT AVG(overall) AS avg FROM ratings WHERE created_at >= ? AND rater_role = 'rider'`,
    [since],
  );

  const aspectRow = ctx.db.get(
    `SELECT AVG(car_condition) AS car_condition, AVG(comfort) AS comfort,
            AVG(cleanliness) AS cleanliness, AVG(service) AS service,
            AVG(safety) AS safety, AVG(punctuality) AS punctuality
       FROM ratings
      WHERE created_at >= ? AND rater_role = 'rider'`,
    [since],
  );
  const aspects = ['car_condition', 'comfort', 'cleanliness', 'service', 'safety', 'punctuality']
    .map((key) => ({
      key,
      avg: aspectRow?.[key] == null ? null : round1(Number(aspectRow[key])),
    }));

  const tagCounts = new Map();
  for (const row of ctx.db.all(
    `SELECT tags FROM ratings WHERE created_at >= ? AND rater_role = 'rider'`,
    [since],
  )) {
    let list = [];
    try { list = JSON.parse(row.tags || '[]'); } catch { list = []; }
    for (const tag of list) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, count }));

  /* --- Punctuality (measured, not asked) -------------------------------- */
  const punct = ctx.db.get(
    `SELECT AVG((julianday(arrived_at) - julianday(accepted_at)) * 1440 - promised_eta_min) AS avg_delay,
            COUNT(*) AS n
       FROM bookings
      WHERE accepted_at IS NOT NULL AND arrived_at IS NOT NULL
        AND promised_eta_min IS NOT NULL AND created_at >= ?`,
    [since],
  );

  /* --- Demand ----------------------------------------------------------- */
  const hourRows = ctx.db.all(
    `SELECT CAST(substr(created_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS n
       FROM bookings WHERE created_at >= ? GROUP BY hour ORDER BY hour`,
    [since],
  );
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: Number(hourRows.find((row) => Number(row.hour) === hour)?.n ?? 0),
  }));
  const peak = byHour.reduce((best, row) => (row.count > best.count ? row : best), { hour: 0, count: 0 });

  // Phase 4 — geohash cells (~1.2 km) replace the old rounded-coordinate grid.
  const cells = demandCells(ctx.db, { since, days });
  const areas = cells.cells.map((cell) => ({
    cell: cell.cell,
    lat: cell.lat,
    lng: cell.lng,
    sample: cell.sample,
    requests: cell.requests,
    completed: cell.completed,
    cancelled: cell.cancelled,
    active: cell.active,
    gross: cell.gross,
    avg_fare: cell.avg_fare,
    success_rate: cell.success_rate,
    request_share: cell.request_share,
    gross_share: cell.gross_share,
    success_delta: cell.success_delta,
    pressure: cell.pressure,
    surge: cell.surge,
    online_drivers: cell.online_drivers,
    peak_hour: cell.peak_hour,
  }));

  /* --- Fleet presence / air-time (Phase 2) ------------------------------ */
  const fleet = fleetAirtime(ctx.db, since);

  /* --- People ----------------------------------------------------------- */
  const roleRows = ctx.db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role');
  const roles = { customer: 0, driver: 0, admin: 0 };
  for (const row of roleRows) roles[row.role] = Number(row.n);

  const languageRows = ctx.db.all(
    `SELECT languages FROM users WHERE role = 'customer'`,
  );
  const languageCounts = new Map();
  for (const row of languageRows) {
    for (const part of String(row.languages || '').split(',')) {
      const name = part.trim();
      if (!name) continue;
      languageCounts.set(name, (languageCounts.get(name) ?? 0) + 1);
    }
  }
  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const newUsers = scalar('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', [since]);
  const verifiedRiders = scalar(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND is_verified = 1",
  );

  // Request frequency: how many completed rides did each rider take in the window?
  const frequencyRows = ctx.db.all(
    `SELECT customer_id, COUNT(*) AS n FROM bookings
      WHERE status = 'completed' AND created_at >= ?
      GROUP BY customer_id`,
    [since],
  );
  const buckets = { once: 0, '2-5': 0, '6-10': 0, '10+': 0 };
  for (const row of frequencyRows) {
    const n = Number(row.n);
    if (n <= 1) buckets.once += 1;
    else if (n <= 5) buckets['2-5'] += 1;
    else if (n <= 10) buckets['6-10'] += 1;
    else buckets['10+'] += 1;
  }
  const ridersWithTrips = frequencyRows.length;
  const ridesTotal = frequencyRows.reduce((sum, row) => sum + Number(row.n), 0);

  const topDrivers = ctx.db.all(
    `SELECT d.id, u.name, d.rating, d.rating_count, d.trips, d.vehicle_class, d.is_online
       FROM drivers d JOIN users u ON u.id = d.user_id
      WHERE d.status = 'approved'
      ORDER BY d.rating DESC, d.rating_count DESC
      LIMIT 5`,
  ).map((row) => ({
    id: row.id,
    name: row.name,
    rating: round1(Number(row.rating)),
    rating_count: Number(row.rating_count),
    trips: Number(row.trips),
    vehicle_class: row.vehicle_class,
    is_online: Boolean(row.is_online),
  }));
  /* --- Fulfilment ------------------------------------------------------- */
  const statusRows = ctx.db.all(
    'SELECT status, COUNT(*) AS n FROM bookings WHERE created_at >= ? GROUP BY status',
    [since],
  );
  const funnel = {};
  for (const row of statusRows) funnel[row.status] = Number(row.n);
  const totalRequests = statusRows.reduce((sum, row) => sum + Number(row.n), 0);
  const noDriverFound = scalar(
    "SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ? AND dispatch_state = 'failed'",
    [since],
  );
  const redispatchCount = scalar(
    "SELECT COUNT(*) AS n FROM cancellations WHERE created_at >= ? AND outcome = 'redispatch'",
    [since],
  );

  /* --- People ----------------------------------------------------------- */
  const topRiders = ctx.db.all(
    `SELECT u.id, u.name, u.rating, u.rating_count, COUNT(b.id) AS trips
       FROM users u
       LEFT JOIN bookings b
         ON b.customer_id = u.id AND b.status = 'completed' AND b.created_at >= ?
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY trips DESC, u.id ASC
      LIMIT 5`,
    [since],
  ).map((row) => ({
    id: row.id,
    name: row.name,
    rating: round1(Number(row.rating)),
    rating_count: Number(row.rating_count),
    trips: Number(row.trips),
  }));

  const riderScores = ctx.db.get(
    "SELECT AVG(rating) AS avg, COUNT(*) AS n FROM users WHERE role = 'customer' AND rating_count > 0",
  );

  return {
    window_days: days,
    since,
    requests: {
      total: totalRequests,
      completed: funnel.completed ?? 0,
      cancelled: funnel.cancelled ?? 0,
      active: (funnel.requested ?? 0) + (funnel.accepted ?? 0) + (funnel.arriving ?? 0) + (funnel.in_progress ?? 0),
      no_driver_found: noDriverFound,
      cancellation_rate: totalRequests ? round1(((funnel.cancelled ?? 0) / totalRequests) * 100) : 0,
    },
    cancellations: {
      total: cancellationTotal,
      by_reason: byReason,
      by_blame: byBlame,
      by_role: byRole,
      redispatched: redispatchCount,
    },
    ratings: {
      total: ratingTotal,
      average: avgOverall?.avg == null ? null : round1(Number(avgOverall.avg)),
      distribution: ratingDist,
      aspects,
      tags: topTags,
      rider_average: riderScores?.avg == null ? null : round1(Number(riderScores.avg)),
      riders_rated: Number(riderScores?.n ?? 0),
    },
    punctuality: {
      average_delay_min: punct?.avg_delay == null ? null : round1(Number(punct.avg_delay)),
      sample: Number(punct?.n ?? 0),
    },
    demand: {
      by_hour: byHour,
      peak_hour: peak.count ? peak.hour : null,
      areas,
      cells: cells.cells,
      heatmap: cells.heatmap,
      by_revenue: cells.by_revenue,
      totals: cells.totals,
      surge_suggestions: cells.surge_suggestions,
      online_supply: cells.online_supply,
      cells_covered: cells.cells_covered,
    },
    fleet: {
      online_now: fleet.online_now,
      sessions: fleet.sessions,
      app_closed_sessions: fleet.app_closed_sessions,
      app_closed_share: fleet.app_closed_share,
      online_minutes: fleet.online_minutes,
      idle_minutes: fleet.idle_minutes,
      avg_session_minutes: fleet.avg_session_minutes,
      avg_idle_minutes: fleet.avg_idle_minutes,
      acceptance_rate: fleet.acceptance_rate,
      offers: fleet.offers,
      accepted_offers: fleet.accepted_offers,
      declined_offers: fleet.declined_offers,
      drivers: fleet.drivers,
    },
    demographics: {
      roles,
      languages,
      new_users: newUsers,
      verified_riders: verifiedRiders,
      riders_with_trips: ridersWithTrips,
      avg_rides_per_rider: ridersWithTrips ? round1(ridesTotal / ridersWithTrips) : 0,
      frequency: [
        { bucket: 'once', riders: buckets.once },
        { bucket: '2-5', riders: buckets['2-5'] },
        { bucket: '6-10', riders: buckets['6-10'] },
        { bucket: '10+', riders: buckets['10+'] },
      ],
    },
    top_drivers: topDrivers,
    top_riders: topRiders,
  };
}

/* ------------------------------------------------------------------ */
/* Revenue (Phase 3)                                                   */
/* ------------------------------------------------------------------ */

export async function revenue(ctx) {
  requireAdmin(ctx);
  const requested = Number(ctx.query.get('days'));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 365) : 30;
  return revenueSummary(ctx.db, { days });
}

export async function updateRevenue(ctx) {
  const auth = requireAdmin(ctx);
  const body = ctx.body ?? {};
  const config = saveRevenueConfig(ctx.db, {
    model: body.model,
    commission_rate: body.commission_rate,
    incentive_rate: body.incentive_rate,
  });
  audit(
    ctx.db,
    auth.id,
    'revenue.updated',
    `Revenue model set to ${config.model} · commission ${config.commission_rate}% · incentive ${config.incentive_rate}%`,
  );
  return { config };
}

/* ------------------------------------------------------------------ */
/* Website audience (Phase 5)                                          */
/* ------------------------------------------------------------------ */

export async function analytics(ctx) {
  requireAdmin(ctx);
  const requested = Number(ctx.query.get('days'));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 365) : 30;
  return analyticsSummary(ctx.db, { days });
}

export async function drivers(ctx) {
  requireAdmin(ctx);
  const status = ctx.query.get('status');
  if (status) {
    if (!DRIVER_STATUSES.includes(status)) throw AppError.bad('Unknown driver status.');
    return {
      drivers: ctx.db
        .all(`${ADMIN_DRIVER_SELECT} WHERE d.status = ? ORDER BY d.created_at DESC`, [status])
        .map(mapAdminDriver),
    };
  }
  return { drivers: ctx.db.all(`${ADMIN_DRIVER_SELECT} ORDER BY d.created_at DESC`).map(mapAdminDriver) };
}

export async function updateDriver(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get(
    `SELECT d.id, d.user_id, d.status, d.vehicle_class, d.make_model, d.plate, d.color, d.license_no,
        u.name, u.status AS user_status
     FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
    [ctx.params.id],
  );
  if (!found) throw AppError.notFound('Driver not found.');

  const nextStatus = ctx.body.status === undefined
    ? found.status
    : String(ctx.body.status).trim().toLowerCase();
  if (!DRIVER_STATUSES.includes(nextStatus)) throw AppError.bad('Unknown driver status.');
  if (found.user_status === 'suspended' && nextStatus === 'approved') {
    throw AppError.conflict("Reactivate this user's account before approving them as a driver.");
  }

  const vehicle = readVehicle(ctx.body, { partial: true });
  const fields = ['status = ?', 'is_online = CASE WHEN ? = \'approved\' THEN is_online ELSE 0 END',
    'approved_at = CASE WHEN ? = \'approved\' AND approved_at IS NULL THEN ? ELSE approved_at END'];
  const params = [nextStatus, nextStatus, nextStatus, nowIso()];
  for (const [column, value] of Object.entries(vehicle)) {
    fields.push(`${column} = ?`);
    params.push(value);
  }
  params.push(ctx.params.id);
  ctx.db.run(`UPDATE drivers SET ${fields.join(', ')} WHERE id = ?`, params);

  if (nextStatus === 'approved') {
    ctx.db.run('UPDATE users SET is_verified = 1 WHERE id = ?', [found.user_id]);
  }
  // A suspended driver must stop receiving offers immediately.
  if (nextStatus !== 'approved') closeSession(ctx.db, found.id, 'suspended');
  if (nextStatus !== found.status) {
    if (nextStatus === 'approved') {
      notify(
        ctx.db,
        found.user_id,
        'driver',
        "You're approved to drive",
        'Welcome to AddisGo. Go online in the driver dashboard to start receiving nearby requests.',
        '#/driver',
      );
    } else if (nextStatus === 'suspended') {
      notify(
        ctx.db,
        found.user_id,
        'driver',
        'Driver account suspended',
        'Your driver access has been paused. Contact support@addisgo.et for a review.',
        '#/profile',
      );
    }
    audit(ctx.db, auth.id, 'driver.status_changed', `Driver #${ctx.params.id} (${found.name}) set to ${nextStatus}`);
  }
  if (Object.keys(vehicle).length) {
    audit(ctx.db, auth.id, 'driver.vehicle_updated', `Driver #${ctx.params.id} (${found.name}) vehicle details updated`);
  }

  const row = ctx.db.get(`${ADMIN_DRIVER_SELECT} WHERE d.id = ?`, [ctx.params.id]);
  if (!row) throw AppError.notFound('Driver not found.');
  return mapAdminDriver(row);
}

export async function deleteDriver(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get(
    `SELECT d.id, d.user_id, d.status, u.name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
    [ctx.params.id],
  );
  if (!found) throw AppError.notFound('Driver not found.');
  if (found.user_id === auth.id) throw AppError.bad('You cannot remove your own driver profile.');

  const rides = driverDependents(ctx.db, found.id);
  if (rides > 0) {
    throw AppError.conflict(
      `${found.name} has ${rides} ride${rides === 1 ? '' : 's'} on record. Suspend the driver instead of deleting the profile.`,
    );
  }

  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM drivers WHERE id = ?', [found.id]);
    ctx.db.run("UPDATE users SET role = 'customer', is_verified = 0 WHERE id = ?", [found.user_id]);
    notify(
      ctx.db,
      found.user_id,
      'driver',
      'Driver profile removed',
      'Your driver profile was removed by the AddisGo team. Your rider account is still active.',
      '#/profile',
    );
  });
  audit(ctx.db, auth.id, 'driver.deleted', `Driver #${found.id} (${found.name}) removed`);
  return { ok: true };
}

export async function users(ctx) {
  requireAdmin(ctx);
  let sql = `${ADMIN_USER_SELECT} WHERE 1 = 1`;
  const params = [];

  const q = (ctx.query.get('q') || '').trim();
  if (q) {
    sql += " AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')";
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  const role = ctx.query.get('role');
  if (role) {
    if (!['customer', 'driver', 'admin'].includes(role)) throw AppError.bad('Unknown role.');
    sql += ' AND u.role = ?';
    params.push(role);
  }
  sql += ' ORDER BY u.created_at DESC LIMIT 200';

  return { users: ctx.db.all(sql, params).map(mapAdminUser) };
}

export async function createUser(ctx) {
  const auth = requireAdmin(ctx);
  const body = ctx.body ?? {};
  const name = readText(body.name, 'Full name', { min: 2, max: 60, required: true });
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!validEmail(email)) throw AppError.bad('Enter a valid email address.');
  const phone = readPhone(body.phone);
  const role = String(body.role ?? 'customer').trim().toLowerCase();
  if (!['customer', 'driver', 'admin'].includes(role)) throw AppError.bad('Choose a valid role.');
  const password = readPassword(body.password);
  const bio = readText(body.bio, 'Bio', { min: 0, max: 400 });
  const isVerified = Boolean(body.is_verified) || role === 'driver';
  const avatarColor = validColor(body.avatar_color) ? body.avatar_color : avatarColorFor(name);

  if (ctx.db.get('SELECT id FROM users WHERE email = ?', [email])) {
    throw AppError.conflict('An account already uses this email address.');
  }
  const vehicle = role === 'driver' ? readVehicle(body) : null;

  const userId = ctx.db.tx(() => {
    const created = ctx.db.run(
      `INSERT INTO users (name, email, phone, password_hash, role, bio, languages, avatar_color,
          is_verified, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'English, Amharic', ?, ?, 'active', ?)`,
      [name, email, phone, hashPassword(password), role, bio, avatarColor, isVerified ? 1 : 0, nowIso()],
    );
    if (vehicle) {
      ctx.db.run(
        `INSERT INTO drivers (user_id, vehicle_class, make_model, plate, color, license_no, status,
            is_online, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
        [created.lastInsertRowid, vehicle.vehicle_class, vehicle.make_model, vehicle.plate,
          vehicle.color ?? '', vehicle.license_no, nowIso()],
      );
    }
    return created.lastInsertRowid;
  });

  notify(
    ctx.db,
    userId,
    'account',
    'Welcome to AddisGo',
    role === 'driver'
      ? 'Your driver application is in review. We will let you know as soon as it is approved.'
      : 'Your account is ready. Book your first electric ride or join a city tour.',
    role === 'driver' ? '#/driver' : '#/',
  );
  audit(ctx.db, auth.id, 'user.created', `User #${userId} (${name}) created as ${role}`);
  return mapAdminUser(ctx.db.get(`${ADMIN_USER_SELECT} WHERE u.id = ?`, [userId]));
}

export async function updateUser(ctx) {
  const auth = requireAdmin(ctx);
  if (String(ctx.params.id) === String(auth.id)) {
    throw AppError.bad('Use your profile settings to update your own account.');
  }

  const found = ctx.db.get('SELECT id, name, role, status FROM users WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('User not found.');
  if (found.role === 'admin') throw AppError.forbidden('Admin accounts cannot be modified here.');

  const body = ctx.body ?? {};
  const next = {};
  if (body.name !== undefined) next.name = readText(body.name, 'Full name', { min: 2, max: 60, required: true });
  if (body.phone !== undefined) next.phone = readPhone(body.phone);
  if (body.bio !== undefined) next.bio = readText(body.bio, 'Bio', { min: 0, max: 400 });
  if (body.avatar_color !== undefined) {
    if (!validColor(body.avatar_color)) throw AppError.bad('Choose a valid avatar colour.');
    next.avatar_color = body.avatar_color;
  }
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (status !== 'active' && status !== 'suspended') throw AppError.bad('Unknown account status.');
    next.status = status;
  }
  if (body.is_verified !== undefined) next.is_verified = body.is_verified ? 1 : 0;
  if (!Object.keys(next).length) throw AppError.bad('Nothing to update.');

  const sets = Object.keys(next).map((key) => `${key} = ?`);
  ctx.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(next), found.id]);

  if (next.status && next.status !== found.status) {
    if (next.status === 'suspended') {
      ctx.db.run('UPDATE drivers SET is_online = 0 WHERE user_id = ?', [found.id]);
      const driverRow = ctx.db.get('SELECT id FROM drivers WHERE user_id = ?', [found.id]);
      if (driverRow) closeSession(ctx.db, driverRow.id, 'suspended');
    }
    notify(
      ctx.db,
      found.id,
      'account',
      next.status === 'suspended' ? 'Account suspended' : 'Account reactivated',
      next.status === 'suspended'
        ? 'Your AddisGo account has been suspended. Contact support@addisgo.et to appeal.'
        : 'Your AddisGo account is active again. Welcome back.',
      '#/profile',
    );
    audit(ctx.db, auth.id, 'user.status_changed', `User #${found.id} (${found.name}) set to ${next.status}`);
  }
  if (next.is_verified !== undefined) {
    audit(
      ctx.db,
      auth.id,
      'user.verification_changed',
      `User #${found.id} (${found.name}) verified = ${Boolean(next.is_verified)}`,
    );
  }
  const profileChanged = ['name', 'phone', 'bio', 'avatar_color'].some((key) => key in next);
  if (profileChanged) {
    audit(ctx.db, auth.id, 'user.profile_updated', `User #${found.id} (${next.name ?? found.name}) profile updated`);
  }
  return mapAdminUser(ctx.db.get(`${ADMIN_USER_SELECT} WHERE u.id = ?`, [found.id]));
}

export async function deleteUser(ctx) {
  const auth = requireAdmin(ctx);
  if (String(ctx.params.id) === String(auth.id)) throw AppError.bad('You cannot delete your own account.');
  const found = ctx.db.get('SELECT id, name, role FROM users WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('User not found.');
  if (found.role === 'admin') throw AppError.forbidden('Admin accounts cannot be deleted here.');

  const scalar = (sql) => Number(ctx.db.get(sql, [found.id]).n ?? 0);
  const bookings = scalar(
    `SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ?
       OR driver_id = (SELECT id FROM drivers WHERE user_id = ?)`,
  );
  const tours = scalar('SELECT COUNT(*) AS n FROM tours WHERE host_id = ?');
  const reports = scalar('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?');
  const auditRows = scalar('SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ?');
  if (bookings || tours || reports || auditRows) {
    const parts = [];
    if (bookings) parts.push(`${bookings} ride${bookings === 1 ? '' : 's'}`);
    if (tours) parts.push(`${tours} tour${tours === 1 ? '' : 's'}`);
    if (reports) parts.push(`${reports} safety report${reports === 1 ? '' : 's'}`);
    if (auditRows) parts.push(`${auditRows} audit entr${auditRows === 1 ? 'y' : 'ies'}`);
    throw AppError.conflict(
      `${found.name} has ${parts.join(', ')} on record. Suspend the account instead of deleting it.`,
    );
  }

  ctx.db.run('DELETE FROM users WHERE id = ?', [found.id]);
  audit(ctx.db, auth.id, 'user.deleted', `User #${found.id} (${found.name}) deleted`);
  return { ok: true };
}

const setUser = updateUser;
export { setUser };

export async function bookings(ctx) {
  requireAdmin(ctx);
  let sql = `${BOOKING_SELECT} WHERE 1 = 1`;
  const params = [];
  const status = ctx.query.get('status');
  if (status) {
    if (!BOOKING_STATUSES.includes(status)) throw AppError.bad('Unknown booking status.');
    sql += ' AND b.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY b.created_at DESC LIMIT 150';
  return { bookings: ctx.db.all(sql, params).map(mapBooking) };
}

export async function updateBooking(ctx) {
  const auth = requireAdmin(ctx);
  const booking = mapBooking(ctx.db.get(`${BOOKING_SELECT} WHERE b.id = ?`, [ctx.params.id]));
  if (!booking) throw AppError.notFound('Ride not found.');
  const body = ctx.body ?? {};

  const next = {};
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!BOOKING_STATUSES.includes(status)) throw AppError.bad('Choose a valid ride status.');
    next.status = status;
  }
  if (body.fare !== undefined) {
    const fare = Number(body.fare);
    if (!Number.isInteger(fare) || fare < 0 || fare > 100000) {
      throw AppError.bad('Fare must be a whole number between 0 and 100,000 ETB.');
    }
    next.fare = fare;
  }
  if (body.notes !== undefined) next.notes = readText(body.notes, 'Notes', { min: 0, max: 300 });
  if (body.scheduled_for !== undefined) {
    const raw = String(body.scheduled_for ?? '').trim();
    if (!raw) next.scheduled_for = null;
    else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw AppError.bad('Scheduled time must be a valid date.');
      next.scheduled_for = parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
  }
  if (!Object.keys(next).length) throw AppError.bad('Nothing to update.');

  const now = nowIso();
  if (next.status === 'accepted') next.accepted_at = booking.accepted_at ?? now;
  if (next.status === 'in_progress') {
    next.accepted_at = booking.accepted_at ?? now;
    next.started_at = booking.started_at ?? now;
  }
  if (next.status === 'completed') {
    next.accepted_at = booking.accepted_at ?? now;
    next.started_at = booking.started_at ?? now;
    next.completed_at = booking.completed_at ?? now;
  }
  if (next.status === 'cancelled') next.cancelled_at = booking.cancelled_at ?? now;

  const sets = Object.keys(next).map((key) => `${key} = ?`);
  ctx.db.run(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(next), booking.id]);

  if (next.status === 'completed' && booking.status !== 'completed' && booking.driver) {
    ctx.db.run('UPDATE drivers SET trips = trips + 1 WHERE id = ?', [booking.driver.id]);
    notify(ctx.db, booking.customer.id, 'ride', 'Trip complete', 'Thanks for riding with AddisGo. Tap the trip to leave a rating.', `#/ride/${booking.id}`);
  } else if (next.status === 'cancelled' && booking.status !== 'cancelled') {
    notify(ctx.db, booking.customer.id, 'ride', 'Ride cancelled', 'An AddisGo operator cancelled this ride. Any charge is released.', `#/ride/${booking.id}`);
  }

  if (next.status === 'completed' && booking.status !== 'completed') {
    settleBooking(ctx.db, {
      id: booking.id,
      fare: next.fare ?? booking.fare,
      driver_id: booking.driver?.id ?? null,
      customer_id: booking.customer?.id ?? null,
    });
  }

  audit(
    ctx.db,
    auth.id,
    'booking.updated',
    `Ride ${booking.code} updated${next.status ? ` to ${next.status}` : ''}${next.fare !== undefined ? ` · fare ${next.fare}` : ''}`,
  );
  return mapBooking(ctx.db.get(`${BOOKING_SELECT} WHERE b.id = ?`, [booking.id]));
}

export async function deleteBooking(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, code, status FROM bookings WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Ride not found.');
  if (['accepted', 'arriving', 'in_progress'].includes(found.status)) {
    throw AppError.conflict('Cancel the live ride before deleting it.');
  }

  ctx.db.tx(() => {
    ctx.db.run("DELETE FROM messages WHERE room_type = 'ride' AND room_id = ?", [found.id]);
    ctx.db.run('DELETE FROM bookings WHERE id = ?', [found.id]);
  });
  audit(ctx.db, auth.id, 'booking.deleted', `Ride ${found.code} deleted`);
  return { ok: true };
}

export async function tours(ctx) {
  const auth = requireAdmin(ctx);
  const items = [];
  for (const row of ctx.db.all('SELECT id FROM tours ORDER BY starts_at DESC LIMIT 100')) {
    const tour = tourView(ctx.db, row.id, auth.id);
    if (tour) items.push(tour);
  }
  return { tours: items };
}

export async function reports(ctx) {
  requireAdmin(ctx);
  const status = ctx.query.get('status') || 'open';
  if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) throw AppError.bad('Unknown report status.');

  let sql = `SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.status, r.created_at, r.resolved_at,
      u.id AS reporter_id, u.name AS reporter_name, u.email AS reporter_email
    FROM reports r JOIN users u ON u.id = r.reporter_id`;
  const params = [];
  if (status !== 'all') {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 100';

  return {
    reports: ctx.db.all(sql, params).map((row) => ({
      id: row.id,
      target_type: row.target_type,
      target_id: row.target_id,
      reason: row.reason,
      detail: row.detail ?? '',
      status: row.status,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      reporter_id: row.reporter_id,
      reporter_name: row.reporter_name,
      reporter_email: row.reporter_email,
    })),
  };
}

export async function resolveReport(ctx) {
  const auth = requireAdmin(ctx);
  const status = String(ctx.body.status ?? '').trim().toLowerCase();
  if (status !== 'resolved' && status !== 'dismissed') {
    throw AppError.bad('Reports can be resolved or dismissed.');
  }
  const found = ctx.db.get('SELECT reporter_id FROM reports WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Report not found.');

  ctx.db.run('UPDATE reports SET status = ?, resolved_at = ? WHERE id = ?', [status, nowIso(), ctx.params.id]);
  notify(
    ctx.db,
    found.reporter_id,
    'safety',
    'Safety report reviewed',
    'Thanks for helping keep AddisGo safe. Our team has reviewed your report.',
    '#/profile',
  );
  audit(ctx.db, auth.id, 'safety.report_reviewed', `Report #${ctx.params.id} marked ${status}`);
  return { ok: true };
}

export async function auditLog(ctx) {
  requireAdmin(ctx);
  const requested = Number(ctx.query.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 500) : 120;
  const action = String(ctx.query.get('action') || '').trim();
  const params = [];
  let sql = `SELECT a.id, a.action, a.detail, a.created_at, u.name AS actor_name
         FROM audit_log a JOIN users u ON u.id = a.actor_id`;
  if (action) {
    sql += ' WHERE a.action = ?';
    params.push(action);
  }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  params.push(limit);
  return {
    audit: ctx.db
      .all(sql, params)
      .map((row) => ({
        id: row.id,
        action: row.action,
        detail: row.detail ?? '',
        created_at: row.created_at,
        actor_name: row.actor_name,
      })),
  };
}

export async function emailSettings(ctx) {
  requireAdmin(ctx);
  const { getEmailConfig } = await import('../lib/email.js');
  const config = getEmailConfig(ctx.db);
  const outbox = ctx.db.all(
    `SELECT id, recipient, subject, template, status, error, attempts, next_attempt_at,
            last_attempt_at, delivered_at, created_at
       FROM email_outbox ORDER BY id DESC LIMIT 50`,
  );
  const totalSent = Number(ctx.db.get("SELECT COUNT(*) AS n FROM email_outbox WHERE status IN ('sent', 'logged_offline')")?.n ?? 0);
  const subscriberCount = Number(ctx.db.get('SELECT COUNT(*) AS n FROM subscribers')?.n ?? 0);
  const queued = Number(ctx.db.get("SELECT COUNT(*) AS n FROM email_outbox WHERE status IN ('queued', 'sending')")?.n ?? 0);
  const failed = Number(ctx.db.get("SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'failed'")?.n ?? 0);

  return {
    config: {
      host: config.host,
      port: config.port,
      user: config.user,
      from: config.from,
      gmail: config.gmail,
      is_configured: config.is_configured,
      password_set: config.password_set,
      password_format_ok: config.password_format_ok,
      masked_pass: config.masked_pass,
      verified_at: config.verified_at,
      last_test_at: config.last_test_at,
      last_error: config.last_error,
    },
    total_sent: totalSent,
    subscriber_count: subscriberCount,
    queue: { pending: queued, failed },
    outbox,
  };
}

export async function setEmailSettings(ctx) {
  const admin = requireAdmin(ctx);
  const { saveEmailConfig } = await import('../lib/email.js');
  const body = ctx.body || {};

  const user = body.user === undefined ? undefined : String(body.user).trim();
  if (user !== undefined && user !== '' && !validEmail(user)) {
    throw AppError.bad('Enter a valid email address, for example yourname@gmail.com.');
  }

  const updated = saveEmailConfig(ctx.db, {
    user,
    pass: body.pass,
    from: body.from,
    host: body.host,
    port: body.port,
  });
  audit(ctx.db, admin.id, 'email.settings_updated', `Google SMTP configuration updated for ${updated.user || 'none'}`);

  let verification = null;
  let config = updated;
  if (body.verify) {
    const { getEmailConfig, verifyEmailConfig } = await import('../lib/email.js');
    verification = await verifyEmailConfig(ctx.db);
    config = getEmailConfig(ctx.db);
    audit(
      ctx.db,
      admin.id,
      'email.verified',
      verification.ok
        ? `Google SMTP verified for ${config.user}`
        : `Google SMTP verification failed for ${config.user}: ${verification.code}`,
    );
  }

  return { ok: true, config, verification };
}

export async function verifyEmailSettings(ctx) {
  const admin = requireAdmin(ctx);
  const { verifyEmailConfig } = await import('../lib/email.js');
  const body = ctx.body || {};

  const verification = await verifyEmailConfig(ctx.db, {
    user: body.user,
    pass: body.pass,
    host: body.host,
    port: body.port,
  });

  audit(
    ctx.db,
    admin.id,
    verification.ok ? 'email.verified' : 'email.verify_failed',
    verification.ok
      ? `Google SMTP verified for ${verification.user}`
      : `Google SMTP verification failed for ${verification.user || 'none'}: ${verification.code}`,
  );

  return verification;
}

export async function disconnectEmail(ctx) {
  const admin = requireAdmin(ctx);
  const { clearEmailConfig } = await import('../lib/email.js');
  const config = clearEmailConfig(ctx.db);
  audit(ctx.db, admin.id, 'email.disconnected', 'Stored Google SMTP credentials removed');
  return { ok: true, config };
}

export async function testEmailSend(ctx) {
  const admin = requireAdmin(ctx);
  const recipient = String(ctx.body.recipient ?? '').trim().toLowerCase();
  const { validEmail } = await import('../lib/util.js');
  if (!validEmail(recipient)) throw AppError.bad('Please provide a valid recipient email address.');

  const { sendTestEmail } = await import('../lib/email.js');
  const res = await sendTestEmail(ctx.db, recipient);
  audit(ctx.db, admin.id, 'email.test_sent', `Test email dispatched to ${recipient}`);
  return res;
}

export async function subscribersList(ctx) {
  requireAdmin(ctx);
  const items = ctx.db.all('SELECT * FROM subscribers ORDER BY id DESC LIMIT 200');
  return { subscribers: items };
}

export async function deleteReport(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, reason FROM reports WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Report not found.');
  ctx.db.run('DELETE FROM reports WHERE id = ?', [found.id]);
  audit(ctx.db, auth.id, 'safety.report_deleted', `Report #${found.id} deleted`);
  return { ok: true };
}

export async function deleteOutboxItem(ctx) {
  requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, recipient FROM email_outbox WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Email log entry not found.');
  ctx.db.run('DELETE FROM email_outbox WHERE id = ?', [found.id]);
  return { ok: true };
}

/** Admin action: force one queued/failed message to be attempted again. */
export async function retryOutboxItem(ctx) {
  const admin = requireAdmin(ctx);
  const { retryOutboxItem: retry } = await import('../lib/email.js');
  const result = await retry(ctx.db, ctx.params.id);
  if (!result) throw AppError.notFound('Email log entry not found.');
  audit(
    ctx.db,
    admin.id,
    'email.retried',
    result.already_sent ? `Email #${ctx.params.id} was already sent` : `Retry requested for email #${ctx.params.id}`,
  );
  return result;
}

export async function deleteSubscriber(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, email FROM subscribers WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Subscriber not found.');
  ctx.db.run('DELETE FROM subscribers WHERE id = ?', [found.id]);
  audit(ctx.db, auth.id, 'newsletter.subscriber_removed', `${found.email} removed from the newsletter`);
  return { ok: true };
}
